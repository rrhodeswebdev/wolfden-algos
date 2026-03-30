"""Algo runner — spawned as a separate process per algo instance.

Connects to the Rust backend via ZeroMQ:
  - SUB socket: receives market data (ticks, bars, fills) for a specific data source
  - PUSH socket: sends orders back to the Rust backend

Each instance is identified by a unique instance_id (UUID) and subscribes
only to market data from its assigned data source (source_id).

Usage:
  python runner.py --algo-path /path/to/algo.py \
                   --market-data-addr ipc:///tmp/wolfden-market-data \
                   --trade-signal-addr ipc:///tmp/wolfden-trade-signals \
                   --instance-id abc123-... \
                   --algo-id 42 \
                   --source-id "ES 09-26:5min" \
                   --account Demo-1 \
                   --mode shadow \
                   --max-position-size 5 \
                   --max-daily-loss 500 \
                   --max-daily-trades 50
"""

import argparse
import importlib.util
import sys
import time
import msgpack
import zmq

from wolf_types import Tick, Bar, Fill, AlgoResult, Context, Order, BracketOrder


class RiskManager:
    """Per-instance risk management enforced locally before sending orders."""

    def __init__(self, max_position: int, max_daily_loss: float, max_daily_trades: int):
        self.max_position = max_position
        self.max_daily_loss = max_daily_loss
        self.max_daily_trades = max_daily_trades
        self.position = 0
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.halted = False

    def check_order(self, order) -> bool:
        """Returns False if order would violate risk limits."""
        if self.halted:
            return False
        if self.daily_trades >= self.max_daily_trades:
            self.halted = True
            print(f"[risk] Max daily trades ({self.max_daily_trades}) reached — halting")
            return False
        if self.daily_pnl <= -abs(self.max_daily_loss):
            self.halted = True
            print(f"[risk] Max daily loss (${self.max_daily_loss}) reached — halting")
            return False
        new_pos = self.position + (order.qty if order.side == "BUY" else -order.qty)
        if abs(new_pos) > self.max_position:
            print(f"[risk] Order would exceed max position ({self.max_position}) — rejected")
            return False
        return True

    def on_fill(self, fill: Fill):
        """Update position and trade count on fill."""
        if fill.side == "BUY":
            self.position += fill.qty
        else:
            self.position -= fill.qty
        self.daily_trades += 1


class PositionTracker:
    """Tracks position and entry price from fill events."""

    def __init__(self):
        self.position = 0
        self.entry_price = 0.0
        self._cost_basis = 0.0

    def on_fill(self, fill: Fill):
        qty = fill.qty if fill.side == "BUY" else -fill.qty
        new_position = self.position + qty

        if self.position == 0:
            self.entry_price = fill.price
            self._cost_basis = fill.price * abs(qty)
        elif (self.position > 0 and qty > 0) or (self.position < 0 and qty < 0):
            self._cost_basis += fill.price * abs(qty)
            self.entry_price = self._cost_basis / abs(new_position)
        elif new_position == 0:
            self.entry_price = 0.0
            self._cost_basis = 0.0
        else:
            self.entry_price = fill.price
            self._cost_basis = fill.price * abs(new_position)

        self.position = new_position

    def build_context(self, symbol: str, last_price: float) -> Context:
        unrealized = 0.0
        if self.position != 0 and last_price > 0:
            unrealized = (last_price - self.entry_price) * self.position
        return Context(
            symbol=symbol,
            position=self.position,
            entry_price=self.entry_price,
            unrealized_pnl=unrealized,
        )


def _noop_handler(state: dict, _event, _ctx: Context) -> AlgoResult:
    return AlgoResult(state, ())


def _fill_symbol(order, symbol: str):
    """Backfill empty symbol on an Order or BracketOrder."""
    if isinstance(order, BracketOrder):
        return BracketOrder(
            symbol=order.symbol or symbol,
            entry=_fill_symbol(order.entry, symbol),
            stop_loss=_fill_symbol(order.stop_loss, symbol),
            take_profit=_fill_symbol(order.take_profit, symbol),
        )
    if isinstance(order, Order) and not order.symbol:
        return order._replace(symbol=symbol)
    return order


def load_algo_module(path: str) -> dict:
    """Load a Python file and call create_algo() to get handler dict."""
    spec = importlib.util.spec_from_file_location("user_algo", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load algo from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    create_fn = getattr(module, "create_algo", None)
    if create_fn is None:
        raise AttributeError(f"Algo module {path} must define a create_algo() function")

    handlers = create_fn()

    if "init" not in handlers:
        raise KeyError("Algo must define an init() handler")
    if "on_tick" not in handlers and "on_bar" not in handlers:
        raise KeyError("Algo must define at least one of on_tick() or on_bar()")

    handlers.setdefault("on_tick", _noop_handler)
    handlers.setdefault("on_bar", _noop_handler)
    handlers.setdefault("on_fill", _noop_handler)

    return handlers


def deserialize_message(data: bytes) -> tuple:
    """Unpack a msgpack message into (msg_type, payload)."""
    msg = msgpack.unpackb(data, raw=False)
    msg_type = msg.get("type", "")
    return msg_type, msg


def make_tick(msg: dict) -> Tick:
    return Tick(
        symbol=msg["symbol"],
        price=msg["price"],
        size=msg["size"],
        timestamp=msg["timestamp"],
    )


def make_bar(msg: dict) -> Bar:
    return Bar(
        symbol=msg["symbol"],
        o=msg["o"],
        h=msg["h"],
        l=msg["l"],
        c=msg["c"],
        v=msg["v"],
        timestamp=msg["timestamp"],
    )


def make_fill(msg: dict) -> Fill:
    return Fill(
        symbol=msg["symbol"],
        side=msg["side"],
        qty=msg["qty"],
        price=msg["price"],
        order_id=msg.get("order_id", ""),
        timestamp=msg.get("timestamp", 0),
    )


def serialize_orders(instance_id: str, algo_id: str, orders: tuple) -> list[bytes]:
    """Serialize a tuple of Order/BracketOrder into msgpack messages."""
    messages = []
    for order in orders:
        msg = {
            "type": "order",
            "instance_id": instance_id,
            "algo_id": algo_id,
            "side": order.side,
            "symbol": order.symbol,
            "qty": order.qty,
            "order_type": order.order_type,
            "limit_price": order.limit_price,
            "stop_price": order.stop_price,
        }
        messages.append(msgpack.packb(msg, use_bin_type=True))
    return messages


def run(args: argparse.Namespace) -> None:
    zmq_ctx = zmq.Context()

    # SUB socket for market data — subscribe to this instance's data source
    sub = zmq_ctx.socket(zmq.SUB)
    sub.connect(args.market_data_addr)
    sub.setsockopt_string(zmq.SUBSCRIBE, f"md:{args.source_id}:")
    sub.setsockopt_string(zmq.SUBSCRIBE, f"fill:{args.instance_id}")

    # PUSH socket for trade signals
    push = zmq_ctx.socket(zmq.PUSH)
    push.connect(args.trade_signal_addr)

    # Load and initialize algo
    handlers = load_algo_module(args.algo_path)
    state = handlers["init"]()

    # Extract symbol from source_id (e.g. "ES 09-26:5min" -> "ES 09-26")
    symbol = args.source_id.rsplit(":", 1)[0] if ":" in args.source_id else args.source_id

    # Runtime-managed position tracking
    pos_tracker = PositionTracker()
    last_price = 0.0

    # Risk manager
    risk = RiskManager(
        max_position=args.max_position_size,
        max_daily_loss=args.max_daily_loss,
        max_daily_trades=args.max_daily_trades,
    )

    print(f"[runner] Instance {args.instance_id} started")
    print(f"[runner]   algo_id={args.algo_id}, source={args.source_id}, account={args.account}, mode={args.mode}")
    sys.stdout.flush()

    push.send(msgpack.packb({
        "type": "heartbeat",
        "instance_id": args.instance_id,
        "algo_id": args.algo_id,
        "status": "running",
        "timestamp": int(time.time() * 1000),
    }, use_bin_type=True))

    try:
        while True:
            topic = sub.recv_string()
            data = sub.recv()
            msg_type, msg = deserialize_message(data)

            result: AlgoResult | None = None
            ctx = pos_tracker.build_context(symbol, last_price)

            if msg_type == "tick":
                tick = make_tick(msg)
                last_price = tick.price
                ctx = pos_tracker.build_context(symbol, last_price)
                result = handlers["on_tick"](state, tick, ctx)
            elif msg_type == "bar":
                bar = make_bar(msg)
                last_price = bar.c
                ctx = pos_tracker.build_context(symbol, last_price)
                result = handlers["on_bar"](state, bar, ctx)
            elif msg_type == "fill":
                fill = make_fill(msg)
                risk.on_fill(fill)
                pos_tracker.on_fill(fill)
                ctx = pos_tracker.build_context(symbol, last_price)
                result = handlers["on_fill"](state, fill, ctx)
            else:
                continue

            if result is not None:
                state = result.state
                if result.orders:
                    filled = tuple(_fill_symbol(o, symbol) for o in result.orders)
                    approved = tuple(o for o in filled if risk.check_order(o))
                    if approved:
                        for packed in serialize_orders(args.instance_id, args.algo_id, approved):
                            push.send(packed)

    except KeyboardInterrupt:
        print(f"[runner] Instance {args.instance_id} shutting down")
    finally:
        push.send(msgpack.packb({
            "type": "heartbeat",
            "instance_id": args.instance_id,
            "algo_id": args.algo_id,
            "status": "stopped",
            "timestamp": int(time.time() * 1000),
        }, use_bin_type=True))
        sub.close()
        push.close()
        zmq_ctx.term()


def main() -> None:
    parser = argparse.ArgumentParser(description="Wolf Den Algo Runner")
    parser.add_argument("--algo-path", required=True, help="Path to algo Python file")
    parser.add_argument("--market-data-addr", required=True, help="ZMQ SUB address for market data")
    parser.add_argument("--trade-signal-addr", required=True, help="ZMQ PUSH address for trade signals")
    parser.add_argument("--instance-id", required=True, help="Unique instance identifier (UUID)")
    parser.add_argument("--algo-id", required=True, help="Algo definition identifier")
    parser.add_argument("--source-id", required=True, help="Data source identifier (instrument:timeframe)")
    parser.add_argument("--account", required=True, help="Trading account name")
    parser.add_argument("--mode", default="shadow", choices=["live", "shadow"], help="Execution mode")
    parser.add_argument("--max-position-size", type=int, default=5, help="Max position size (contracts)")
    parser.add_argument("--max-daily-loss", type=float, default=500.0, help="Max daily loss before halting ($)")
    parser.add_argument("--max-daily-trades", type=int, default=50, help="Max trades per day")
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()

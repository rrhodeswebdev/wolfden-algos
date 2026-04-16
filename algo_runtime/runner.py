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
import os
import sys
import time
import traceback
import msgpack
import zmq

from wolf_types import Tick, Bar, Fill, AlgoResult, Context, Order, BracketOrder, ModifyOrder, CancelOrder, OrderAccepted


class RiskManager:
    """Per-instance risk management enforced locally before sending orders."""

    def __init__(self, max_position: int, max_daily_loss: float, max_daily_trades: int):
        self.max_position = max_position
        self.max_daily_loss = max_daily_loss
        self.max_daily_trades = max_daily_trades
        self.position = 0
        self.avg_entry_price = 0.0
        self.daily_pnl = 0.0
        self.daily_trades = 0
        self.halted = False

    def _get_check_order(self, order) -> Order:
        """Extract the entry Order for risk checking, handling BracketOrder."""
        if isinstance(order, BracketOrder):
            return order.entry
        return order

    def check_order(self, order, error_callback=None) -> bool:
        """Returns False if order would violate risk limits."""
        if self.halted:
            return False
        if self.daily_trades >= self.max_daily_trades:
            self.halted = True
            msg = f"Max daily trades ({self.max_daily_trades}) reached — halting"
            print(f"[risk] {msg}")
            if error_callback:
                error_callback(severity="warning", category="risk", message=msg)
            return False
        if self.daily_pnl <= -abs(self.max_daily_loss):
            self.halted = True
            msg = f"Max daily loss (${self.max_daily_loss}) reached — halting"
            print(f"[risk] {msg}")
            if error_callback:
                error_callback(severity="warning", category="risk", message=msg)
            return False
        check = self._get_check_order(order)
        new_pos = self.position + (check.qty if check.side == "BUY" else -check.qty)
        if abs(new_pos) > self.max_position:
            msg = f"Order would exceed max position ({self.max_position}) — rejected"
            print(f"[risk] {msg}")
            if error_callback:
                error_callback(severity="warning", category="risk", message=msg)
            return False
        return True

    def on_fill(self, fill: Fill):
        """Update position, trade count, and daily P&L on fill."""
        qty_signed = fill.qty if fill.side == "BUY" else -fill.qty
        old_position = self.position
        new_position = old_position + qty_signed

        # Compute realized P&L when reducing or closing position
        if old_position != 0 and self.avg_entry_price > 0:
            # Determine if this fill reduces the position
            reducing = (old_position > 0 and qty_signed < 0) or (old_position < 0 and qty_signed > 0)
            if reducing:
                qty_closed = min(abs(qty_signed), abs(old_position))
                direction = 1 if old_position > 0 else -1
                realized_pnl = qty_closed * (fill.price - self.avg_entry_price) * direction
                self.daily_pnl += realized_pnl

        # Update average entry price
        if old_position == 0:
            # Opening fresh position
            self.avg_entry_price = fill.price
        elif (old_position > 0 and qty_signed > 0) or (old_position < 0 and qty_signed < 0):
            # Adding to existing position — compute weighted average
            total_qty = abs(old_position) + abs(qty_signed)
            self.avg_entry_price = (self.avg_entry_price * abs(old_position) + fill.price * abs(qty_signed)) / total_qty
        elif new_position == 0:
            # Fully closed
            self.avg_entry_price = 0.0
        else:
            # Flipped sides
            self.avg_entry_price = fill.price

        self.position = new_position
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


class ShadowSimulator:
    """Simulates order fills locally for shadow mode.

    MARKET orders fill immediately at the current price.
    STOP orders become working and fill when the market trades through
    the stop price.  LIMIT orders fill when the market reaches the
    limit price.  Modify/Cancel update or remove working orders.
    """

    def __init__(self):
        self._next_id = 0
        # Working orders: order_id -> {side, qty, order_type, stop_price, limit_price}
        self._working: dict[str, dict] = {}

    def _gen_id(self) -> str:
        self._next_id += 1
        return f"shadow-{self._next_id}"

    def submit(self, order, symbol: str, last_price: float) -> list[Fill]:
        """Submit an order.  Returns a list of immediate fills (for MARKET orders)."""
        if isinstance(order, ModifyOrder):
            if order.order_id in self._working:
                w = self._working[order.order_id]
                if order.qty > 0:
                    w["qty"] = order.qty
                if order.stop_price != 0.0:
                    w["stop_price"] = order.stop_price
                if order.limit_price != 0.0:
                    w["limit_price"] = order.limit_price
            return []

        if isinstance(order, CancelOrder):
            self._working.pop(order.order_id, None)
            return []

        # Decompose BracketOrder into component orders
        if isinstance(order, BracketOrder):
            fills = []
            # Submit entry order
            entry_fills = self.submit(order.entry, symbol, last_price)
            fills.extend(entry_fills)
            # Submit stop loss and take profit as working orders
            if order.stop_loss is not None:
                self.submit(order.stop_loss, symbol, last_price)
            if order.take_profit is not None:
                self.submit(order.take_profit, symbol, last_price)
            return fills

        oid = self._gen_id()

        if order.order_type == "MARKET":
            fill_price = last_price if last_price > 0 else 0.0
            return [Fill(symbol, order.side, order.qty, fill_price, oid, int(time.time() * 1000))]

        # STOP / LIMIT / STOPLIMIT → park as working
        self._working[oid] = {
            "side": order.side,
            "qty": order.qty,
            "order_type": order.order_type,
            "stop_price": order.stop_price,
            "limit_price": order.limit_price,
            "symbol": symbol,
        }
        return []

    def check_working(self, price: float) -> list[Fill]:
        """Check working orders against the current market price.  Returns fills."""
        fills = []
        to_remove = []
        for oid, w in self._working.items():
            triggered = False
            if w["order_type"] == "STOP":
                if w["side"] == "SELL" and price <= w["stop_price"]:
                    triggered = True
                elif w["side"] == "BUY" and price >= w["stop_price"]:
                    triggered = True
            elif w["order_type"] == "LIMIT":
                if w["side"] == "BUY" and price <= w["limit_price"]:
                    triggered = True
                elif w["side"] == "SELL" and price >= w["limit_price"]:
                    triggered = True
            elif w["order_type"] == "MIT":
                if w["side"] == "BUY" and price <= w["stop_price"]:
                    triggered = True
                elif w["side"] == "SELL" and price >= w["stop_price"]:
                    triggered = True

            if triggered:
                fills.append(Fill(w["symbol"], w["side"], w["qty"], price, oid, int(time.time() * 1000)))
                to_remove.append(oid)

        for oid in to_remove:
            del self._working[oid]

        return fills

    def get_order_ids(self) -> list[str]:
        """Return IDs of all working orders."""
        return list(self._working.keys())


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
    handlers.setdefault("on_order_accepted", _noop_handler)

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
    """Serialize a tuple of Order/ModifyOrder/CancelOrder/BracketOrder into msgpack messages."""
    messages = []
    for order in orders:
        if isinstance(order, ModifyOrder):
            msg = {
                "type": "modify",
                "instance_id": instance_id,
                "order_id": order.order_id,
                "qty": order.qty,
                "limit_price": order.limit_price,
                "stop_price": order.stop_price,
            }
        elif isinstance(order, CancelOrder):
            msg = {
                "type": "cancel",
                "instance_id": instance_id,
                "order_id": order.order_id,
            }
        elif isinstance(order, BracketOrder):
            # Decompose BracketOrder into its constituent orders
            def _order_msg(o: Order) -> dict:
                return {
                    "type": "order",
                    "instance_id": instance_id,
                    "algo_id": algo_id,
                    "side": o.side,
                    "symbol": o.symbol,
                    "qty": o.qty,
                    "order_type": o.order_type,
                    "limit_price": o.limit_price,
                    "stop_price": o.stop_price,
                }
            messages.append(msgpack.packb(_order_msg(order.entry), use_bin_type=True))
            if order.stop_loss is not None:
                messages.append(msgpack.packb(_order_msg(order.stop_loss), use_bin_type=True))
            if order.take_profit is not None:
                messages.append(msgpack.packb(_order_msg(order.take_profit), use_bin_type=True))
            continue
        else:
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


def send_error(push_socket, instance_id: str, algo_id: str, severity: str, category: str, message: str, handler: str = "", traceback_str: str = ""):
    """Send a structured error message to the Rust backend via ZMQ PUSH."""
    try:
        push_socket.send(msgpack.packb({
            "type": "algo_error",
            "instance_id": instance_id,
            "algo_id": algo_id,
            "severity": severity,
            "category": category,
            "message": message,
            "handler": handler,
            "traceback": traceback_str,
            "timestamp": int(time.time() * 1000),
        }, use_bin_type=True))
    except Exception as e:
        print(f"Failed to send error: {e}", file=sys.stderr)
        traceback.print_exc()


def compute_backtest_stats(trades: list[dict]) -> dict:
    """Compute performance stats from a list of round-trip trades.

    Each trade dict has keys: pnl, side, entry_price, exit_price, qty.
    Returns the core stats payload.
    """
    if not trades:
        return {
            "pnl": 0.0,
            "win_rate": 0,
            "sharpe": "--",
            "profit_factor": "--",
            "total_trades": 0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "max_drawdown": 0.0,
        }

    wins = [t for t in trades if t["pnl"] > 0]
    losses = [t for t in trades if t["pnl"] < 0]
    total_pnl = sum(t["pnl"] for t in trades)
    win_count = len(wins)
    loss_count = len(losses)
    total = win_count + loss_count

    win_rate = round((win_count / total) * 100) if total > 0 else 0
    avg_win = sum(t["pnl"] for t in wins) / win_count if win_count > 0 else 0.0
    avg_loss = sum(t["pnl"] for t in losses) / loss_count if loss_count > 0 else 0.0

    total_win_amount = sum(t["pnl"] for t in wins)
    total_loss_amount = abs(sum(t["pnl"] for t in losses))
    if total_loss_amount > 0:
        profit_factor = f"{total_win_amount / total_loss_amount:.2f}"
    elif win_count > 0:
        profit_factor = "∞"
    else:
        profit_factor = "--"

    # Max drawdown from cumulative P&L curve
    cumulative = 0.0
    peak = 0.0
    max_dd = 0.0
    for t in trades:
        cumulative += t["pnl"]
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    # Sharpe ratio from per-trade returns
    if len(trades) >= 2:
        returns = [t["pnl"] for t in trades]
        mean_r = sum(returns) / len(returns)
        variance = sum((r - mean_r) ** 2 for r in returns) / (len(returns) - 1)
        std_r = variance ** 0.5
        sharpe = f"{mean_r / std_r:.2f}" if std_r > 0 else "--"
    else:
        sharpe = "--"

    return {
        "pnl": round(total_pnl, 2),
        "win_rate": win_rate,
        "sharpe": sharpe,
        "profit_factor": profit_factor,
        "total_trades": total,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "max_drawdown": round(max_dd, 2),
    }


def run(args: argparse.Namespace) -> None:
    zmq_ctx = zmq.Context()

    # SUB socket for market data — subscribe to this instance's data source
    sub = zmq_ctx.socket(zmq.SUB)
    sub.connect(args.market_data_addr)
    sub.setsockopt_string(zmq.SUBSCRIBE, f"md:{args.source_id}:")
    sub.setsockopt_string(zmq.SUBSCRIBE, f"fill:{args.instance_id}")
    sub.setsockopt_string(zmq.SUBSCRIBE, f"ack:{args.instance_id}")
    # Subscribe to historical bars for backtest
    sub.setsockopt_string(zmq.SUBSCRIBE, f"history:{args.source_id}")

    # PUSH socket for trade signals
    push = zmq_ctx.socket(zmq.PUSH)
    push.connect(args.trade_signal_addr)

    # Load and initialize algo
    try:
        handlers = load_algo_module(args.algo_path)
        state = handlers["init"]()
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[runner] Failed to load algo: {exc}", file=sys.stderr)
        sys.stderr.flush()
        send_error(push, args.instance_id, args.algo_id,
                   severity="critical", category="runtime",
                   message=f"Failed to load algo: {exc}",
                   handler="init", traceback_str=tb)
        sub.close()
        push.close()
        zmq_ctx.term()
        return

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

    is_shadow = args.mode == "shadow"
    shadow_sim = ShadowSimulator() if is_shadow else None
    last_shadow_pos_emit = 0.0

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

    # Track the last historical bar timestamp for dedup
    last_history_ts = 0

    def _process_shadow_fills(sim_fills: list, _state: dict, emit: bool = True):
        """Feed simulated fills into the algo and risk/position trackers.

        When emit=False (backtest phase), skip sending events to the backend.
        """
        st = _state
        for sf in sim_fills:
            if emit:
                print(f"[shadow] Fill: {sf.side} {sf.qty} @ {sf.price} (order {sf.order_id})")
            risk.on_fill(sf)
            pos_tracker.on_fill(sf)

            if emit:
                # Notify backend of shadow fill for frontend display
                push.send(msgpack.packb({
                    "type": "shadow_fill",
                    "instance_id": args.instance_id,
                    "algo_id": args.algo_id,
                    "symbol": sf.symbol,
                    "side": sf.side,
                    "qty": sf.qty,
                    "price": sf.price,
                    "order_id": sf.order_id,
                    "position": pos_tracker.position,
                    "entry_price": pos_tracker.entry_price,
                    "unrealized_pnl": pos_tracker.build_context(symbol, last_price).unrealized_pnl,
                    "timestamp": sf.timestamp,
                }, use_bin_type=True))

            ctx = pos_tracker.build_context(symbol, last_price)
            fill_result = handlers["on_fill"](st, sf, ctx)
            if fill_result is not None:
                st = fill_result.state
                if fill_result.orders:
                    st = _submit_shadow_orders(fill_result.orders, st, emit=emit)
        return st

    def _submit_shadow_orders(orders: tuple, _state: dict, emit: bool = True):
        """Submit orders to the shadow simulator and process any immediate fills."""
        st = _state
        all_fills = []
        for o in orders:
            o = _fill_symbol(o, symbol)
            if isinstance(o, (ModifyOrder, CancelOrder)) or risk.check_order(o):
                fills = shadow_sim.submit(o, symbol, last_price)
                all_fills.extend(fills)
                # For non-market orders, generate a synthetic order_accepted
                if isinstance(o, Order) and o.order_type != "MARKET":
                    oids = shadow_sim.get_order_ids()
                    if oids:
                        oa = OrderAccepted(order_id=oids[-1], timestamp=int(time.time() * 1000))
                        ctx = pos_tracker.build_context(symbol, last_price)
                        oa_result = handlers["on_order_accepted"](st, oa, ctx)
                        if oa_result is not None:
                            st = oa_result.state
        if all_fills:
            st = _process_shadow_fills(all_fills, st, emit=emit)
        return st

    # --- Backtest Phase (shadow mode only, bar-based algos) ---
    has_on_bar = handlers.get("on_bar") is not _noop_handler
    backtest_bars_count = 0

    if is_shadow and has_on_bar:
        print(f"[runner] Waiting for historical bars on history:{args.source_id}...")
        sys.stdout.flush()

        # Wait up to 10 seconds for history message
        poller = zmq.Poller()
        poller.register(sub, zmq.POLLIN)
        history_received = False
        deadline = time.monotonic() + 10.0

        # Track fills during backtest for round-trip P&L
        backtest_fills: list[Fill] = []
        _orig_on_fill = pos_tracker.on_fill

        def _tracking_on_fill(fill: Fill):
            backtest_fills.append(fill)
            _orig_on_fill(fill)

        pos_tracker.on_fill = _tracking_on_fill

        while time.monotonic() < deadline:
            remaining_ms = int((deadline - time.monotonic()) * 1000)
            if remaining_ms <= 0:
                break
            socks = dict(poller.poll(timeout=remaining_ms))
            if sub in socks:
                topic = sub.recv_string()
                data = sub.recv()

                if topic.startswith(f"history:{args.source_id}"):
                    msg_type, msg = deserialize_message(data)
                    bars_raw = msg.get("bars", [])
                    if not bars_raw:
                        print("[runner] History received but empty — skipping backtest")
                        break

                    backtest_bars_count = len(bars_raw)
                    print(f"[runner] Received {backtest_bars_count} historical bars — running backtest")
                    sys.stdout.flush()

                    for bar_data in bars_raw:
                        bar = Bar(
                            symbol=symbol,
                            o=bar_data["o"],
                            h=bar_data["h"],
                            l=bar_data["l"],
                            c=bar_data["c"],
                            v=bar_data["v"],
                            timestamp=bar_data["t"],
                        )
                        last_price = bar.c
                        last_history_ts = bar.timestamp

                        # Check working orders against bar high/low
                        if shadow_sim:
                            triggered_h = shadow_sim.check_working(bar.h)
                            if triggered_h:
                                state = _process_shadow_fills(triggered_h, state, emit=False)
                            triggered_l = shadow_sim.check_working(bar.l)
                            if triggered_l:
                                state = _process_shadow_fills(triggered_l, state, emit=False)

                        ctx = pos_tracker.build_context(symbol, last_price)
                        result = handlers["on_bar"](state, bar, ctx)

                        if result is not None:
                            state = result.state
                            if result.orders and shadow_sim:
                                state = _submit_shadow_orders(result.orders, state, emit=False)

                    print(f"[runner] Backtest complete. Position: {pos_tracker.position}, Fills: {len(backtest_fills)}")
                    sys.stdout.flush()
                    history_received = True
                    break

        # Restore original on_fill
        pos_tracker.on_fill = _orig_on_fill

        if not history_received:
            print("[runner] No historical bars received — skipping backtest")
            sys.stdout.flush()

    # Compute and send backtest stats
    if is_shadow and has_on_bar and last_history_ts > 0:
        # Build round-trip trades from fills
        backtest_trades = []
        bt_pos = 0
        bt_entry_price = 0.0
        bt_cost_basis = 0.0

        for fill in backtest_fills:
            qty = fill.qty if fill.side == "BUY" else -fill.qty
            new_pos = bt_pos + qty

            if bt_pos == 0:
                # Opening a new position
                bt_entry_price = fill.price
                bt_cost_basis = fill.price * abs(qty)
            elif (bt_pos > 0 and qty > 0) or (bt_pos < 0 and qty < 0):
                # Adding to position
                bt_cost_basis += fill.price * abs(qty)
                bt_entry_price = bt_cost_basis / abs(new_pos)
            else:
                # Closing (fully or partially)
                closed_qty = min(abs(qty), abs(bt_pos))
                if bt_pos > 0:
                    pnl = (fill.price - bt_entry_price) * closed_qty
                else:
                    pnl = (bt_entry_price - fill.price) * closed_qty
                backtest_trades.append({"pnl": pnl})

                if new_pos == 0:
                    bt_entry_price = 0.0
                    bt_cost_basis = 0.0
                else:
                    # Flipped sides
                    bt_entry_price = fill.price
                    bt_cost_basis = fill.price * abs(new_pos)

            bt_pos = new_pos

        stats = compute_backtest_stats(backtest_trades)

        push.send(msgpack.packb({
            "type": "backtest_result",
            "instance_id": args.instance_id,
            "algo_id": args.algo_id,
            "source_id": args.source_id,
            "bars_count": backtest_bars_count,
            **stats,
            "timestamp": int(time.time() * 1000),
        }, use_bin_type=True))

        print(f"[runner] Backtest stats sent: {stats}")
        sys.stdout.flush()

        # Reset risk counters for live phase (position and algo state carry forward)
        risk.daily_pnl = 0.0
        risk.daily_trades = 0
        risk.halted = False
    elif is_shadow and not has_on_bar:
        # Tick-only algo — notify backend that backtest is unavailable
        push.send(msgpack.packb({
            "type": "backtest_result",
            "instance_id": args.instance_id,
            "algo_id": args.algo_id,
            "source_id": args.source_id,
            "bars_count": 0,
            "skipped": True,
            "reason": "tick_only",
            "timestamp": int(time.time() * 1000),
        }, use_bin_type=True))

    # Risk error callback for live phase
    def _risk_error(severity, category, message):
        send_error(push, args.instance_id, args.algo_id,
                   severity=severity, category=category, message=message)

    # --- Live Phase ---
    try:
        while True:
            topic = sub.recv_string()
            data = sub.recv()
            msg_type, msg = deserialize_message(data)

            # Skip history messages in live phase
            if msg_type == "history":
                continue

            result: AlgoResult | None = None
            ctx = pos_tracker.build_context(symbol, last_price)
            handler_name = ""

            try:
                if msg_type == "tick":
                    tick = make_tick(msg)
                    last_price = tick.price

                    # In shadow mode, check if any working orders are triggered by this tick
                    if is_shadow:
                        triggered = shadow_sim.check_working(tick.price)
                        if triggered:
                            state = _process_shadow_fills(triggered, state)

                        # Emit throttled position update for live P&L tracking
                        now = time.monotonic()
                        if pos_tracker.position != 0 and (now - last_shadow_pos_emit) >= 0.25:
                            last_shadow_pos_emit = now
                            ctx_snap = pos_tracker.build_context(symbol, last_price)
                            push.send(msgpack.packb({
                                "type": "shadow_position",
                                "instance_id": args.instance_id,
                                "algo_id": args.algo_id,
                                "symbol": symbol,
                                "position": pos_tracker.position,
                                "entry_price": pos_tracker.entry_price,
                                "unrealized_pnl": ctx_snap.unrealized_pnl,
                                "timestamp": int(time.time() * 1000),
                            }, use_bin_type=True))

                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_tick"
                    result = handlers["on_tick"](state, tick, ctx)
                elif msg_type == "bar":
                    bar = make_bar(msg)

                    # Timestamp dedup: skip bars already processed in backtest
                    if bar.timestamp <= last_history_ts:
                        continue

                    last_price = bar.c
                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_bar"
                    result = handlers["on_bar"](state, bar, ctx)
                elif msg_type == "fill":
                    if is_shadow:
                        # In shadow mode, ignore real fills from NinjaTrader
                        continue
                    fill = make_fill(msg)
                    risk.on_fill(fill)
                    pos_tracker.on_fill(fill)
                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_fill"
                    result = handlers["on_fill"](state, fill, ctx)
                elif msg_type == "order_accepted":
                    if is_shadow:
                        # In shadow mode, order_accepted is handled inline
                        continue
                    oa = OrderAccepted(
                        order_id=msg.get("order_id", ""),
                        timestamp=msg.get("timestamp", 0),
                    )
                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_order_accepted"
                    result = handlers["on_order_accepted"](state, oa, ctx)
                else:
                    continue

                if result is not None:
                    state = result.state
                    if result.orders:
                        if is_shadow:
                            state = _submit_shadow_orders(result.orders, state)
                        else:
                            filled = tuple(_fill_symbol(o, symbol) for o in result.orders)
                            # ModifyOrder/CancelOrder skip risk checks (they don't change position)
                            approved = tuple(
                                o for o in filled
                                if isinstance(o, (ModifyOrder, CancelOrder)) or risk.check_order(o, error_callback=_risk_error)
                            )
                            if approved:
                                for packed in serialize_orders(args.instance_id, args.algo_id, approved):
                                    push.send(packed)
            except Exception:
                tb = traceback.format_exc()
                print(f"[runner] Exception in {handler_name or msg_type}: {tb}", file=sys.stderr)
                sys.stderr.flush()
                send_error(push, args.instance_id, args.algo_id,
                           severity="error", category="runtime",
                           message=f"Exception in handler: {handler_name or msg_type}",
                           handler=handler_name, traceback_str=tb)
                continue

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

    # C6: Validate --algo-path is within allowed directories
    script_dir = os.path.dirname(os.path.realpath(__file__))
    algo_real = os.path.realpath(args.algo_path)
    allowed_prefixes = (
        os.path.join(script_dir, "algos") + os.sep,
        os.path.join(script_dir, "examples") + os.sep,
    )
    if not algo_real.startswith(allowed_prefixes):
        print(f"[runner] Error: algo path '{algo_real}' is not within allowed directories "
              f"({', '.join(allowed_prefixes)})", file=sys.stderr)
        sys.exit(1)

    run(args)


if __name__ == "__main__":
    main()

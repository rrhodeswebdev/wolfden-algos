"""Algo runner — spawned as a separate process per algo.

Connects to the Rust backend via ZeroMQ:
  - SUB socket: receives market data (ticks, bars, fills)
  - PUSH socket: sends orders back to the Rust backend

The runner loads the algo module, calls init() once, then loops:
  receive message → deserialize → call handler → serialize orders → send

Usage:
  python runner.py --algo-path /path/to/algo.py \
                   --market-data-addr ipc:///tmp/wolfden-market-data \
                   --trade-signal-addr ipc:///tmp/wolfden-trade-signals \
                   --algo-id 42 \
                   --symbols ES,NQ \
                   --mode shadow
"""

import argparse
import importlib.util
import sys
import time
import msgpack
import zmq

from wolf_types import Tick, Bar, Fill, AlgoResult


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
    required = {"init", "on_tick", "on_bar", "on_fill"}
    missing = required - set(handlers.keys())
    if missing:
        raise KeyError(f"Algo missing required handlers: {missing}")

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


def serialize_orders(algo_id: str, orders: tuple) -> list[bytes]:
    """Serialize a tuple of Order/BracketOrder into msgpack messages."""
    messages = []
    for order in orders:
        msg = {
            "type": "order",
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
    ctx = zmq.Context()

    # SUB socket for market data
    sub = ctx.socket(zmq.SUB)
    sub.connect(args.market_data_addr)
    for symbol in args.symbols.split(","):
        sub.setsockopt_string(zmq.SUBSCRIBE, symbol.strip())
    # Also subscribe to fills for this algo
    sub.setsockopt_string(zmq.SUBSCRIBE, f"fill:{args.algo_id}")

    # PUSH socket for trade signals
    push = ctx.socket(zmq.PUSH)
    push.connect(args.trade_signal_addr)

    # Load and initialize algo
    handlers = load_algo_module(args.algo_path)
    state = handlers["init"]()

    print(f"[runner] Algo {args.algo_id} started, mode={args.mode}, symbols={args.symbols}")
    sys.stdout.flush()

    # Send heartbeat on startup
    push.send(msgpack.packb({
        "type": "heartbeat",
        "algo_id": args.algo_id,
        "status": "running",
        "timestamp": int(time.time() * 1000),
    }, use_bin_type=True))

    try:
        while True:
            # Receive: [topic, data]
            topic = sub.recv_string()
            data = sub.recv()
            msg_type, msg = deserialize_message(data)

            result: AlgoResult | None = None

            if msg_type == "tick":
                result = handlers["on_tick"](state, make_tick(msg))
            elif msg_type == "bar":
                result = handlers["on_bar"](state, make_bar(msg))
            elif msg_type == "fill":
                result = handlers["on_fill"](state, make_fill(msg))
            else:
                continue

            if result is not None:
                state = result.state
                if result.orders:
                    for packed in serialize_orders(args.algo_id, result.orders):
                        push.send(packed)

    except KeyboardInterrupt:
        print(f"[runner] Algo {args.algo_id} shutting down")
    finally:
        push.send(msgpack.packb({
            "type": "heartbeat",
            "algo_id": args.algo_id,
            "status": "stopped",
            "timestamp": int(time.time() * 1000),
        }, use_bin_type=True))
        sub.close()
        push.close()
        ctx.term()


def main() -> None:
    parser = argparse.ArgumentParser(description="Wolf Den Algo Runner")
    parser.add_argument("--algo-path", required=True, help="Path to algo Python file")
    parser.add_argument("--market-data-addr", required=True, help="ZMQ SUB address for market data")
    parser.add_argument("--trade-signal-addr", required=True, help="ZMQ PUSH address for trade signals")
    parser.add_argument("--algo-id", required=True, help="Unique algo identifier")
    parser.add_argument("--symbols", required=True, help="Comma-separated list of symbols to subscribe to")
    parser.add_argument("--mode", default="shadow", choices=["live", "shadow"], help="Execution mode")
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()

"""Immutable data records for the Wolf Den algo runtime.

All algo handler functions operate on these types.
State flows through pure functions — no mutation, no side effects.
"""

from typing import NamedTuple


# --- Market Data ---

Tick = NamedTuple("Tick", [
    ("symbol", str),
    ("price", float),
    ("size", int),
    ("timestamp", int),
])

Bar = NamedTuple("Bar", [
    ("symbol", str),
    ("o", float),
    ("h", float),
    ("l", float),
    ("c", float),
    ("v", int),
    ("timestamp", int),
])


# --- Context (provided by runtime) ---

Context = NamedTuple("Context", [
    ("symbol", str),
    ("position", int),
    ("entry_price", float),
    ("unrealized_pnl", float),
])


# --- Orders ---

Order = NamedTuple("Order", [
    ("side", str),         # "BUY" or "SELL"
    ("symbol", str),
    ("qty", int),
    ("order_type", str),   # "MARKET", "LIMIT", "STOP", "STOPLIMIT", "MIT"
    ("limit_price", float),
    ("stop_price", float),
])

BracketOrder = NamedTuple("BracketOrder", [
    ("symbol", str),
    ("entry", Order),
    ("stop_loss", Order),
    ("take_profit", Order),
])


# --- Fills ---

Fill = NamedTuple("Fill", [
    ("symbol", str),
    ("side", str),
    ("qty", int),
    ("price", float),
    ("order_id", str),
    ("timestamp", int),
])

# --- Order Management ---

ModifyOrder = NamedTuple("ModifyOrder", [
    ("order_id", str),
    ("qty", int),
    ("limit_price", float),
    ("stop_price", float),
])

CancelOrder = NamedTuple("CancelOrder", [
    ("order_id", str),
])

OrderAccepted = NamedTuple("OrderAccepted", [
    ("order_id", str),
    ("timestamp", int),
])


# --- Algo Result ---

AlgoResult = NamedTuple("AlgoResult", [
    ("state", dict),
    ("orders", tuple),  # tuple of Order or BracketOrder
])


# --- Convenience constructors ---
# Symbol defaults to "" — the runtime fills it in automatically.

def market_buy(qty: int, symbol: str = "") -> Order:
    return Order("BUY", symbol, qty, "MARKET", 0.0, 0.0)


def market_sell(qty: int, symbol: str = "") -> Order:
    return Order("SELL", symbol, qty, "MARKET", 0.0, 0.0)


def limit_buy(qty: int, price: float, symbol: str = "") -> Order:
    return Order("BUY", symbol, qty, "LIMIT", price, 0.0)


def limit_sell(qty: int, price: float, symbol: str = "") -> Order:
    return Order("SELL", symbol, qty, "LIMIT", price, 0.0)


def stop_buy(qty: int, stop_price: float, symbol: str = "") -> Order:
    return Order("BUY", symbol, qty, "STOP", 0.0, stop_price)


def stop_sell(qty: int, stop_price: float, symbol: str = "") -> Order:
    return Order("SELL", symbol, qty, "STOP", 0.0, stop_price)


def modify_order(order_id: str, qty: int = 0, limit_price: float = 0.0, stop_price: float = 0.0) -> ModifyOrder:
    return ModifyOrder(order_id, qty, limit_price, stop_price)


def cancel_order(order_id: str) -> CancelOrder:
    return CancelOrder(order_id)


def bracket(
    side: str,
    qty: int,
    stop_loss_price: float,
    take_profit_price: float,
    symbol: str = "",
) -> BracketOrder:
    entry = Order(side, symbol, qty, "MARKET", 0.0, 0.0)
    exit_side = "SELL" if side == "BUY" else "BUY"
    sl = Order(exit_side, symbol, qty, "STOP", 0.0, stop_loss_price)
    tp = Order(exit_side, symbol, qty, "LIMIT", take_profit_price, 0.0)
    return BracketOrder(symbol, entry, sl, tp)


def log(message: str) -> None:
    """Print a structured log message visible in the Wolf Den log panel.

    Usage in algos: log("entry triggered, z-score: -2.14")
    """
    print(f"[SIGNAL] {message}", flush=True)

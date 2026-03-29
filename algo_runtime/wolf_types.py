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


# --- Algo Result ---

AlgoResult = NamedTuple("AlgoResult", [
    ("state", dict),
    ("orders", tuple),  # tuple of Order or BracketOrder
])


# --- Convenience constructors ---

def market_buy(symbol: str, qty: int) -> Order:
    return Order("BUY", symbol, qty, "MARKET", 0.0, 0.0)


def market_sell(symbol: str, qty: int) -> Order:
    return Order("SELL", symbol, qty, "MARKET", 0.0, 0.0)


def limit_buy(symbol: str, qty: int, price: float) -> Order:
    return Order("BUY", symbol, qty, "LIMIT", price, 0.0)


def limit_sell(symbol: str, qty: int, price: float) -> Order:
    return Order("SELL", symbol, qty, "LIMIT", price, 0.0)


def stop_buy(symbol: str, qty: int, stop_price: float) -> Order:
    return Order("BUY", symbol, qty, "STOP", 0.0, stop_price)


def stop_sell(symbol: str, qty: int, stop_price: float) -> Order:
    return Order("SELL", symbol, qty, "STOP", 0.0, stop_price)


def bracket(
    symbol: str,
    side: str,
    qty: int,
    stop_loss_price: float,
    take_profit_price: float,
) -> BracketOrder:
    entry = Order(side, symbol, qty, "MARKET", 0.0, 0.0)
    exit_side = "SELL" if side == "BUY" else "BUY"
    sl = Order(exit_side, symbol, qty, "STOP", 0.0, stop_loss_price)
    tp = Order(exit_side, symbol, qty, "LIMIT", take_profit_price, 0.0)
    return BracketOrder(symbol, entry, sl, tp)

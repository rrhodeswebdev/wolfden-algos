---
name: wolfden-algo
description: Wolf Den algo runtime API — use this skill when creating or editing trading algo files
---

# Wolf Den Algo API

You are editing a Wolf Den trading algo. Follow this contract exactly.

## Rules

1. **Only modify the specific algo file you were opened for.** Do not touch any other files.
2. Every algo file must define a `create_algo()` factory function that returns a dict of handler functions.
3. All imports come from `wolf_types` — never import from `runner` or other modules.
4. Handlers are pure functions: `(state, event, ctx) -> AlgoResult`. No mutation, no side effects (print statements for debugging are OK).
5. Always return an `AlgoResult` from every handler — even when doing nothing: `AlgoResult(state, ())`.
6. Orders use an empty tuple `()` when there are none, not an empty list.
7. State is a plain dict. Return a new dict via spread (`{**state, "key": value}`), never mutate in place.

## Factory Pattern

```python
from wolf_types import (
    AlgoResult, Tick, Bar, Fill, Context, OrderAccepted,
    market_buy, market_sell, limit_buy, limit_sell,
    stop_buy, stop_sell, modify_order, cancel_order, bracket,
)


def create_algo(qty: int = 1):
    """Factory — return a dict of handler functions."""

    def init() -> dict:
        """Return initial state dict. Called once on startup."""
        return {"my_field": 0}

    def on_tick(state: dict, tick: Tick, ctx: Context) -> AlgoResult:
        """Called on every tick. Optional — omit if not needed."""
        return AlgoResult(state, ())

    def on_bar(state: dict, bar: Bar, ctx: Context) -> AlgoResult:
        """Called on every bar close. Optional — omit if not needed."""
        return AlgoResult(state, ())

    def on_fill(state: dict, fill: Fill, ctx: Context) -> AlgoResult:
        """Called when an order is filled."""
        return AlgoResult(state, ())

    def on_order_accepted(state: dict, event: OrderAccepted, ctx: Context) -> AlgoResult:
        """Called when a submitted order is acknowledged."""
        return AlgoResult(state, ())

    return {
        "init": init,
        "on_tick": on_tick,
        "on_bar": on_bar,
        "on_fill": on_fill,
        "on_order_accepted": on_order_accepted,
    }
```

**Required handlers:** `init` and at least one of `on_tick` or `on_bar`. The others are optional — the runtime provides no-op defaults.

## Types

### Market Data

```python
Tick = NamedTuple("Tick", [
    ("symbol", str),
    ("price", float),
    ("size", int),
    ("timestamp", int),
])

Bar = NamedTuple("Bar", [
    ("symbol", str),
    ("o", float),    # open
    ("h", float),    # high
    ("l", float),    # low
    ("c", float),    # close
    ("v", int),      # volume
    ("timestamp", int),
])
```

### Context (provided by runtime)

```python
Context = NamedTuple("Context", [
    ("symbol", str),
    ("position", int),        # current position size (+ long, - short, 0 flat)
    ("entry_price", float),   # average entry price of current position
    ("unrealized_pnl", float),
])
```

### Orders

```python
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
```

### Fills

```python
Fill = NamedTuple("Fill", [
    ("symbol", str),
    ("side", str),
    ("qty", int),
    ("price", float),
    ("order_id", str),
    ("timestamp", int),
])
```

### Order Management

```python
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
```

### Algo Result

```python
AlgoResult = NamedTuple("AlgoResult", [
    ("state", dict),
    ("orders", tuple),  # tuple of Order, BracketOrder, ModifyOrder, or CancelOrder
])
```

## Convenience Constructors

Symbol defaults to `""` — the runtime fills it in automatically. You almost never need to pass `symbol`.

```python
market_buy(qty: int, symbol: str = "") -> Order
market_sell(qty: int, symbol: str = "") -> Order
limit_buy(qty: int, price: float, symbol: str = "") -> Order
limit_sell(qty: int, price: float, symbol: str = "") -> Order
stop_buy(qty: int, stop_price: float, symbol: str = "") -> Order
stop_sell(qty: int, stop_price: float, symbol: str = "") -> Order
modify_order(order_id: str, qty: int = 0, limit_price: float = 0.0, stop_price: float = 0.0) -> ModifyOrder
cancel_order(order_id: str) -> CancelOrder
bracket(side: str, qty: int, stop_loss_price: float, take_profit_price: float, symbol: str = "") -> BracketOrder
```

## Common Pitfalls

- **Forgetting to return `AlgoResult`**: Every handler must return `AlgoResult(state, orders)`. Returning `None` will crash the runtime.
- **Using a list for orders**: Use a tuple — `(market_buy(1),)` not `[market_buy(1)]`. Note the trailing comma for single-element tuples.
- **Mutating state**: Never do `state["key"] = value`. Always return a new dict: `{**state, "key": value}`.
- **Submitting stops directly on entry**: Place the entry order first, then submit the stop in `on_fill` after the entry is confirmed. Track pending stop info in state.
- **Tracking order IDs**: When you submit a non-market order, the runtime calls `on_order_accepted` with the assigned `order_id`. Save it in state so you can later modify or cancel the order.
- **Not checking `ctx.position`**: Always check current position before entering. You likely don't want to enter long if already long.

## Example

See `algo_runtime/examples/prev_candle_breakout.py` for a complete working algo that demonstrates:
- The `create_algo()` factory with configurable parameters
- Using `on_bar` to track price levels and trail stops
- Using `on_tick` to trigger entries at breakout levels
- Using `on_fill` to submit a protective stop after entry
- Using `on_order_accepted` to capture the stop's order ID for later modification
- Proper state management with spread operator

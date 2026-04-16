---
name: wolfden-algo
description: Wolf Den algo runtime API — use this skill when creating or editing trading algo files
---

# Wolf Den Algo API

You are editing a Wolf Den trading algo. Follow this contract exactly.

## Rules

1. **Only read and modify the specific algo file you were opened for.** Do not read, search, or explore any other files. Everything you need is in this skill.
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

The `create_algo()` function can accept parameters to make your algo configurable:

```python
def create_algo(fast_period=10, slow_period=20):
    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        prices = (*state['prices'], tick.price)[-slow_period:]
        # use fast_period and slow_period in your logic
        ...

    return {'init': init, 'on_tick': on_tick}
```

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

You do not need to track position or entry price in your state — the runtime does it for you from fill events.

```python
Context = NamedTuple("Context", [
    ("symbol", str),
    ("position", int),        # current position size (+ long, - short, 0 flat)
    ("entry_price", float),   # average entry price of current position
    ("unrealized_pnl", float),
])
```

Use `ctx.position` to check your current position:

```python
if ctx.position == 0:   # flat
if ctx.position > 0:    # long
if ctx.position < 0:    # short

# Current P&L on the open position
if ctx.unrealized_pnl < -200:
    # exit if losing more than $200
```

### Orders

Symbol is filled in automatically by the runtime — you never need to specify it.

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

Every handler except `init` must return an `AlgoResult` — the updated state dict and a tuple of orders:

```python
AlgoResult = NamedTuple("AlgoResult", [
    ("state", dict),
    ("orders", tuple),  # tuple of Order, BracketOrder, ModifyOrder, or CancelOrder
])

# No orders
return AlgoResult(new_state, ())

# One order (note trailing comma)
return AlgoResult(new_state, (market_buy(1),))

# Multiple orders
return AlgoResult(new_state, (
    market_buy(1),
    limit_sell(1, price=5450.00),
))
```

## Convenience Constructors

Symbol defaults to `""` — the runtime fills it in automatically. You almost never need to pass `symbol`.

```python
# Market orders — execute immediately at current price
market_buy(qty=1)
market_sell(qty=1)

# Limit orders — execute at a specific price or better
limit_buy(qty=1, price=5400.00)    # buy at 5400 or lower
limit_sell(qty=1, price=5450.00)   # sell at 5450 or higher

# Stop orders — trigger when price reaches stop level
stop_buy(qty=1, stop_price=5460.00)   # buy if price rises to 5460
stop_sell(qty=1, stop_price=5390.00)  # sell if price falls to 5390

# Bracket order — entry with automatic stop loss and take profit
bracket(side="BUY", qty=1,
        stop_loss_price=5390.00,
        take_profit_price=5450.00)

# Order management
modify_order(order_id, qty=0, limit_price=0.0, stop_price=0.0)
cancel_order(order_id)
```

## Entering Trades

Always check `ctx.position` to avoid entering when you already have a position:

```python
def on_tick(state, tick, ctx):
    if ctx.position == 0 and some_buy_signal:
        return AlgoResult(state, (market_buy(1),))

    if ctx.position == 0 and some_sell_signal:
        return AlgoResult(state, (market_sell(1),))

    return AlgoResult(state, ())
```

Use a bracket order to enter with automatic stop loss and take profit. NinjaTrader manages the exit orders — your algo does not need to monitor them:

```python
def on_bar(state, bar, ctx):
    if ctx.position == 0 and buy_signal:
        entry = bracket(
            side="BUY", qty=1,
            stop_loss_price=bar.c - 5.0,
            take_profit_price=bar.c + 10.0,
        )
        return AlgoResult(state, (entry,))

    return AlgoResult(state, ())
```

## Exiting Trades

Submit an order in the opposite direction of your position. Use `ctx.position` to know the current size:

```python
def on_tick(state, tick, ctx):
    # Exit a long position
    if ctx.position > 0 and exit_signal:
        return AlgoResult(state, (market_sell(ctx.position),))

    # Exit a short position
    if ctx.position < 0 and exit_signal:
        return AlgoResult(state, (market_buy(abs(ctx.position)),))

    return AlgoResult(state, ())
```

You can also manage exits with stop and limit orders placed after entry:

```python
def on_tick(state, tick, ctx):
    # Enter and set a stop loss in state
    if ctx.position == 0 and buy_signal:
        new_state = {**state, 'stop_price': tick.price - 5.0}
        return AlgoResult(new_state, (market_buy(1),))

    # Check stop loss manually on each tick
    if ctx.position > 0 and tick.price <= state.get('stop_price', 0):
        return AlgoResult(state, (market_sell(ctx.position),))

    return AlgoResult(state, ())
```

## State Management

State is a plain dict that persists across handler calls within a single instance. Keep it immutable — use tuples instead of lists, and return a new dict rather than mutating the existing one:

```python
def on_tick(state, tick, ctx):
    # Append to a tuple (immutable) and keep a sliding window
    prices = (*state['prices'], tick.price)[-20:]
    new_state = {**state, 'prices': prices}
    return AlgoResult(new_state, ())
```

Each algo instance has its own isolated state. If the same algo runs on two different charts, they do not share state — each starts fresh from `init()`.

## Tick vs Bar Strategies

You can define both `on_tick` and `on_bar` in the same algo. A common pattern is to accumulate indicator data in `on_bar` and make trading decisions in `on_tick`:

```python
def create_algo(atr_period=14):
    def init():
        return {
            'highs': (),
            'lows': (),
            'closes': (),
            'stop_price': 0.0,
        }

    def on_bar(state, bar, ctx):
        # Accumulate bar data for indicators
        highs = (*state['highs'], bar.h)[-(atr_period + 2):]
        lows = (*state['lows'], bar.l)[-(atr_period + 2):]
        closes = (*state['closes'], bar.c)[-(atr_period + 2):]
        return AlgoResult({**state,
            'highs': highs, 'lows': lows, 'closes': closes,
        }, ())

    def on_tick(state, tick, ctx):
        # Use accumulated data for real-time decisions
        if ctx.position > 0 and tick.price <= state['stop_price']:
            return AlgoResult(state, (market_sell(ctx.position),))
        return AlgoResult(state, ())

    return {'init': init, 'on_bar': on_bar, 'on_tick': on_tick}
```

If your algo only needs bar data, define just `on_bar` and omit `on_tick`. The same applies in reverse.

## Risk Management

Wolf Den enforces risk limits at two layers.

**Runtime layer** (configured per-instance, cannot be bypassed):
- **Max Position Size** — Orders that would exceed this size are silently rejected.
- **Max Daily Loss** — When cumulative daily loss reaches this limit, all further orders are rejected and the instance halts.
- **Max Daily Trades** — When trade count reaches this limit, no further orders are accepted.

You can also build additional risk management directly into your algo logic. Orders rejected by the runtime risk manager are silently dropped — your algo will not receive a fill event for them:

```python
def on_tick(state, tick, ctx):
    # Custom daily P&L tracking
    if state.get('daily_pnl', 0) <= -300:
        return AlgoResult(state, ())  # halt trading

    # Custom cooldown after a trade
    ticks_since = state.get('ticks_since_trade', 0) + 1
    if ticks_since < 100:
        return AlgoResult({**state, 'ticks_since_trade': ticks_since}, ())
    ...
```

## Common Pitfalls

- **Forgetting to return `AlgoResult`**: Every handler must return `AlgoResult(state, orders)`. Returning `None` will crash the runtime.
- **Using a list for orders**: Use a tuple — `(market_buy(1),)` not `[market_buy(1)]`. Note the trailing comma for single-element tuples.
- **Mutating state**: Never do `state["key"] = value`. Always return a new dict: `{**state, "key": value}`.
- **Submitting stops directly on entry**: Place the entry order first, then submit the stop in `on_fill` after the entry is confirmed. Track pending stop info in state.
- **Tracking order IDs**: When you submit a non-market order, the runtime calls `on_order_accepted` with the assigned `order_id`. Save it in state so you can later modify or cancel the order.
- **Not checking `ctx.position`**: Always check current position before entering. You likely don't want to enter long if already long.

## Example: Simple SMA Crossover

A minimal but functional algo that enters on moving average crossovers:

```python
from wolf_types import AlgoResult, market_buy, market_sell


def create_algo(fast_period=10, slow_period=20):

    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        prices = (*state['prices'], tick.price)[-slow_period:]
        new_state = {**state, 'prices': prices}

        if len(prices) < slow_period:
            return AlgoResult(new_state, ())

        fast_sma = sum(prices[-fast_period:]) / fast_period
        slow_sma = sum(prices) / slow_period

        if fast_sma > slow_sma and ctx.position <= 0:
            return AlgoResult(new_state, (market_buy(1),))
        if fast_sma < slow_sma and ctx.position >= 0:
            return AlgoResult(new_state, (market_sell(1),))

        return AlgoResult(new_state, ())

    return {'init': init, 'on_tick': on_tick}
```

## Example: Previous Candle Breakout with Trailing Stop

A more advanced algo demonstrating `on_fill`, `on_order_accepted`, stop management, and order modification:

```python
from wolf_types import AlgoResult, market_buy, market_sell, stop_buy, stop_sell, modify_order


def create_algo(qty: int = 1, tick_size: float = 0.25):
    """Enters long at prev candle high, short at prev candle low.
    Places a stop loss after fill, trails the stop on each new bar."""

    stop_offset = 4 * tick_size

    def init() -> dict:
        return {
            "prev_high": 0.0,
            "prev_low": 0.0,
            "has_levels": False,
            "entered_this_bar": False,
            "pending_stop": None,
            "awaiting_stop_ack": False,
            "stop_order_id": None,
        }

    def on_bar(state, bar, ctx):
        orders = ()

        # Trail the stop to the new bar's level if we have a working stop
        stop_id = state.get("stop_order_id")
        if stop_id and ctx.position != 0:
            if ctx.position > 0:
                new_stop = bar.l - stop_offset
                orders = (modify_order(stop_id, qty=qty, stop_price=new_stop),)
            elif ctx.position < 0:
                new_stop = bar.h + stop_offset
                orders = (modify_order(stop_id, qty=qty, stop_price=new_stop),)

        return AlgoResult(
            {
                **state,
                "prev_high": bar.h,
                "prev_low": bar.l,
                "has_levels": True,
                "entered_this_bar": False,
            },
            orders,
        )

    def on_tick(state, tick, ctx):
        if not state["has_levels"] or ctx.position != 0 or state["entered_this_bar"]:
            return AlgoResult(state, ())

        prev_high = state["prev_high"]
        prev_low = state["prev_low"]

        if tick.price >= prev_high:
            stop_price = prev_low - stop_offset
            new_state = {
                **state,
                "entered_this_bar": True,
                "pending_stop": {"side": "SELL", "price": stop_price},
            }
            return AlgoResult(new_state, (market_buy(qty),))

        if tick.price <= prev_low:
            stop_price = prev_high + stop_offset
            new_state = {
                **state,
                "entered_this_bar": True,
                "pending_stop": {"side": "BUY", "price": stop_price},
            }
            return AlgoResult(new_state, (market_sell(qty),))

        return AlgoResult(state, ())

    def on_fill(state, fill, ctx):
        pending = state.get("pending_stop")
        if pending is None:
            # Stop was filled — position is flat, clear tracking
            if ctx.position == 0:
                new_state = {**state, "stop_order_id": None, "awaiting_stop_ack": False}
                return AlgoResult(new_state, ())
            return AlgoResult(state, ())

        new_state = {**state, "pending_stop": None, "awaiting_stop_ack": True}

        if pending["side"] == "SELL":
            return AlgoResult(new_state, (stop_sell(qty, pending["price"]),))
        return AlgoResult(new_state, (stop_buy(qty, pending["price"]),))

    def on_order_accepted(state, event, ctx):
        if state.get("awaiting_stop_ack"):
            return AlgoResult(
                {**state, "stop_order_id": event.order_id, "awaiting_stop_ack": False},
                (),
            )
        return AlgoResult(state, ())

    return {
        "init": init,
        "on_tick": on_tick,
        "on_bar": on_bar,
        "on_fill": on_fill,
        "on_order_accepted": on_order_accepted,
    }
```

"""Previous Candle Breakout algo.

Enters long when the current tick hits the previous candle's high,
short when it hits the previous candle's low.  A stop loss is placed
after the entry fill — 4 ticks beyond the opposite side of the
previous candle (configurable via tick_size).

The stop trails on each new bar: for longs it moves up to prev_low
minus the offset, for shorts it moves down to prev_high plus the offset.

Pure functional style — all handlers are stateless transforms.
"""

from wolf_types import AlgoResult, market_buy, market_sell, stop_buy, stop_sell, modify_order


def create_algo(qty: int = 1, tick_size: float = 0.25):
    """Factory function returning a dict of pure handler functions.

    Parameters
    ----------
    qty : int
        Contracts per entry (default 1).
    tick_size : float
        Instrument tick size used for stop loss offset (default 0.25 for ES).
    """

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
        print(f"[breakout] Bar closed — high={bar.h} low={bar.l} | Next entry: long >= {bar.h}, short <= {bar.l}")
        orders = ()

        # Trail the stop to the new bar's level if we have a working stop
        stop_id = state.get("stop_order_id")
        if stop_id and ctx.position != 0:
            if ctx.position > 0:
                new_stop = bar.l - stop_offset
                print(f"[breakout] Trailing stop UP to {new_stop} (prev_low={bar.l})")
                orders = (modify_order(stop_id, qty=qty, stop_price=new_stop),)
            elif ctx.position < 0:
                new_stop = bar.h + stop_offset
                print(f"[breakout] Trailing stop DOWN to {new_stop} (prev_high={bar.h})")
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
            print(f"[breakout] LONG entry @ {tick.price} (prev_high={prev_high}) | stop={stop_price}")
            new_state = {
                **state,
                "entered_this_bar": True,
                "pending_stop": {"side": "SELL", "price": stop_price},
            }
            return AlgoResult(new_state, (market_buy(qty),))

        if tick.price <= prev_low:
            stop_price = prev_high + stop_offset
            print(f"[breakout] SHORT entry @ {tick.price} (prev_low={prev_low}) | stop={stop_price}")
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
            print(f"[breakout] Stop order accepted: {event.order_id}")
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

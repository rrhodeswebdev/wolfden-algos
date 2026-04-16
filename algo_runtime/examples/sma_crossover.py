"""Simple Moving Average Crossover algo with ATR-based risk management.

Computes SMA crossover signals on bars (not ticks) to avoid redundant
indicator recalculation across ~20K ticks/day.  Uses ATR to set stop-loss
(1.5 ATR) and take-profit (2.5 ATR) levels, checked on every tick.
Pure functional style — all handlers are stateless transforms.
"""

from wolf_types import AlgoResult, market_buy, market_sell


def create_algo(
    fast_period: int = 10,
    slow_period: int = 20,
    atr_period: int = 14,
):
    """Factory function returning a dict of pure handler functions."""

    def _compute_atr(highs, lows, closes):
        if len(closes) < 2:
            return 0.0
        trs = []
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
            trs.append(tr)
        if not trs:
            return 0.0
        atr_val = trs[0]
        k = 2.0 / (atr_period + 1)
        for tr in trs[1:]:
            atr_val = tr * k + atr_val * (1 - k)
        return atr_val

    def init() -> dict:
        return {
            "closes": (),
            "highs": (),
            "lows": (),
            "stop_price": 0.0,
            "target_price": 0.0,
            "entry_price": 0.0,
        }

    def on_bar(state, bar, ctx):
        closes = (*state["closes"], bar.c)[-slow_period:]
        highs = (*state["highs"], bar.h)[-(atr_period + 2):]
        lows = (*state["lows"], bar.l)[-(atr_period + 2):]
        new_state = {**state, "closes": closes, "highs": highs, "lows": lows}

        if len(closes) < slow_period:
            return AlgoResult(new_state, ())

        fast_sma = sum(closes[-fast_period:]) / fast_period
        slow_sma = sum(closes) / slow_period
        atr = _compute_atr(highs, lows, closes)

        orders = ()
        if fast_sma > slow_sma and ctx.position <= 0:
            entry = bar.c
            new_state = {
                **new_state,
                "entry_price": entry,
                "stop_price": entry - 1.5 * atr,
                "target_price": entry + 2.5 * atr,
            }
            orders = (market_buy(1),)
        elif fast_sma < slow_sma and ctx.position >= 0:
            entry = bar.c
            new_state = {
                **new_state,
                "entry_price": entry,
                "stop_price": entry + 1.5 * atr,
                "target_price": entry - 2.5 * atr,
            }
            orders = (market_sell(1),)

        return AlgoResult(new_state, orders)

    def on_tick(state, tick, ctx):
        if ctx.position == 0:
            return AlgoResult(state, ())

        stop = state["stop_price"]
        target = state["target_price"]
        price = tick.price

        if ctx.position > 0:
            if price <= stop:
                return AlgoResult(state, (market_sell(1),))
            if price >= target:
                return AlgoResult(state, (market_sell(1),))
        elif ctx.position < 0:
            if price >= stop:
                return AlgoResult(state, (market_buy(1),))
            if price <= target:
                return AlgoResult(state, (market_buy(1),))

        return AlgoResult(state, ())

    return {"init": init, "on_bar": on_bar, "on_tick": on_tick}

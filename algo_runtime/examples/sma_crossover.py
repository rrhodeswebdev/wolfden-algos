"""Simple Moving Average Crossover algo.

Buys when fast SMA crosses above slow SMA, sells on the opposite.
Pure functional style — all handlers are stateless transforms.
"""

from wolf_types import AlgoResult, market_buy, market_sell


def create_algo(fast_period: int = 10, slow_period: int = 20):
    """Factory function returning a dict of pure handler functions."""

    def init() -> dict:
        return {"prices": ()}

    def on_tick(state, tick, ctx):
        prices = (*state["prices"], tick.price)[-slow_period:]
        new_state = {**state, "prices": prices}

        if len(prices) < slow_period:
            return AlgoResult(new_state, ())

        fast_sma = sum(prices[-fast_period:]) / fast_period
        slow_sma = sum(prices) / slow_period

        orders = ()
        if fast_sma > slow_sma and ctx.position <= 0:
            orders = (market_buy(1),)
        elif fast_sma < slow_sma and ctx.position >= 0:
            orders = (market_sell(1),)

        return AlgoResult(new_state, orders)

    return {"init": init, "on_tick": on_tick}

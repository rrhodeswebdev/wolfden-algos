"""Simple Moving Average Crossover algo.

Buys when fast SMA crosses above slow SMA, sells on the opposite.
Pure functional style — all handlers are stateless transforms.
"""

from wolf_types import Tick, Bar, Fill, Order, AlgoResult, market_buy, market_sell


def create_algo(fast_period: int = 10, slow_period: int = 20):
    """Factory function returning a dict of pure handler functions."""

    def init() -> dict:
        return {"prices": (), "position": 0}

    def on_tick(state: dict, tick: Tick) -> AlgoResult:
        prices = (*state["prices"], tick.price)[-slow_period:]
        new_state = {**state, "prices": prices}

        if len(prices) < slow_period:
            return AlgoResult(new_state, ())

        fast_sma = sum(prices[-fast_period:]) / fast_period
        slow_sma = sum(prices) / slow_period

        orders: tuple = ()
        if fast_sma > slow_sma and state["position"] <= 0:
            orders = (market_buy(tick.symbol, 1),)
            new_state = {**new_state, "position": 1}
        elif fast_sma < slow_sma and state["position"] >= 0:
            orders = (market_sell(tick.symbol, 1),)
            new_state = {**new_state, "position": -1}

        return AlgoResult(new_state, orders)

    def on_bar(state: dict, bar: Bar) -> AlgoResult:
        return AlgoResult(state, ())

    def on_fill(state: dict, fill: Fill) -> AlgoResult:
        return AlgoResult(state, ())

    return {"init": init, "on_tick": on_tick, "on_bar": on_bar, "on_fill": on_fill}

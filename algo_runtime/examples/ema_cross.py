"""EMA Crossover algo with ATR-based risk management.

Enters long when fast EMA crosses above slow EMA, short on the opposite.
Uses ATR for dynamic stop loss and take profit placement.
Trailing stop activates after price moves 1 ATR in favorable direction.

Pure functional style — all state flows through immutable transforms.
"""

from wolf_types import Tick, Bar, Fill, Order, AlgoResult, BracketOrder, market_buy, market_sell, stop_buy, stop_sell, limit_buy, limit_sell, bracket


def create_algo(
    fast_period: int = 9,
    slow_period: int = 21,
    atr_period: int = 14,
    stop_atr_mult: float = 1.5,
    target_atr_mult: float = 2.5,
    trail_activation_atr: float = 1.0,
    trail_distance_atr: float = 1.0,
    max_daily_loss: float = 500.0,
    cooldown_ticks: int = 50,
):
    """EMA crossover with ATR stops, trailing stop, and daily loss limit."""

    def init() -> dict:
        return {
            "prices": (),
            "highs": (),
            "lows": (),
            "closes": (),
            "position": 0,
            "entry_price": 0.0,
            "stop_price": 0.0,
            "target_price": 0.0,
            "trail_active": False,
            "best_price": 0.0,
            "ticks_since_last_trade": cooldown_ticks,
            "daily_pnl": 0.0,
            "daily_halted": False,
        }

    def _ema_step(prev_ema, price, period):
        k = 2.0 / (period + 1)
        return price * k + prev_ema * (1 - k)

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

    def on_tick(state: dict, tick: Tick) -> AlgoResult:
        prices = (*state["prices"], tick.price)[-(slow_period + 5):]
        ticks_since = state["ticks_since_last_trade"] + 1
        new_state = {**state, "prices": prices, "ticks_since_last_trade": ticks_since}

        if state["daily_halted"]:
            return AlgoResult(new_state, ())

        if len(prices) < slow_period:
            return AlgoResult(new_state, ())

        # Compute EMAs
        fast_ema = sum(prices[-fast_period:]) / fast_period
        for p in prices[-fast_period:]:
            fast_ema = _ema_step(fast_ema, p, fast_period)

        slow_ema = sum(prices[-slow_period:]) / slow_period
        for p in prices[-slow_period:]:
            slow_ema = _ema_step(slow_ema, p, slow_period)

        prev_prices = prices[:-1]
        if len(prev_prices) >= slow_period:
            prev_fast = sum(prev_prices[-fast_period:]) / fast_period
            for p in prev_prices[-fast_period:]:
                prev_fast = _ema_step(prev_fast, p, fast_period)
            prev_slow = sum(prev_prices[-slow_period:]) / slow_period
            for p in prev_prices[-slow_period:]:
                prev_slow = _ema_step(prev_slow, p, slow_period)
        else:
            return AlgoResult(new_state, ())

        position = state["position"]
        orders = ()

        # --- Position management ---

        if position != 0:
            direction = 1 if position > 0 else -1
            entry = state["entry_price"]
            stop = state["stop_price"]
            target = state["target_price"]
            best = state["best_price"]

            # Update best price for trailing stop
            if direction == 1:
                best = max(best, tick.price)
            else:
                best = min(best, tick.price)

            # Check trailing stop activation
            atr_val = _compute_atr(state["highs"], state["lows"], state["closes"])
            trail_active = state["trail_active"]
            favorable_move = (best - entry) * direction

            if not trail_active and atr_val > 0 and favorable_move >= atr_val * trail_activation_atr:
                trail_active = True

            if trail_active and atr_val > 0:
                trail_dist = atr_val * trail_distance_atr
                if direction == 1:
                    new_stop = best - trail_dist
                    stop = max(stop, new_stop)
                else:
                    new_stop = best + trail_dist
                    stop = min(stop, new_stop)

            # Check stop hit
            if direction == 1 and tick.price <= stop:
                orders = (market_sell(tick.symbol, abs(position)),)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "trail_active": False, "best_price": 0.0,
                             "ticks_since_last_trade": 0}
                pnl = (tick.price - entry) * abs(position) * 50.0
                new_state = {**new_state, "daily_pnl": state["daily_pnl"] + pnl}
                if new_state["daily_pnl"] <= -max_daily_loss:
                    new_state = {**new_state, "daily_halted": True}
                return AlgoResult(new_state, orders)

            if direction == -1 and tick.price >= stop:
                orders = (market_buy(tick.symbol, abs(position)),)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "trail_active": False, "best_price": 0.0,
                             "ticks_since_last_trade": 0}
                pnl = (entry - tick.price) * abs(position) * 50.0
                new_state = {**new_state, "daily_pnl": state["daily_pnl"] + pnl}
                if new_state["daily_pnl"] <= -max_daily_loss:
                    new_state = {**new_state, "daily_halted": True}
                return AlgoResult(new_state, orders)

            # Check target hit
            if direction == 1 and tick.price >= target:
                orders = (market_sell(tick.symbol, abs(position)),)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "trail_active": False, "best_price": 0.0,
                             "ticks_since_last_trade": 0}
                pnl = (tick.price - entry) * abs(position) * 50.0
                new_state = {**new_state, "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(new_state, orders)

            if direction == -1 and tick.price <= target:
                orders = (market_buy(tick.symbol, abs(position)),)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "trail_active": False, "best_price": 0.0,
                             "ticks_since_last_trade": 0}
                pnl = (entry - tick.price) * abs(position) * 50.0
                new_state = {**new_state, "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(new_state, orders)

            # Opposite crossover exit
            if direction == 1 and fast_ema < slow_ema and prev_fast >= prev_slow:
                orders = (market_sell(tick.symbol, abs(position)),)
                pnl = (tick.price - entry) * abs(position) * 50.0
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "trail_active": False, "best_price": 0.0,
                             "ticks_since_last_trade": 0,
                             "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(new_state, orders)

            if direction == -1 and fast_ema > slow_ema and prev_fast <= prev_slow:
                orders = (market_buy(tick.symbol, abs(position)),)
                pnl = (entry - tick.price) * abs(position) * 50.0
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "trail_active": False, "best_price": 0.0,
                             "ticks_since_last_trade": 0,
                             "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(new_state, orders)

            new_state = {**new_state, "stop_price": stop, "trail_active": trail_active, "best_price": best}
            return AlgoResult(new_state, ())

        # --- Entry signals (flat) ---

        if ticks_since < cooldown_ticks:
            return AlgoResult(new_state, ())

        atr_val = _compute_atr(state["highs"], state["lows"], state["closes"])
        if atr_val <= 0:
            return AlgoResult(new_state, ())

        cross_above = prev_fast <= prev_slow and fast_ema > slow_ema
        cross_below = prev_fast >= prev_slow and fast_ema < slow_ema

        if cross_above and tick.price > slow_ema:
            stop = tick.price - atr_val * stop_atr_mult
            target = tick.price + atr_val * target_atr_mult
            orders = (market_buy(tick.symbol, 1),)
            new_state = {**new_state, "position": 1, "entry_price": tick.price,
                         "stop_price": stop, "target_price": target,
                         "trail_active": False, "best_price": tick.price,
                         "ticks_since_last_trade": 0}
            return AlgoResult(new_state, orders)

        if cross_below and tick.price < slow_ema:
            stop = tick.price + atr_val * stop_atr_mult
            target = tick.price - atr_val * target_atr_mult
            orders = (market_sell(tick.symbol, 1),)
            new_state = {**new_state, "position": -1, "entry_price": tick.price,
                         "stop_price": stop, "target_price": target,
                         "trail_active": False, "best_price": tick.price,
                         "ticks_since_last_trade": 0}
            return AlgoResult(new_state, orders)

        return AlgoResult(new_state, ())

    def on_bar(state: dict, bar: Bar) -> AlgoResult:
        highs = (*state["highs"], bar.h)[-(atr_period + 2):]
        lows = (*state["lows"], bar.l)[-(atr_period + 2):]
        closes = (*state["closes"], bar.c)[-(atr_period + 2):]
        new_state = {**state, "highs": highs, "lows": lows, "closes": closes}
        return AlgoResult(new_state, ())

    def on_fill(state: dict, fill: Fill) -> AlgoResult:
        return AlgoResult(state, ())

    return {"init": init, "on_tick": on_tick, "on_bar": on_bar, "on_fill": on_fill}

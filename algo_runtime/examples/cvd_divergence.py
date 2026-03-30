"""Cumulative Volume Delta Divergence algo.

Detects divergence between price swing points and cumulative volume delta:
  - Bearish: price makes higher high, CVD makes lower high (distribution)
  - Bullish: price makes lower low, CVD makes higher low (accumulation)

Uses RSI and volume filters for confirmation. Time-based exit for stale trades.

Pure functional style — all state flows through immutable transforms.
"""

from wolf_types import AlgoResult, market_buy, market_sell


def create_algo(
    swing_lookback: int = 10,
    divergence_threshold: float = 0.3,
    rsi_period: int = 14,
    rsi_overbought: float = 70.0,
    rsi_oversold: float = 30.0,
    volume_avg_period: int = 20,
    stop_beyond_swing: float = 1.0,
    min_reward_risk: float = 2.0,
    max_hold_ticks: int = 3000,
    cooldown_ticks: int = 100,
    max_daily_loss: float = 500.0,
):
    """CVD divergence with RSI confirmation and time-based exits."""

    def init() -> dict:
        return {
            "ticks": (),
            "bars": (),
            "cvd": 0.0,
            "cvd_history": (),
            "price_swing_highs": (),
            "price_swing_lows": (),
            "cvd_swing_highs": (),
            "cvd_swing_lows": (),
            "volumes": (),
            "closes": (),
            "stop_price": 0.0,
            "target_price": 0.0,
            "ticks_in_trade": 0,
            "ticks_since_last_trade": cooldown_ticks,
            "daily_pnl": 0.0,
            "daily_halted": False,
            "last_price": 0.0,
        }

    def _classify_trade(price, last_price):
        if price > last_price:
            return 1
        elif price < last_price:
            return -1
        return 0

    def _compute_rsi(closes):
        if len(closes) < rsi_period + 1:
            return 50.0
        gains = []
        losses = []
        for i in range(1, len(closes)):
            diff = closes[i] - closes[i - 1]
            gains.append(max(diff, 0.0))
            losses.append(max(-diff, 0.0))
        if len(gains) < rsi_period:
            return 50.0
        avg_gain = sum(gains[-rsi_period:]) / rsi_period
        avg_loss = sum(losses[-rsi_period:]) / rsi_period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def _find_swing_highs(prices, lookback):
        swings = ()
        for i in range(lookback, len(prices) - lookback):
            window = prices[i - lookback : i + lookback + 1]
            if prices[i] == max(window) and prices[i] > prices[i - 1]:
                swings = (*swings, (i, prices[i]))
        return swings

    def _find_swing_lows(prices, lookback):
        swings = ()
        for i in range(lookback, len(prices) - lookback):
            window = prices[i - lookback : i + lookback + 1]
            if prices[i] == min(window) and prices[i] < prices[i - 1]:
                swings = (*swings, (i, prices[i]))
        return swings

    def _detect_bearish_divergence(price_highs, cvd_highs):
        if len(price_highs) < 2 or len(cvd_highs) < 2:
            return False, 0.0
        p_prev, p_recent = price_highs[-2][1], price_highs[-1][1]
        c_prev, c_recent = cvd_highs[-2][1], cvd_highs[-1][1]
        if p_recent > p_prev and c_recent < c_prev:
            p_change = abs(p_recent - p_prev) / max(abs(p_prev), 0.01)
            c_change = abs(c_prev - c_recent) / max(abs(c_prev), 0.01)
            strength = min(p_change + c_change, 1.0)
            return True, strength
        return False, 0.0

    def _detect_bullish_divergence(price_lows, cvd_lows):
        if len(price_lows) < 2 or len(cvd_lows) < 2:
            return False, 0.0
        p_prev, p_recent = price_lows[-2][1], price_lows[-1][1]
        c_prev, c_recent = cvd_lows[-2][1], cvd_lows[-1][1]
        if p_recent < p_prev and c_recent > c_prev:
            p_change = abs(p_prev - p_recent) / max(abs(p_prev), 0.01)
            c_change = abs(c_recent - c_prev) / max(abs(c_prev), 0.01)
            strength = min(p_change + c_change, 1.0)
            return True, strength
        return False, 0.0

    def on_tick(state, tick, ctx):
        last_price = state["last_price"] if state["last_price"] > 0 else tick.price
        delta = _classify_trade(tick.price, last_price) * tick.size
        cvd = state["cvd"] + delta
        ticks_since = state["ticks_since_last_trade"] + 1

        new_state = {**state, "cvd": cvd, "last_price": tick.price,
                     "ticks_since_last_trade": ticks_since}

        if state["daily_halted"]:
            return AlgoResult(new_state, ())

        position = ctx.position

        # --- Position management ---

        if position != 0:
            direction = 1 if position > 0 else -1
            ticks_in_trade = state["ticks_in_trade"] + 1
            new_state = {**new_state, "ticks_in_trade": ticks_in_trade}

            flat_state = {**new_state, "stop_price": 0.0, "target_price": 0.0,
                         "ticks_in_trade": 0, "ticks_since_last_trade": 0}

            # Time exit
            if ticks_in_trade >= max_hold_ticks:
                if direction == 1:
                    orders = (market_sell(abs(position)),)
                else:
                    orders = (market_buy(abs(position)),)
                pnl = (tick.price - ctx.entry_price) * direction * abs(position) * 50.0
                flat_state = {**flat_state, "daily_pnl": state["daily_pnl"] + pnl}
                if flat_state["daily_pnl"] <= -max_daily_loss:
                    flat_state = {**flat_state, "daily_halted": True}
                return AlgoResult(flat_state, orders)

            # Stop loss
            stop = state["stop_price"]
            if direction == 1 and tick.price <= stop:
                pnl = (tick.price - ctx.entry_price) * abs(position) * 50.0
                flat_state = {**flat_state, "daily_pnl": state["daily_pnl"] + pnl}
                if flat_state["daily_pnl"] <= -max_daily_loss:
                    flat_state = {**flat_state, "daily_halted": True}
                return AlgoResult(flat_state, (market_sell(abs(position)),))

            if direction == -1 and tick.price >= stop:
                pnl = (ctx.entry_price - tick.price) * abs(position) * 50.0
                flat_state = {**flat_state, "daily_pnl": state["daily_pnl"] + pnl}
                if flat_state["daily_pnl"] <= -max_daily_loss:
                    flat_state = {**flat_state, "daily_halted": True}
                return AlgoResult(flat_state, (market_buy(abs(position)),))

            # Take profit
            target = state["target_price"]
            if direction == 1 and tick.price >= target:
                pnl = (tick.price - ctx.entry_price) * abs(position) * 50.0
                flat_state = {**flat_state, "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(flat_state, (market_sell(abs(position)),))

            if direction == -1 and tick.price <= target:
                pnl = (ctx.entry_price - tick.price) * abs(position) * 50.0
                flat_state = {**flat_state, "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(flat_state, (market_buy(abs(position)),))

            return AlgoResult(new_state, ())

        # --- Entry signals (flat) ---

        if ticks_since < cooldown_ticks:
            return AlgoResult(new_state, ())

        return AlgoResult(new_state, ())

    def on_bar(state, bar, ctx):
        bars = (*state["bars"], bar)[-(swing_lookback * 6):]
        closes = (*state["closes"], bar.c)[-(rsi_period + 5):]
        volumes = (*state["volumes"], bar.v)[-(volume_avg_period + 2):]

        bar_delta = (bar.c - bar.o) / max(bar.h - bar.l, 0.01) * bar.v
        cvd = state["cvd"] + bar_delta
        cvd_history = (*state["cvd_history"], cvd)[-(swing_lookback * 6):]

        bar_highs = tuple(b.h for b in bars)
        bar_lows = tuple(b.l for b in bars)

        price_swing_highs = _find_swing_highs(bar_highs, swing_lookback)
        price_swing_lows = _find_swing_lows(bar_lows, swing_lookback)
        cvd_swing_highs = _find_swing_highs(cvd_history, swing_lookback)
        cvd_swing_lows = _find_swing_lows(cvd_history, swing_lookback)

        new_state = {**state, "bars": bars, "closes": closes, "volumes": volumes,
                     "cvd": cvd, "cvd_history": cvd_history,
                     "price_swing_highs": price_swing_highs,
                     "price_swing_lows": price_swing_lows,
                     "cvd_swing_highs": cvd_swing_highs,
                     "cvd_swing_lows": cvd_swing_lows}

        if state["daily_halted"] or ctx.position != 0:
            return AlgoResult(new_state, ())

        if state["ticks_since_last_trade"] < cooldown_ticks:
            return AlgoResult(new_state, ())

        rsi_val = _compute_rsi(closes)

        avg_vol = sum(volumes) / len(volumes) if volumes else 0
        if avg_vol > 0 and bar.v < avg_vol:
            return AlgoResult(new_state, ())

        # Bearish divergence -> short
        bearish, bear_strength = _detect_bearish_divergence(price_swing_highs, cvd_swing_highs)
        if bearish and bear_strength >= divergence_threshold and rsi_val >= rsi_overbought:
            swing_high = max(b.h for b in bars[-swing_lookback * 3:]) if bars else bar.h
            stop_dist = abs(swing_high - bar.c) + stop_beyond_swing
            target_dist = max(stop_dist * min_reward_risk, 4.0)

            new_state = {**new_state, "stop_price": bar.c + stop_dist,
                         "target_price": bar.c - target_dist,
                         "ticks_in_trade": 0, "ticks_since_last_trade": 0}
            return AlgoResult(new_state, (market_sell(1),))

        # Bullish divergence -> long
        bullish, bull_strength = _detect_bullish_divergence(price_swing_lows, cvd_swing_lows)
        if bullish and bull_strength >= divergence_threshold and rsi_val <= rsi_oversold:
            swing_low = min(b.l for b in bars[-swing_lookback * 3:]) if bars else bar.l
            stop_dist = abs(bar.c - swing_low) + stop_beyond_swing
            target_dist = max(stop_dist * min_reward_risk, 4.0)

            new_state = {**new_state, "stop_price": bar.c - stop_dist,
                         "target_price": bar.c + target_dist,
                         "ticks_in_trade": 0, "ticks_since_last_trade": 0}
            return AlgoResult(new_state, (market_buy(1),))

        return AlgoResult(new_state, ())

    return {"init": init, "on_tick": on_tick, "on_bar": on_bar}

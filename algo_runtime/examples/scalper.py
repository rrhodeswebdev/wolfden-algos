"""Mean-reversion scalper algo.

Enters at Bollinger Band extremes with VWAP proximity and RSI confirmation.
Tight stops, quick targets, breakeven management, and tilt protection.
Designed for liquid futures on 1-minute bars.

Pure functional style — all state flows through immutable transforms.
"""

from wolf_types import Tick, Bar, Fill, Order, AlgoResult, market_buy, market_sell


def create_algo(
    bb_period: int = 20,
    bb_std_dev: float = 2.0,
    rsi_period: int = 7,
    atr_period: int = 10,
    stop_atr_mult: float = 1.0,
    target_atr_mult: float = 1.5,
    min_stop_ticks: int = 2,
    max_stop_ticks: int = 8,
    min_target_ticks: int = 3,
    tick_size: float = 0.25,
    breakeven_atr_mult: float = 0.5,
    max_hold_ticks: int = 2000,
    volume_spike_mult: float = 1.5,
    max_trades_per_session: int = 20,
    max_daily_loss: float = 300.0,
    tilt_lookback: int = 10,
    tilt_min_win_rate: float = 0.33,
    tilt_pause_ticks: int = 500,
):
    """Bollinger Band mean-reversion scalper with tilt protection."""

    def init() -> dict:
        return {
            "bars": (),
            "closes": (),
            "volumes": (),
            "highs": (),
            "lows": (),
            "position": 0,
            "entry_price": 0.0,
            "stop_price": 0.0,
            "target_price": 0.0,
            "breakeven_set": False,
            "best_price": 0.0,
            "ticks_in_trade": 0,
            "session_trades": 0,
            "trade_results": (),
            "daily_pnl": 0.0,
            "daily_halted": False,
            "tilt_paused_until": 0,
            "tick_count": 0,
            "cum_tp_vol": 0.0,
            "cum_vol": 0,
        }

    def _compute_sma(values, period):
        if len(values) < period:
            return None
        return sum(values[-period:]) / period

    def _compute_std(values, period):
        if len(values) < period:
            return None
        data = values[-period:]
        mean = sum(data) / period
        variance = sum((x - mean) ** 2 for x in data) / period
        return variance ** 0.5

    def _compute_rsi(closes):
        if len(closes) < rsi_period + 1:
            return 50.0
        gains = []
        losses = []
        for i in range(len(closes) - rsi_period, len(closes)):
            diff = closes[i] - closes[i - 1]
            gains.append(max(diff, 0.0))
            losses.append(max(-diff, 0.0))
        avg_gain = sum(gains) / rsi_period
        avg_loss = sum(losses) / rsi_period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

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

    def _clamp(value, min_val, max_val):
        return max(min_val, min(value, max_val))

    def _check_tilt(trade_results):
        if len(trade_results) < tilt_lookback:
            return False
        recent = trade_results[-tilt_lookback:]
        wins = sum(1 for r in recent if r > 0)
        return (wins / tilt_lookback) < tilt_min_win_rate

    def on_tick(state: dict, tick: Tick) -> AlgoResult:
        tick_count = state["tick_count"] + 1
        new_state = {**state, "tick_count": tick_count}

        if state["daily_halted"]:
            return AlgoResult(new_state, ())

        position = state["position"]

        # --- Position management ---

        if position != 0:
            direction = 1 if position > 0 else -1
            ticks_in_trade = state["ticks_in_trade"] + 1
            entry = state["entry_price"]
            stop = state["stop_price"]
            target = state["target_price"]
            best = state["best_price"]

            if direction == 1:
                best = max(best, tick.price)
            else:
                best = min(best, tick.price)

            new_state = {**new_state, "ticks_in_trade": ticks_in_trade, "best_price": best}

            # Time exit
            if ticks_in_trade >= max_hold_ticks:
                if direction == 1:
                    orders = (market_sell(tick.symbol, abs(position)),)
                else:
                    orders = (market_buy(tick.symbol, abs(position)),)
                pnl = (tick.price - entry) * direction * abs(position) * 50.0
                results = (*state["trade_results"], pnl)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "breakeven_set": False, "best_price": 0.0,
                             "ticks_in_trade": 0, "trade_results": results,
                             "daily_pnl": state["daily_pnl"] + pnl}
                if new_state["daily_pnl"] <= -max_daily_loss:
                    new_state = {**new_state, "daily_halted": True}
                return AlgoResult(new_state, orders)

            # Breakeven stop
            atr_val = _compute_atr(state["highs"], state["lows"], state["closes"])
            breakeven_set = state["breakeven_set"]
            favorable_move = (tick.price - entry) * direction

            if not breakeven_set and atr_val > 0 and favorable_move >= atr_val * breakeven_atr_mult:
                breakeven_stop = entry + direction * tick_size
                if direction == 1:
                    stop = max(stop, breakeven_stop)
                else:
                    stop = min(stop, breakeven_stop)
                breakeven_set = True
                new_state = {**new_state, "stop_price": stop, "breakeven_set": breakeven_set}

            # Stop loss
            if direction == 1 and tick.price <= stop:
                orders = (market_sell(tick.symbol, abs(position)),)
                pnl = (tick.price - entry) * abs(position) * 50.0
                results = (*state["trade_results"], pnl)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "breakeven_set": False, "best_price": 0.0,
                             "ticks_in_trade": 0, "trade_results": results,
                             "daily_pnl": state["daily_pnl"] + pnl}
                if new_state["daily_pnl"] <= -max_daily_loss:
                    new_state = {**new_state, "daily_halted": True}
                return AlgoResult(new_state, orders)

            if direction == -1 and tick.price >= stop:
                orders = (market_buy(tick.symbol, abs(position)),)
                pnl = (entry - tick.price) * abs(position) * 50.0
                results = (*state["trade_results"], pnl)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "breakeven_set": False, "best_price": 0.0,
                             "ticks_in_trade": 0, "trade_results": results,
                             "daily_pnl": state["daily_pnl"] + pnl}
                if new_state["daily_pnl"] <= -max_daily_loss:
                    new_state = {**new_state, "daily_halted": True}
                return AlgoResult(new_state, orders)

            # Take profit
            if direction == 1 and tick.price >= target:
                orders = (market_sell(tick.symbol, abs(position)),)
                pnl = (tick.price - entry) * abs(position) * 50.0
                results = (*state["trade_results"], pnl)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "breakeven_set": False, "best_price": 0.0,
                             "ticks_in_trade": 0, "trade_results": results,
                             "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(new_state, orders)

            if direction == -1 and tick.price <= target:
                orders = (market_buy(tick.symbol, abs(position)),)
                pnl = (entry - tick.price) * abs(position) * 50.0
                results = (*state["trade_results"], pnl)
                new_state = {**new_state, "position": 0, "entry_price": 0.0,
                             "stop_price": 0.0, "target_price": 0.0,
                             "breakeven_set": False, "best_price": 0.0,
                             "ticks_in_trade": 0, "trade_results": results,
                             "daily_pnl": state["daily_pnl"] + pnl}
                return AlgoResult(new_state, orders)

            return AlgoResult(new_state, ())

        return AlgoResult(new_state, ())

    def on_bar(state: dict, bar: Bar) -> AlgoResult:
        closes = (*state["closes"], bar.c)[-(bb_period + 5):]
        volumes = (*state["volumes"], bar.v)[-(bb_period + 5):]
        highs = (*state["highs"], bar.h)[-(atr_period + 2):]
        lows = (*state["lows"], bar.l)[-(atr_period + 2):]

        typical_price = (bar.h + bar.l + bar.c) / 3.0
        cum_tp_vol = state["cum_tp_vol"] + typical_price * bar.v
        cum_vol = state["cum_vol"] + bar.v
        vwap_val = cum_tp_vol / cum_vol if cum_vol > 0 else bar.c

        new_state = {**state, "closes": closes, "volumes": volumes,
                     "highs": highs, "lows": lows,
                     "cum_tp_vol": cum_tp_vol, "cum_vol": cum_vol}

        if state["daily_halted"] or state["position"] != 0:
            return AlgoResult(new_state, ())

        if state["session_trades"] >= max_trades_per_session:
            return AlgoResult(new_state, ())

        # Tilt protection
        if _check_tilt(state["trade_results"]):
            if state["tick_count"] < state["tilt_paused_until"]:
                return AlgoResult(new_state, ())
            new_state = {**new_state, "tilt_paused_until": state["tick_count"] + tilt_pause_ticks}
            return AlgoResult(new_state, ())

        # Need enough data for indicators
        if len(closes) < bb_period:
            return AlgoResult(new_state, ())

        # Compute indicators
        bb_mid = _compute_sma(closes, bb_period)
        bb_std = _compute_std(closes, bb_period)
        if bb_mid is None or bb_std is None or bb_std == 0:
            return AlgoResult(new_state, ())

        bb_upper = bb_mid + bb_std_dev * bb_std
        bb_lower = bb_mid - bb_std_dev * bb_std
        rsi_val = _compute_rsi(closes)
        atr_val = _compute_atr(highs, lows, closes)

        if atr_val <= 0:
            return AlgoResult(new_state, ())

        # Volatility filter
        bar_range = bar.h - bar.l
        if bar_range > atr_val * 2.0:
            return AlgoResult(new_state, ())

        # Volume spike required
        vol_avg = _compute_sma(volumes, bb_period)
        if vol_avg and bar.v < vol_avg * volume_spike_mult:
            return AlgoResult(new_state, ())

        vwap_band = 0.5

        # Long scalp: price at lower BB, near VWAP, RSI oversold
        if bar.c <= bb_lower and bar.c <= vwap_val + vwap_band and rsi_val < 30:
            stop_dist = _clamp(atr_val * stop_atr_mult, min_stop_ticks * tick_size, max_stop_ticks * tick_size)
            target_dist = max(atr_val * target_atr_mult, min_target_ticks * tick_size)

            stop = bar.c - stop_dist
            target = bar.c + target_dist

            orders = (market_buy(bar.symbol, 1),)
            new_state = {**new_state, "position": 1, "entry_price": bar.c,
                         "stop_price": stop, "target_price": target,
                         "breakeven_set": False, "best_price": bar.c,
                         "ticks_in_trade": 0,
                         "session_trades": state["session_trades"] + 1}
            return AlgoResult(new_state, orders)

        # Short scalp: price at upper BB, near VWAP, RSI overbought
        if bar.c >= bb_upper and bar.c >= vwap_val - vwap_band and rsi_val > 70:
            stop_dist = _clamp(atr_val * stop_atr_mult, min_stop_ticks * tick_size, max_stop_ticks * tick_size)
            target_dist = max(atr_val * target_atr_mult, min_target_ticks * tick_size)

            stop = bar.c + stop_dist
            target = bar.c - target_dist

            orders = (market_sell(bar.symbol, 1),)
            new_state = {**new_state, "position": -1, "entry_price": bar.c,
                         "stop_price": stop, "target_price": target,
                         "breakeven_set": False, "best_price": bar.c,
                         "ticks_in_trade": 0,
                         "session_trades": state["session_trades"] + 1}
            return AlgoResult(new_state, orders)

        return AlgoResult(new_state, ())

    def on_fill(state: dict, fill: Fill) -> AlgoResult:
        return AlgoResult(state, ())

    return {"init": init, "on_tick": on_tick, "on_bar": on_bar, "on_fill": on_fill}

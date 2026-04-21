import { useState, useEffect, useMemo, useRef } from "react";
import type { Algo, AlgoRun, NavContext, View, NavOptions } from "../types";
import type {
  TradingSimulation,
  DataSource,
  Position,
} from "../hooks/useTradingSimulation";
import type { TradeHistory } from "../hooks/useTradeHistory";
import type { StrategyPnlState } from "../hooks/useStrategyPnl";
import type { RollingMetrics } from "../hooks/useRollingMetrics";
import {
  type Filters,
  type Roundtrip,
  type DrawdownPoint,
  type EquityPoint,
  EMPTY_FILTERS,
  applyFilters,
  aggregateByKey,
  pairLiveShadow,
  buildDistribution,
  buildHeatmap,
  deriveHeroKpis,
  isFilterActive,
} from "../lib/tradingView";
import { TradingFilterBar } from "../components/TradingFilterBar";
import { TradingHero } from "../components/TradingHero";
import { TradingTabs, type TradingTab } from "../components/TradingTabs";
import { LiveTab } from "../components/LiveTab";
import { PerformanceTab } from "../components/PerformanceTab";
import { AnalyticsTab } from "../components/AnalyticsTab";
import { TradesTab } from "../components/TradesTab";

type AccountSummary = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
  unrealized_pnl: number;
};

type TradingViewProps = {
  simulation: TradingSimulation;
  tradeHistory: TradeHistory;
  strategyPnl: StrategyPnlState;
  rolling: RollingMetrics;
  algos: Algo[];
  activeRuns: AlgoRun[];
  dataSources: DataSource[];
  accounts: Record<string, AccountSummary>;
  initialContext?: NavContext | null;
  onContextConsumed?: () => void;
  onNavigate: (view: View, options?: NavOptions) => void;
};

// Build a drawdown series from the closed roundtrips. Used for the hero's Max DD
// and as the drawdown overlay source — consistent with how the hero's realized/
// total P&L and trade metrics are derived (all from the same roundtrip set).
const drawdownFromRoundtrips = (trips: Roundtrip[]): DrawdownPoint[] => {
  const sorted = [...trips].sort((a, b) => a.closeTimestamp - b.closeTimestamp);
  let peak = 0;
  let cum = 0;
  const out: DrawdownPoint[] = [];
  for (const r of sorted) {
    cum += r.pnl;
    if (cum > peak) peak = cum;
    out.push({ t: r.closeTimestamp, peak, pnl: cum, underwater: peak - cum });
  }
  return out;
};

// Build a cumulative equity series from closed roundtrips. The hero chart uses this
// (instead of useEquityTimeline's account-level feed) so stopped-algo history and
// manual NT trades don't show up on the "active algos" view.
const equityFromRoundtrips = (trips: Roundtrip[]): EquityPoint[] => {
  const sorted = [...trips].sort((a, b) => a.closeTimestamp - b.closeTimestamp);
  let cum = 0;
  const out: EquityPoint[] = [{ t: sorted[0]?.openTimestamp ?? Date.now(), pnl: 0 }];
  for (const r of sorted) {
    cum += r.pnl;
    out.push({ t: r.closeTimestamp, pnl: Math.round(cum * 100) / 100 });
  }
  return out;
};

// Position cards need "open since" timestamps. The simulation hook only carries the
// current unrealized P&L, not the moment a position opened. We shadow-track first-seen
// timestamps here at render time so new positions get their timestamp synchronously
// (useMemo rather than useEffect avoids the first-frame staleness that would leave a
// just-opened card showing "--" for its hold duration).
const useOpenSinceMap = (positions: Position[]): Map<string, number> => {
  const mapRef = useRef(new Map<string, number>());
  return useMemo(() => {
    const map = mapRef.current;
    const seen = new Set<string>();
    const now = Date.now();
    for (const p of positions) {
      const key = `${p.dataSourceId}:${p.symbol}:${p.account}`;
      seen.add(key);
      if (!map.has(key)) map.set(key, now);
    }
    for (const key of Array.from(map.keys())) {
      if (!seen.has(key)) map.delete(key);
    }
    return map;
  }, [positions]);
};

export const TradingView = ({
  simulation,
  tradeHistory,
  strategyPnl,
  rolling,
  algos,
  activeRuns,
  dataSources,
  accounts,
  initialContext,
  onContextConsumed,
  onNavigate,
}: TradingViewProps) => {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeTab, setActiveTab] = useState<TradingTab>("live");
  const [selectedRoundtripId, setSelectedRoundtripId] = useState<string | null>(null);

  // Honor inbound nav context (from Algos view etc.)
  useEffect(() => {
    if (!initialContext || initialContext.targetView !== "trading") return;

    const next: Partial<Filters> = {};
    if (initialContext.accountFilter !== undefined) next.account = initialContext.accountFilter;
    if (initialContext.algoFilter !== undefined) next.algo = initialContext.algoFilter;
    if (Object.keys(next).length > 0) {
      setFilters((f) => ({ ...f, ...next }));
    }

    if (initialContext.scrollTo) {
      const target = initialContext.scrollTo;
      if (target === "positions" || target === "orders") setActiveTab("live");
      else if (target === "history") setActiveTab("trades");
      // "stats" stays on whatever tab we're on — hero is always visible.
    }

    onContextConsumed?.();
  }, [initialContext, onContextConsumed]);

  const filteredPositions = useMemo(
    () => applyFilters(simulation.positions, filters),
    [simulation.positions, filters],
  );
  const filteredOrders = useMemo(
    () => applyFilters(simulation.orders, filters),
    [simulation.orders, filters],
  );
  const filteredRoundtrips = useMemo(
    () => applyFilters(tradeHistory.roundtrips, filters),
    [tradeHistory.roundtrips, filters],
  );
  const isFilterOn = isFilterActive(filters);

  const filteredByAlgo = useMemo(
    () => (isFilterOn ? aggregateByKey(filteredRoundtrips, "algo") : tradeHistory.byAlgo),
    [tradeHistory.byAlgo, filteredRoundtrips, isFilterOn],
  );
  const filteredBySymbol = useMemo(
    () => (isFilterOn ? aggregateByKey(filteredRoundtrips, "symbol") : tradeHistory.bySymbol),
    [tradeHistory.bySymbol, filteredRoundtrips, isFilterOn],
  );
  const filteredByAccount = useMemo(
    () => (isFilterOn ? aggregateByKey(filteredRoundtrips, "account") : tradeHistory.byAccount),
    [tradeHistory.byAccount, filteredRoundtrips, isFilterOn],
  );
  const filteredLiveVsShadow = useMemo(
    () => (isFilterOn ? pairLiveShadow(filteredRoundtrips) : tradeHistory.liveVsShadow),
    [tradeHistory.liveVsShadow, filteredRoundtrips, isFilterOn],
  );
  const filteredDistribution = useMemo(
    () => (isFilterOn ? buildDistribution(filteredRoundtrips) : tradeHistory.distribution),
    [tradeHistory.distribution, filteredRoundtrips, isFilterOn],
  );
  const filteredHeatmap = useMemo(
    () => (isFilterOn ? buildHeatmap(filteredRoundtrips) : tradeHistory.heatmap),
    [tradeHistory.heatmap, filteredRoundtrips, isFilterOn],
  );

  // Hero + equity chart scope: only currently-active algo instances. The drill-down
  // tabs below still see the full session (filteredRoundtrips), but the top-of-page
  // snapshot reflects what running algos are doing right now — excludes closed trades
  // from algos the user has since stopped, and excludes manual/account-level NT activity.
  const activeInstanceIds = useMemo(
    () => new Set(activeRuns.map((r) => r.instance_id)),
    [activeRuns],
  );
  const activeChartAccountKeys = useMemo(
    () => new Set(activeRuns.map((r) => `${r.data_source_id}:${r.account}`)),
    [activeRuns],
  );
  const heroRoundtrips = useMemo(
    () => filteredRoundtrips.filter((r) => activeInstanceIds.has(r.instanceId)),
    [filteredRoundtrips, activeInstanceIds],
  );
  const heroPositions = useMemo(
    () => filteredPositions.filter((p) => activeChartAccountKeys.has(`${p.dataSourceId}:${p.account}`)),
    [filteredPositions, activeChartAccountKeys],
  );
  const heroDrawdown = useMemo(() => drawdownFromRoundtrips(heroRoundtrips), [heroRoundtrips]);
  const heroEquityLive = useMemo(
    () => equityFromRoundtrips(heroRoundtrips.filter((r) => !r.isShadow)),
    [heroRoundtrips],
  );
  const heroEquityShadow = useMemo(
    () => equityFromRoundtrips(heroRoundtrips.filter((r) => r.isShadow)),
    [heroRoundtrips],
  );

  // Hero realized/unrealized/total come straight from NT's own strategy snapshot
  // (SystemPerformance.AllTrades + Position.GetUnrealizedProfitLoss, aggregated across
  // every running bridge). Trade count / win rate / Sharpe / drawdown stay derived
  // from our roundtrip store since NT doesn't push those as a running total and the
  // per-trade analytics tabs need the roundtrips anyway.
  const heroKpis = useMemo(() => {
    const roundtripKpis = deriveHeroKpis(heroRoundtrips, heroPositions, heroDrawdown);
    return {
      ...roundtripKpis,
      realizedPnl: strategyPnl.total.realized,
      unrealizedPnl: strategyPnl.total.unrealized,
      totalPnl: strategyPnl.total.total,
    };
  }, [heroRoundtrips, heroPositions, heroDrawdown, strategyPnl.total]);

  const openSinceByPosKey = useOpenSinceMap(simulation.positions);

  const hasCharts = dataSources.length > 0;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden min-h-0">
      <TradingFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        algos={algos}
        activeRuns={activeRuns}
        dataSources={dataSources}
        positions={simulation.positions}
        orders={simulation.orders}
        roundtrips={tradeHistory.roundtrips}
      />

      <TradingHero
        kpis={heroKpis}
        equityLive={heroEquityLive}
        equityShadow={heroEquityShadow}
        drawdown={heroDrawdown}
      />

      <TradingTabs activeTab={activeTab} onChange={setActiveTab} />

      {!hasCharts ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
          Connect a NinjaTrader chart to see trading activity
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0">
          {activeTab === "live" && (
            <LiveTab
              positions={filteredPositions}
              orders={filteredOrders}
              accounts={accounts}
              openSinceByPosKey={openSinceByPosKey}
            />
          )}
          {activeTab === "performance" && (
            <PerformanceTab
              byAlgo={filteredByAlgo}
              bySymbol={filteredBySymbol}
              byAccount={filteredByAccount}
              liveVsShadow={filteredLiveVsShadow}
              onOpenAlgoInEditor={(algoId) => onNavigate("editor", { algoFilter: algoId })}
              onViewAccountInAlgos={(account) => onNavigate("algos", { accountFilter: account })}
            />
          )}
          {activeTab === "analytics" && (
            <AnalyticsTab
              distribution={filteredDistribution}
              heatmap={filteredHeatmap}
              rolling={rolling}
              totalTrades={filteredRoundtrips.length}
            />
          )}
          {activeTab === "trades" && (
            <TradesTab
              roundtrips={filteredRoundtrips}
              selectedId={selectedRoundtripId}
              onSelect={setSelectedRoundtripId}
            />
          )}
        </div>
      )}
    </div>
  );
};

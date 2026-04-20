import { useState, useEffect, useMemo } from "react";
import type { Algo, AlgoRun, NavContext, View, NavOptions } from "../types";
import type {
  TradingSimulation,
  DataSource,
  Position,
} from "../hooks/useTradingSimulation";
import type { TradeHistory } from "../hooks/useTradeHistory";
import type { EquityTimeline } from "../hooks/useEquityTimeline";
import type { RollingMetrics } from "../hooks/useRollingMetrics";
import {
  type Filters,
  type Roundtrip,
  type DrawdownPoint,
  EMPTY_FILTERS,
  applyFilters,
  aggregateByKey,
  pairLiveShadow,
  buildDistribution,
  buildHeatmap,
  deriveHeroKpis,
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
};

type TradingViewProps = {
  simulation: TradingSimulation;
  tradeHistory: TradeHistory;
  equity: EquityTimeline;
  rolling: RollingMetrics;
  algos: Algo[];
  activeRuns: AlgoRun[];
  dataSources: DataSource[];
  accounts: Record<string, AccountSummary>;
  initialContext?: NavContext | null;
  onContextConsumed?: () => void;
  onNavigate: (view: View, options?: NavOptions) => void;
};

// Build a drawdown series from the currently-filtered roundtrips (used when a filter
// is active; the hook's `equity.liveDrawdown` follows nt-account realized P&L across
// all accounts and can't be narrowed after the fact).
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

// Position cards need "open since" timestamps — we track them here (not in the hook)
// because the hook only keeps MAE/MFE samples, not the open time as a separate datum
// that's available synchronously at render. We rebuild the map from the current positions.
const useOpenSinceMap = (positions: Position[]): Map<string, number> => {
  const [map] = useState(() => new Map<string, number>());
  useEffect(() => {
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
  }, [positions, map]);
  return map;
};

export const TradingView = ({
  simulation,
  tradeHistory,
  equity,
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
      if (target === "positions") setActiveTab("live");
      else if (target === "orders") setActiveTab("live");
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
  const isFilterOn =
    filters.chart !== null || filters.account !== null || filters.algo !== null;

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

  // Drawdown follows the filtered roundtrips when a filter is set; otherwise use the
  // hook's raw live drawdown series (which tracks the nt-account realized P&L).
  const filteredDrawdown = useMemo(
    () => (isFilterOn ? drawdownFromRoundtrips(filteredRoundtrips) : equity.liveDrawdown),
    [equity.liveDrawdown, filteredRoundtrips, isFilterOn],
  );

  const heroKpis = useMemo(
    () => deriveHeroKpis(filteredRoundtrips, filteredPositions, filteredDrawdown),
    [filteredRoundtrips, filteredPositions, filteredDrawdown],
  );

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
        equityLive={equity.live}
        equityShadow={equity.shadow}
        drawdown={filteredDrawdown}
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

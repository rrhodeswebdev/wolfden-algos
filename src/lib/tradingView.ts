// Pure helpers for the Trading view. No React imports.

import type { MaeMfeSample } from "./roundtrips";

// ----- Shared types -----

export type Roundtrip = {
  id: string;
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  openTimestamp: number;
  closeTimestamp: number;
  pnl: number;
  mae: number;
  mfe: number;
  rMultiple: number | null;
  algo: string;
  algoId: number;
  account: string;
  dataSourceId: string;
  instanceId: string;
  isShadow: boolean;
  maeMfeSamples: MaeMfeSample[];
};

export type EquityPoint = { t: number; pnl: number };
export type DrawdownPoint = { t: number; peak: number; pnl: number; underwater: number };

export type Filters = {
  chart: string | null;
  account: string | null;
  algo: number | null;
};

export const EMPTY_FILTERS: Filters = { chart: null, account: null, algo: null };

export type Filterable = {
  dataSourceId: string;
  account: string;
  algoId: number;
};

export const matchesFilters = (item: Filterable, f: Filters): boolean => {
  if (f.chart !== null && item.dataSourceId !== f.chart) return false;
  if (f.account !== null && item.account !== f.account) return false;
  if (f.algo !== null && item.algoId !== f.algo) return false;
  return true;
};

export const applyFilters = <T extends Filterable>(items: T[], f: Filters): T[] =>
  items.filter((i) => matchesFilters(i, f));

export const isFilterActive = (f: Filters): boolean =>
  f.chart !== null || f.account !== null || f.algo !== null;

// ----- Formatting helpers -----

// Shared renderers live in ./format; re-exported here so callers can keep
// importing from "tradingView" without caring where the helper lives.
export { formatPnl, pnlColorClass, sparklinePoints } from "./format";

export const formatChartLabel = (dsId: string): string => {
  const [instrument, tf] = dsId.split(":");
  if (!instrument || !tf) return dsId;
  return `${instrument.split(" ")[0]} ${tf}`;
};

export const formatDuration = (fromTs: number, toTs: number): string => {
  const ms = toTs - fromTs;
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
};

// ----- Breakdown aggregation -----

export type BreakdownKey = "algo" | "symbol" | "account";

export type BreakdownRow = {
  key: string;
  label: string;
  trades: number;
  pnl: number;
  winRate: number;
  sharpe: string;
  profitFactor: string;
  avgWin: number;
  avgLoss: number;
  sparkline: number[];
};

const keyOf = (r: Roundtrip, by: BreakdownKey): { key: string; label: string } => {
  switch (by) {
    case "algo":
      return { key: String(r.algoId), label: r.algo || `algo ${r.algoId}` };
    case "symbol":
      return { key: r.symbol, label: r.symbol };
    case "account":
      return { key: r.account, label: r.account };
  }
};

const sharpeString = (pnls: number[]): string => {
  if (pnls.length < 2) return "--";
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std).toFixed(2) : "--";
};

export const aggregateByKey = (roundtrips: Roundtrip[], by: BreakdownKey): BreakdownRow[] => {
  const groups = new Map<string, { label: string; trips: Roundtrip[] }>();
  for (const r of roundtrips) {
    const { key, label } = keyOf(r, by);
    const g = groups.get(key) ?? { label, trips: [] };
    g.trips.push(r);
    groups.set(key, g);
  }
  const rows: BreakdownRow[] = [];
  for (const [key, { label, trips }] of groups) {
    const wins = trips.filter((t) => t.pnl > 0);
    const losses = trips.filter((t) => t.pnl < 0);
    const totalPnl = trips.reduce((s, t) => s + t.pnl, 0);
    const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const winRate = trips.length > 0 ? Math.round((wins.length / trips.length) * 100) : 0;
    const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const profitFactor =
      totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : wins.length > 0 ? "∞" : "--";
    const sorted = [...trips].sort((a, b) => a.closeTimestamp - b.closeTimestamp);
    const sparkline: number[] = [];
    let cum = 0;
    for (const r of sorted) {
      cum += r.pnl;
      sparkline.push(Math.round(cum * 100) / 100);
    }
    rows.push({
      key,
      label,
      trades: trips.length,
      pnl: Math.round(totalPnl * 100) / 100,
      winRate,
      sharpe: sharpeString(trips.map((t) => t.pnl)),
      profitFactor,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      sparkline,
    });
  }
  return rows.sort((a, b) => b.pnl - a.pnl);
};

// ----- Live vs. shadow pairing -----

export type LiveShadowPair = {
  algoId: number;
  algoName: string;
  live: BreakdownRow | null;
  shadow: BreakdownRow | null;
  delta: number;
  slippagePerTrade: number;
};

export const pairLiveShadow = (roundtrips: Roundtrip[]): LiveShadowPair[] => {
  const liveByAlgo = new Map<number, Roundtrip[]>();
  const shadowByAlgo = new Map<number, Roundtrip[]>();
  for (const r of roundtrips) {
    const bucket = r.isShadow ? shadowByAlgo : liveByAlgo;
    const cur = bucket.get(r.algoId) ?? [];
    cur.push(r);
    bucket.set(r.algoId, cur);
  }
  const allAlgoIds = new Set<number>([...liveByAlgo.keys(), ...shadowByAlgo.keys()]);
  const result: LiveShadowPair[] = [];
  for (const algoId of allAlgoIds) {
    const liveTrips = liveByAlgo.get(algoId) ?? [];
    const shadowTrips = shadowByAlgo.get(algoId) ?? [];
    const liveRow = liveTrips.length ? aggregateByKey(liveTrips, "algo")[0] : null;
    const shadowRow = shadowTrips.length ? aggregateByKey(shadowTrips, "algo")[0] : null;
    const algoName = liveRow?.label ?? shadowRow?.label ?? `algo ${algoId}`;
    const delta = Math.round(((liveRow?.pnl ?? 0) - (shadowRow?.pnl ?? 0)) * 100) / 100;
    const liveAvg = liveRow && liveRow.trades > 0 ? liveRow.pnl / liveRow.trades : 0;
    const shadowAvg = shadowRow && shadowRow.trades > 0 ? shadowRow.pnl / shadowRow.trades : 0;
    const slippagePerTrade = Math.round((liveAvg - shadowAvg) * 100) / 100;
    result.push({ algoId, algoName, live: liveRow, shadow: shadowRow, delta, slippagePerTrade });
  }
  return result.sort((a, b) => a.algoName.localeCompare(b.algoName));
};

// ----- Distribution -----

export type DistributionBucket = { lo: number; hi: number; count: number };

export const buildDistribution = (
  roundtrips: Roundtrip[],
  bucketCount: number = 12,
): DistributionBucket[] => {
  if (roundtrips.length === 0) return [];
  const pnls = roundtrips.map((r) => r.pnl);
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);
  const range = max - min || 1;
  const step = range / bucketCount;
  const buckets: DistributionBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * step;
    const hi = i === bucketCount - 1 ? max + 0.0001 : lo + step;
    const count = pnls.filter((p) => p >= lo && p < hi).length;
    buckets.push({ lo: Math.round(lo * 100) / 100, hi: Math.round(hi * 100) / 100, count });
  }
  return buckets;
};

// ----- Heatmap (day × hour) -----

export type HeatCell = { trades: number; pnl: number; winRate: number };

export const buildHeatmap = (roundtrips: Roundtrip[]): HeatCell[][] => {
  // [day][hour] where day 0 = Sunday, hour 0–23
  const grid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ trades: 0, pnl: 0, winRate: 0 })),
  );
  const wins = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const r of roundtrips) {
    const d = new Date(r.closeTimestamp);
    const day = d.getDay();
    const hour = d.getHours();
    grid[day][hour].trades += 1;
    grid[day][hour].pnl += r.pnl;
    if (r.pnl > 0) wins[day][hour] += 1;
  }
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = grid[d][h];
      cell.pnl = Math.round(cell.pnl * 100) / 100;
      cell.winRate = cell.trades > 0 ? Math.round((wins[d][h] / cell.trades) * 100) : 0;
    }
  }
  return grid;
};

// ----- Hero KPI derivation -----

export type HeroKpis = {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  winRate: number;
  trades: number;
  sharpe: string;
  maxDrawdown: number;
};

export const deriveHeroKpis = (
  filteredRoundtrips: Roundtrip[],
  filteredOpenPositions: { pnl: number }[],
  drawdown: DrawdownPoint[],
): HeroKpis => {
  const realized = filteredRoundtrips.reduce((s, r) => s + r.pnl, 0);
  const unrealized = filteredOpenPositions.reduce((s, p) => s + p.pnl, 0);
  const wins = filteredRoundtrips.filter((r) => r.pnl > 0).length;
  const winRate =
    filteredRoundtrips.length > 0 ? Math.round((wins / filteredRoundtrips.length) * 100) : 0;
  const sharpe = sharpeString(filteredRoundtrips.map((r) => r.pnl));
  const maxDrawdown = drawdown.reduce((max, d) => Math.max(max, d.underwater), 0);
  return {
    realizedPnl: Math.round(realized * 100) / 100,
    unrealizedPnl: Math.round(unrealized * 100) / 100,
    totalPnl: Math.round((realized + unrealized) * 100) / 100,
    winRate,
    trades: filteredRoundtrips.length,
    sharpe,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
  };
};

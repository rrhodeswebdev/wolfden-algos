# Trading View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Trading view as a unified dashboard — pinned hero (KPIs + equity + drawdown), global Chart/Account/Algo filters, and four tabs (Live / Performance / Analytics / Trades) with a right-side drill-down panel — per `docs/superpowers/specs/2026-04-19-trading-view-redesign-design.md`.

**Architecture:** Two pure helper modules (`src/lib/tradingView.ts`, `src/lib/roundtrips.ts`) own filtering, aggregation, bucketing, and MAE/MFE derivation. Three new sibling hooks (`useTradeHistory`, `useEquityTimeline`, `useRollingMetrics`) sit next to the existing `useTradingSimulation` (unchanged). `TradingView.tsx` becomes a layout-only orchestrator composing `TradingFilterBar`, `TradingHero` (with `EquityChart`), `TradingTabs`, and the four tab components (`LiveTab`, `PerformanceTab`, `AnalyticsTab`, `TradesTab`) that delegate to small, focused sub-components. `App.tsx` adds new props fed from the new hooks. No backend / Tauri-command / schema / event-payload changes.

**Tech Stack:** React 19, TypeScript 6, Tailwind 4 + CSS vars (`src/styles.css`), `@tauri-apps/api/event.listen` for event subscriptions, Canvas 2D + SVG for charts, no new dependencies.

---

## Project has no test framework — adapted task template

The standard `superpowers:writing-plans` template uses a TDD flow. This project has no vitest / jest setup (see `package.json`), and the spec's verification plan is `tsc` + manual smoke. Every task here replaces the "write failing test → run → implement → pass" cycle with:

1. **Implement** — write the code.
2. **Type-check** — run `npx tsc --noEmit` from the repo root; expect zero TypeScript errors. (`npm run build` also valid but slower.)
3. **Smoke** — a targeted manual walk-through described per task. For pure-helper tasks, smoke = just type-check.
4. **Commit** — Conventional Commits.

Do not introduce a test framework in this plan. It's out of scope.

---

## Task dependency map

Tasks 1–4 (helpers + hooks) produce self-contained new files with no UI dependencies. Tasks 5–9 produce UI components — each depends on the helpers/hooks but not on each other (any can be done in parallel once 1–4 land). Task 10 is the coordinated rewire of `TradingView.tsx` and `App.tsx`. Task 11 is the end-to-end smoke.

```
1 (pure helpers) ──┐
                   ├──▶ 2 (useTradeHistory) ──┬──▶ 3 (useEquityTimeline) ──┐
                   │                          ├──▶ 4 (useRollingMetrics) ──┤
                   │                          │                            │
                   └───────────────────────────────────────────────────────┤
                                              │                            │
                                      5 (chrome: chart/filter/tabs/hero) ──┤
                                      6 (LiveTab)                          ├──▶ 10 (rewire) ──▶ 11 (smoke)
                                      7 (PerformanceTab)                   │
                                      8 (AnalyticsTab)                     │
                                      9 (TradesTab)                        │
                                                                           ┘
```

Tasks 5, 6, 7, 8, 9 can be done in parallel by a subagent runner once tasks 1–4 are done.

---

### Task 1: Create pure helpers — `src/lib/roundtrips.ts` + `src/lib/tradingView.ts`

**Files:**
- Create: `src/lib/roundtrips.ts`
- Create: `src/lib/tradingView.ts`

- [ ] **Step 1: Write `src/lib/roundtrips.ts`**

Create with this exact content:

```ts
// Pure helpers for roundtrip-level derivations. No React imports.

export type MaeMfeSample = { t: number; pnl: number };

export const deriveMaeMfe = (samples: MaeMfeSample[]): { mae: number; mfe: number } => {
  if (samples.length === 0) return { mae: 0, mfe: 0 };
  let mae = 0;
  let mfe = 0;
  for (const s of samples) {
    if (s.pnl < mae) mae = s.pnl;
    if (s.pnl > mfe) mfe = s.pnl;
  }
  return { mae, mfe };
};

export const computeRMultiple = (pnl: number, mae: number): number | null => {
  if (mae >= 0) return null;
  return Math.round((pnl / Math.abs(mae)) * 100) / 100;
};

// Decimate samples to a target count, preserving temporal ordering.
// We always keep the first and last sample; intermediate samples are evenly spaced.
export const decimateSamples = (samples: MaeMfeSample[], target: number): MaeMfeSample[] => {
  if (samples.length <= target) return samples;
  if (target <= 2) return [samples[0], samples[samples.length - 1]];
  const step = (samples.length - 1) / (target - 1);
  const out: MaeMfeSample[] = [];
  for (let i = 0; i < target; i++) {
    out.push(samples[Math.round(i * step)]);
  }
  return out;
};
```

- [ ] **Step 2: Write `src/lib/tradingView.ts`**

Create with this exact content:

```ts
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

// ----- Formatting helpers (shared by components) -----

export const formatPnl = (v: number): string => {
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
};

export const pnlColorClass = (v: number): string =>
  v > 0
    ? "text-[var(--accent-green)]"
    : v < 0
      ? "text-[var(--accent-red)]"
      : "text-[var(--text-primary)]";

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

export const sparklinePoints = (history: number[], width: number, height: number): string => {
  if (history.length <= 1) return "";
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const stepX = width / (history.length - 1);
  return history
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`)
    .join(" ");
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/roundtrips.ts src/lib/tradingView.ts
git commit -m "feat(trading): add pure helpers for roundtrips and trading view derivations"
```

---

### Task 2: Create `useTradeHistory` hook

**Files:**
- Create: `src/hooks/useTradeHistory.ts`

This hook subscribes to the same NinjaTrader events `useTradingSimulation` listens to (`nt-position`, `nt-order-update`, `nt-chart-removed`), independently tracks open positions, samples unrealized P&L while positions are open for MAE/MFE, and on flat emits a full `Roundtrip` record. Aggregates are derived from the roundtrip list via `useMemo`.

- [ ] **Step 1: Write the hook file**

Create `src/hooks/useTradeHistory.ts` with this exact content:

```ts
import { useState, useEffect, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Algo, AlgoRun } from "../types";
import {
  type Roundtrip,
  type BreakdownRow,
  type LiveShadowPair,
  type DistributionBucket,
  type HeatCell,
  aggregateByKey,
  pairLiveShadow,
  buildDistribution,
  buildHeatmap,
} from "../lib/tradingView";
import {
  type MaeMfeSample,
  deriveMaeMfe,
  computeRMultiple,
  decimateSamples,
} from "../lib/roundtrips";

type PositionEvent = {
  source_id: string;
  account: string;
  symbol: string;
  direction: string;
  qty: number;
  avg_price: number;
  unrealized_pnl: number;
};

type OrderEvent = {
  source_id: string;
  account: string;
  instance_id: string;
  order_id: string;
  state: string;
  symbol: string;
  side: string | null;
  filled_qty: number | null;
  avg_fill_price: number | null;
  fill_price: number | null;
  remaining: number | null;
  error: string | null;
  timestamp: number | null;
};

type OpenPosition = {
  posKey: string;
  dataSourceId: string;
  symbol: string;
  account: string;
  side: "Long" | "Short";
  qty: number;
  entryPrice: number;
  openTimestamp: number;
  lastPnl: number;
  samples: MaeMfeSample[];
  lastExitPrice: number | null;
};

export type TradeHistory = {
  roundtrips: Roundtrip[];
  byAlgo: BreakdownRow[];
  bySymbol: BreakdownRow[];
  byAccount: BreakdownRow[];
  liveVsShadow: LiveShadowPair[];
  distribution: DistributionBucket[];
  heatmap: HeatCell[][];
};

const MAX_ROUNDTRIPS = 1000;
const MAX_SAMPLES_PER_TRIP = 200;
const SAMPLE_INTERVAL_MS = 250;

const posKeyOf = (sourceId: string, symbol: string, account: string): string =>
  `${sourceId}:${symbol}:${account}`;

export const useTradeHistory = (algos: Algo[], activeRuns: AlgoRun[]): TradeHistory => {
  const [roundtrips, setRoundtrips] = useState<Roundtrip[]>([]);
  const openPositions = useRef<Map<string, OpenPosition>>(new Map());
  const algosRef = useRef(algos);
  const activeRunsRef = useRef(activeRuns);

  useEffect(() => {
    algosRef.current = algos;
  }, [algos]);
  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);

  // Resolve algo + instance attribution from the current live run table.
  // If the instance has already stopped by the time the trip closes, we
  // fall back to the best-effort values (algoId = 0, empty names).
  const resolveAttribution = (dataSourceId: string, account: string) => {
    const run = activeRunsRef.current.find(
      (r) => r.data_source_id === dataSourceId && r.account === account,
    );
    if (!run) {
      return { algoId: 0, algoName: "", instanceId: "" };
    }
    const algo = algosRef.current.find((a) => a.id === run.algo_id);
    return {
      algoId: run.algo_id,
      algoName: algo?.name ?? `algo ${run.algo_id}`,
      instanceId: run.instance_id,
    };
  };

  // Position events — pairing, sampling, close-to-roundtrip construction.
  useEffect(() => {
    const unlisten = listen<PositionEvent>("nt-position", (event) => {
      const p = event.payload;
      const posKey = posKeyOf(p.source_id, p.symbol, p.account);
      const now = Date.now();

      if (p.direction === "Flat" || p.qty === 0) {
        const open = openPositions.current.get(posKey);
        if (!open) return;
        const { algoId, algoName, instanceId } = resolveAttribution(
          open.dataSourceId,
          open.account,
        );
        const { mae, mfe } = deriveMaeMfe(open.samples);
        const exitPrice = open.lastExitPrice ?? p.avg_price ?? open.entryPrice;
        const trip: Roundtrip = {
          id: `${posKey}-${open.openTimestamp}`,
          symbol: open.symbol,
          side: open.side,
          qty: open.qty,
          entryPrice: open.entryPrice,
          exitPrice,
          openTimestamp: open.openTimestamp,
          closeTimestamp: now,
          pnl: Math.round(open.lastPnl * 100) / 100,
          mae: Math.round(mae * 100) / 100,
          mfe: Math.round(mfe * 100) / 100,
          rMultiple: computeRMultiple(open.lastPnl, mae),
          algo: algoName,
          algoId,
          account: open.account,
          dataSourceId: open.dataSourceId,
          instanceId,
          isShadow: open.account === "shadow",
          maeMfeSamples: decimateSamples(open.samples, MAX_SAMPLES_PER_TRIP),
        };
        openPositions.current.delete(posKey);
        setRoundtrips((prev) => {
          const next = [...prev, trip];
          return next.length > MAX_ROUNDTRIPS ? next.slice(-MAX_ROUNDTRIPS) : next;
        });
        return;
      }

      const side: "Long" | "Short" = p.direction === "Long" ? "Long" : "Short";
      const existing = openPositions.current.get(posKey);
      if (existing) {
        existing.lastPnl = p.unrealized_pnl;
        existing.qty = Math.abs(p.qty);
        // Throttle samples: only append if SAMPLE_INTERVAL_MS has passed since the last.
        const lastSample = existing.samples[existing.samples.length - 1];
        if (!lastSample || now - lastSample.t >= SAMPLE_INTERVAL_MS) {
          existing.samples.push({ t: now, pnl: p.unrealized_pnl });
        }
      } else {
        openPositions.current.set(posKey, {
          posKey,
          dataSourceId: p.source_id,
          symbol: p.symbol,
          account: p.account,
          side,
          qty: Math.abs(p.qty),
          entryPrice: p.avg_price,
          openTimestamp: now,
          lastPnl: p.unrealized_pnl,
          samples: [{ t: now, pnl: p.unrealized_pnl }],
          lastExitPrice: null,
        });
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Order events — track the most recent fill price so we can record it as exitPrice on close.
  useEffect(() => {
    const unlisten = listen<OrderEvent>("nt-order-update", (event) => {
      const o = event.payload;
      if (o.state !== "filled" && o.state !== "partial") return;
      const price = o.fill_price ?? o.avg_fill_price;
      if (price == null) return;
      const posKey = posKeyOf(o.source_id, o.symbol, o.account);
      const open = openPositions.current.get(posKey);
      if (open) open.lastExitPrice = price;
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Chart removal — drop any dangling open positions for that chart. Already-closed
  // roundtrips stay in history.
  useEffect(() => {
    const unlisten = listen<string>("nt-chart-removed", (event) => {
      const removedId = event.payload;
      for (const [key, val] of openPositions.current) {
        if (val.dataSourceId === removedId) {
          openPositions.current.delete(key);
        }
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const byAlgo = useMemo(() => aggregateByKey(roundtrips, "algo"), [roundtrips]);
  const bySymbol = useMemo(() => aggregateByKey(roundtrips, "symbol"), [roundtrips]);
  const byAccount = useMemo(() => aggregateByKey(roundtrips, "account"), [roundtrips]);
  const liveVsShadow = useMemo(() => pairLiveShadow(roundtrips), [roundtrips]);
  const distribution = useMemo(() => buildDistribution(roundtrips), [roundtrips]);
  const heatmap = useMemo(() => buildHeatmap(roundtrips), [roundtrips]);

  return { roundtrips, byAlgo, bySymbol, byAccount, liveVsShadow, distribution, heatmap };
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Smoke — manual (hook alone, not wired yet)**

The hook is not yet wired into any view. Smoke is purely type-check. Functional smoke happens in Task 10 after the rewire.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTradeHistory.ts
git commit -m "feat(trading): add useTradeHistory hook for roundtrip pairing and aggregates"
```

---

### Task 3: Create `useEquityTimeline` hook

**Files:**
- Create: `src/hooks/useEquityTimeline.ts`

Owns the timestamped equity series (live + shadow) and derives the drawdown series from each. Live equity is driven by `nt-account` realized P&L updates (NinjaTrader only emits account snapshots for real accounts — shadow has no account). Shadow equity is derived from cumulative closed shadow roundtrips from `useTradeHistory`.

- [ ] **Step 1: Write the hook file**

Create `src/hooks/useEquityTimeline.ts` with this exact content:

```ts
import { useState, useEffect, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Roundtrip, EquityPoint, DrawdownPoint } from "../lib/tradingView";

type AccountSnapshot = {
  name: string;
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

const MAX_POINTS = 500;

const pushCapped = (arr: EquityPoint[], point: EquityPoint): EquityPoint[] => {
  const next = [...arr, point];
  return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
};

const deriveDrawdown = (series: EquityPoint[]): DrawdownPoint[] => {
  let peak = 0;
  const out: DrawdownPoint[] = [];
  for (const p of series) {
    if (p.pnl > peak) peak = p.pnl;
    out.push({ t: p.t, peak, pnl: p.pnl, underwater: peak - p.pnl });
  }
  return out;
};

export type EquityTimeline = {
  live: EquityPoint[];
  shadow: EquityPoint[];
  liveDrawdown: DrawdownPoint[];
  shadowDrawdown: DrawdownPoint[];
};

const INITIAL: EquityPoint[] = [{ t: Date.now(), pnl: 0 }];

export const useEquityTimeline = (roundtrips: Roundtrip[]): EquityTimeline => {
  const [live, setLive] = useState<EquityPoint[]>(INITIAL);
  const [shadow, setShadow] = useState<EquityPoint[]>(INITIAL);
  const lastLiveRealizedRef = useRef<number | null>(null);
  const lastShadowCumulativeRef = useRef(0);
  const lastShadowCloseRef = useRef(0);

  // Live realized P&L comes from the nt-account stream (non-shadow accounts).
  // Emit a new point whenever realized_pnl changes for any live account.
  useEffect(() => {
    const unlisten = listen<AccountSnapshot>("nt-account", (event) => {
      const a = event.payload;
      if (a.name === "shadow") return;
      if (lastLiveRealizedRef.current === a.realized_pnl) return;
      lastLiveRealizedRef.current = a.realized_pnl;
      setLive((prev) => pushCapped(prev, { t: Date.now(), pnl: a.realized_pnl }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Shadow equity is derived from cumulative closed shadow roundtrips. Only append
  // when a newly-closed shadow trip arrives after our last recorded shadow close.
  useEffect(() => {
    const shadowTrips = roundtrips.filter((r) => r.isShadow);
    if (shadowTrips.length === 0) return;
    const latestClose = shadowTrips.reduce((m, r) => Math.max(m, r.closeTimestamp), 0);
    if (latestClose <= lastShadowCloseRef.current) return;
    lastShadowCloseRef.current = latestClose;
    const cum = shadowTrips.reduce((s, r) => s + r.pnl, 0);
    const rounded = Math.round(cum * 100) / 100;
    if (rounded === lastShadowCumulativeRef.current) return;
    lastShadowCumulativeRef.current = rounded;
    setShadow((prev) => pushCapped(prev, { t: latestClose, pnl: rounded }));
  }, [roundtrips]);

  const liveDrawdown = useMemo(() => deriveDrawdown(live), [live]);
  const shadowDrawdown = useMemo(() => deriveDrawdown(shadow), [shadow]);

  return { live, shadow, liveDrawdown, shadowDrawdown };
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useEquityTimeline.ts
git commit -m "feat(trading): add useEquityTimeline hook for timestamped equity + drawdown"
```

---

### Task 4: Create `useRollingMetrics` hook

**Files:**
- Create: `src/hooks/useRollingMetrics.ts`

Windowed Sharpe / win rate / expectancy over the trailing N roundtrips. Pure derivation from the roundtrip list — no event subscriptions; just `useMemo`.

- [ ] **Step 1: Write the hook file**

Create `src/hooks/useRollingMetrics.ts` with this exact content:

```ts
import { useMemo } from "react";
import type { Roundtrip } from "../lib/tradingView";

export type RollingMetric = "sharpe" | "winRate" | "expectancy";

export type RollingPoint = { t: number; value: number; windowSize: number };

export type RollingMetrics = {
  sharpe: RollingPoint[];
  winRate: RollingPoint[];
  expectancy: RollingPoint[];
};

const computeSharpe = (pnls: number[]): number | null => {
  if (pnls.length < 2) return null;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
  const std = Math.sqrt(variance);
  return std > 0 ? Math.round((mean / std) * 100) / 100 : null;
};

const computeWinRate = (pnls: number[]): number => {
  if (pnls.length === 0) return 0;
  const wins = pnls.filter((p) => p > 0).length;
  return Math.round((wins / pnls.length) * 100);
};

const computeExpectancy = (pnls: number[]): number => {
  if (pnls.length === 0) return 0;
  return Math.round((pnls.reduce((a, b) => a + b, 0) / pnls.length) * 100) / 100;
};

export const useRollingMetrics = (
  roundtrips: Roundtrip[],
  windowSize: number = 20,
): RollingMetrics => {
  return useMemo(() => {
    const sorted = [...roundtrips].sort((a, b) => a.closeTimestamp - b.closeTimestamp);
    const sharpe: RollingPoint[] = [];
    const winRate: RollingPoint[] = [];
    const expectancy: RollingPoint[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = sorted.slice(start, i + 1);
      const pnls = window.map((r) => r.pnl);
      const t = sorted[i].closeTimestamp;
      const ws = window.length;
      const s = computeSharpe(pnls);
      if (s !== null) sharpe.push({ t, value: s, windowSize: ws });
      winRate.push({ t, value: computeWinRate(pnls), windowSize: ws });
      expectancy.push({ t, value: computeExpectancy(pnls), windowSize: ws });
    }
    return { sharpe, winRate, expectancy };
  }, [roundtrips, windowSize]);
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRollingMetrics.ts
git commit -m "feat(trading): add useRollingMetrics hook for windowed trade metrics"
```

---

### Task 5: Shared chrome — `EquityChart` + `TradingFilterBar` + `TradingTabs` + `TradingHero`

**Files:**
- Create: `src/components/EquityChart.tsx`
- Create: `src/components/TradingFilterBar.tsx`
- Create: `src/components/TradingTabs.tsx`
- Create: `src/components/TradingHero.tsx`

These four components form the always-visible chrome: hero (KPIs + equity chart), filter bar, tab bar. They have no cross-dependencies on the tab components — only on the helpers and hooks.

- [ ] **Step 1: Write `src/components/EquityChart.tsx`**

Canvas-based chart replacing the inline `PnlChart` from today's `TradingView`. Renders live as a solid step-line (green above zero, red below), shadow as a dashed line on the same axis, and underwater drawdown as a muted-red band beneath the live line.

Create with this exact content:

```tsx
import { useEffect, useRef } from "react";
import type { EquityPoint, DrawdownPoint } from "../lib/tradingView";

type EquityChartProps = {
  live: EquityPoint[];
  shadow: EquityPoint[];
  drawdown: DrawdownPoint[];
};

const GREEN = "#00d68f";
const RED = "#ff4d6a";
const DD_FILL = "rgba(255, 77, 106, 0.10)";
const GRID = "rgba(136, 136, 160, 0.2)";
const SHADOW_COLOR = "rgba(255, 193, 7, 0.8)";
const TOOLTIP_BG = "rgba(26, 26, 40, 0.92)";
const TOOLTIP_BORDER = "rgba(42, 42, 58, 0.8)";

type DrawData = {
  t: number;
  pnl: number;
};

const formatValue = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

export const EquityChart = ({ live, shadow, drawdown }: EquityChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const liveRef = useRef(live);
  const shadowRef = useRef(shadow);
  const ddRef = useRef(drawdown);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  useEffect(() => {
    shadowRef.current = shadow;
  }, [shadow]);
  useEffect(() => {
    ddRef.current = drawdown;
  }, [drawdown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const move = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const leave = () => {
      mouseRef.current = null;
    };
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseleave", leave);
    return () => {
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseleave", leave);
    };
  }, []);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const liveSeries = liveRef.current;
      const shadowSeries = shadowRef.current;
      const dd = ddRef.current;

      const all: DrawData[] = [...liveSeries, ...shadowSeries];
      if (all.length < 2) {
        ctx.fillStyle = "rgba(136, 136, 160, 0.5)";
        ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("No equity data yet", w / 2, h / 2);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Domain: time min/max across both series; value min/max anchored at 0.
      const tMin = Math.min(...all.map((p) => p.t));
      const tMax = Math.max(...all.map((p) => p.t));
      const tRange = Math.max(tMax - tMin, 1);
      const vMin = Math.min(0, ...all.map((p) => p.pnl));
      const vMax = Math.max(0, ...all.map((p) => p.pnl));
      const vRange = vMax - vMin || 1;
      const pad = vRange * 0.1;
      const toX = (t: number) => ((t - tMin) / tRange) * w;
      const toY = (v: number) => h - ((v - vMin + pad) / (vRange + pad * 2)) * h;

      // Zero line
      const zeroY = toY(0);
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(w, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Drawdown band (underwater area beneath live series)
      if (dd.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(toX(dd[0].t), toY(dd[0].peak));
        for (let i = 1; i < dd.length; i++) {
          ctx.lineTo(toX(dd[i].t), toY(dd[i].peak));
        }
        for (let i = dd.length - 1; i >= 0; i--) {
          ctx.lineTo(toX(dd[i].t), toY(dd[i].pnl));
        }
        ctx.closePath();
        ctx.fillStyle = DD_FILL;
        ctx.fill();
      }

      const traceStep = (series: DrawData[]) => {
        if (series.length === 0) return;
        ctx.moveTo(toX(series[0].t), toY(series[0].pnl));
        for (let i = 1; i < series.length; i++) {
          ctx.lineTo(toX(series[i].t), toY(series[i - 1].pnl));
          ctx.lineTo(toX(series[i].t), toY(series[i].pnl));
        }
      };

      // Live series — split by sign for green/red coloring via clip regions.
      if (liveSeries.length >= 2) {
        const regions = [
          { yStart: 0, yEnd: zeroY, color: GREEN, grad: ["rgba(0,214,143,0.2)", "rgba(0,214,143,0)"] },
          { yStart: zeroY, yEnd: h, color: RED, grad: ["rgba(255,77,106,0)", "rgba(255,77,106,0.2)"] },
        ];
        for (const r of regions) {
          if (r.yEnd - r.yStart <= 0) continue;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, r.yStart, w, r.yEnd - r.yStart);
          ctx.clip();
          const g = ctx.createLinearGradient(0, r.yStart, 0, r.yEnd);
          g.addColorStop(0, r.grad[0]);
          g.addColorStop(1, r.grad[1]);
          ctx.beginPath();
          ctx.moveTo(toX(liveSeries[0].t), zeroY);
          traceStep(liveSeries);
          ctx.lineTo(toX(liveSeries[liveSeries.length - 1].t), zeroY);
          ctx.closePath();
          ctx.fillStyle = g;
          ctx.fill();
          ctx.beginPath();
          traceStep(liveSeries);
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Shadow series — dashed overlay
      if (shadowSeries.length >= 2) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = SHADOW_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        traceStep(shadowSeries);
        ctx.stroke();
        ctx.restore();
      }

      // Crosshair + tooltip for the live series
      const mouse = mouseRef.current;
      if (mouse && liveSeries.length >= 2) {
        // Nearest point by x
        let nearestIdx = 0;
        let nearestDx = Infinity;
        for (let i = 0; i < liveSeries.length; i++) {
          const dx = Math.abs(toX(liveSeries[i].t) - mouse.x);
          if (dx < nearestDx) {
            nearestDx = dx;
            nearestIdx = i;
          }
        }
        const point = liveSeries[nearestIdx];
        const px = toX(point.t);
        const py = toY(point.pnl);
        const color = point.pnl >= 0 ? GREEN : RED;

        ctx.strokeStyle = "rgba(136, 136, 160, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#1a1a28";
        ctx.lineWidth = 2;
        ctx.stroke();

        const label = formatValue(point.pnl);
        ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, sans-serif";
        const metrics = ctx.measureText(label);
        const tw = metrics.width + 16;
        const th = 24;
        const pad2 = 10;
        let tx = px + pad2;
        if (tx + tw > w) tx = px - tw - pad2;
        let ty = py - th - pad2;
        if (ty < 0) ty = py + pad2;
        ctx.fillStyle = TOOLTIP_BG;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, th, 4);
        ctx.fill();
        ctx.strokeStyle = TOOLTIP_BORDER;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, tx + tw / 2, ty + th / 2);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div ref={containerRef} className="flex-1 min-h-0">
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: "crosshair" }} />
    </div>
  );
};
```

- [ ] **Step 2: Write `src/components/TradingFilterBar.tsx`**

Create with this exact content:

```tsx
import type { ReactNode } from "react";
import type { Filters, Roundtrip } from "../lib/tradingView";
import { formatChartLabel } from "../lib/tradingView";
import type { Algo, AlgoRun } from "../types";
import type { DataSource, Position, SimOrder } from "../hooks/useTradingSimulation";

type TradingFilterBarProps = {
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  algos: Algo[];
  activeRuns: AlgoRun[];
  dataSources: DataSource[];
  positions: Position[];
  orders: SimOrder[];
  roundtrips: Roundtrip[];
};

// Build the union of every chart / account / algo that has appeared this session:
//   connected charts + accounts seen on positions/orders/roundtrips + algos seen on runs/roundtrips.
const deriveFilterPools = (
  algos: Algo[],
  activeRuns: AlgoRun[],
  dataSources: DataSource[],
  positions: Position[],
  orders: SimOrder[],
  roundtrips: Roundtrip[],
): { charts: string[]; accounts: string[]; algos: { id: number; name: string }[] } => {
  const chartIds = new Set<string>();
  for (const ds of dataSources) chartIds.add(ds.id);
  for (const p of positions) chartIds.add(p.dataSourceId);
  for (const o of orders) chartIds.add(o.dataSourceId);
  for (const r of roundtrips) chartIds.add(r.dataSourceId);

  const accountSet = new Set<string>();
  for (const p of positions) accountSet.add(p.account);
  for (const o of orders) accountSet.add(o.account);
  for (const r of roundtrips) accountSet.add(r.account);
  for (const run of activeRuns) accountSet.add(run.account);

  const algoMap = new Map<number, string>();
  for (const run of activeRuns) {
    const a = algos.find((x) => x.id === run.algo_id);
    algoMap.set(run.algo_id, a?.name ?? `algo ${run.algo_id}`);
  }
  for (const r of roundtrips) {
    if (r.algoId !== 0) algoMap.set(r.algoId, r.algo || `algo ${r.algoId}`);
  }

  return {
    charts: [...chartIds].sort(),
    accounts: [...accountSet].sort(),
    algos: [...algoMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

type ChipProps = { active: boolean; onClick: () => void; children: ReactNode };

const Chip = ({ active, onClick, children }: ChipProps) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
      active
        ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
    }`}
  >
    {children}
  </button>
);

export const TradingFilterBar = ({
  filters,
  onFiltersChange,
  algos,
  activeRuns,
  dataSources,
  positions,
  orders,
  roundtrips,
}: TradingFilterBarProps) => {
  const { charts, accounts, algos: algoPool } = deriveFilterPools(
    algos,
    activeRuns,
    dataSources,
    positions,
    orders,
    roundtrips,
  );

  if (charts.length === 0 && accounts.length === 0 && algoPool.length === 0) {
    return null;
  }

  const setChart = (v: string | null) => onFiltersChange({ ...filters, chart: v });
  const setAccount = (v: string | null) => onFiltersChange({ ...filters, account: v });
  const setAlgo = (v: number | null) => onFiltersChange({ ...filters, algo: v });

  return (
    <div className="flex items-center gap-4 px-2 flex-wrap">
      {charts.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">
            Chart
          </span>
          <Chip active={filters.chart === null} onClick={() => setChart(null)}>
            All
          </Chip>
          {charts.map((id) => (
            <Chip
              key={id}
              active={filters.chart === id}
              onClick={() => setChart(filters.chart === id ? null : id)}
            >
              {formatChartLabel(id)}
            </Chip>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <>
          <div className="w-px h-5 bg-[var(--border)]" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">
              Account
            </span>
            <Chip active={filters.account === null} onClick={() => setAccount(null)}>
              All
            </Chip>
            {accounts.map((acc) => (
              <Chip
                key={acc}
                active={filters.account === acc}
                onClick={() => setAccount(filters.account === acc ? null : acc)}
              >
                {acc === "shadow" ? "shadow" : acc}
              </Chip>
            ))}
          </div>
        </>
      )}

      {algoPool.length > 0 && (
        <>
          <div className="w-px h-5 bg-[var(--border)]" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">
              Algo
            </span>
            <Chip active={filters.algo === null} onClick={() => setAlgo(null)}>
              All
            </Chip>
            {algoPool.map((a) => (
              <Chip
                key={a.id}
                active={filters.algo === a.id}
                onClick={() => setAlgo(filters.algo === a.id ? null : a.id)}
              >
                {a.name}
              </Chip>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Write `src/components/TradingTabs.tsx`**

Create with this exact content:

```tsx
export type TradingTab = "live" | "performance" | "analytics" | "trades";

type TradingTabsProps = {
  activeTab: TradingTab;
  onChange: (tab: TradingTab) => void;
};

const TABS: { id: TradingTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "performance", label: "Performance" },
  { id: "analytics", label: "Analytics" },
  { id: "trades", label: "Trades" },
];

export const TradingTabs = ({ activeTab, onChange }: TradingTabsProps) => (
  <div className="flex gap-1 border-b border-[var(--border)] px-2">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
          activeTab === tab.id
            ? "border-[var(--accent-blue)] text-[var(--accent-blue)]"
            : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);
```

- [ ] **Step 4: Write `src/components/TradingHero.tsx`**

Create with this exact content:

```tsx
import type { HeroKpis, EquityPoint, DrawdownPoint } from "../lib/tradingView";
import { pnlColorClass } from "../lib/tradingView";
import { EquityChart } from "./EquityChart";

type TradingHeroProps = {
  kpis: HeroKpis;
  equityLive: EquityPoint[];
  equityShadow: EquityPoint[];
  drawdown: DrawdownPoint[];
};

const Kpi = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="flex-1 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
      {label}
    </div>
    <div className={`text-lg font-semibold font-mono tabular-nums truncate ${tone ?? ""}`}>
      {value}
    </div>
  </div>
);

const formatDollars = (v: number): string => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

export const TradingHero = ({ kpis, equityLive, equityShadow, drawdown }: TradingHeroProps) => {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
        <Kpi label="Realized" value={formatDollars(kpis.realizedPnl)} tone={pnlColorClass(kpis.realizedPnl)} />
        <Kpi label="Unrealized" value={formatDollars(kpis.unrealizedPnl)} tone={pnlColorClass(kpis.unrealizedPnl)} />
        <Kpi label="Total" value={formatDollars(kpis.totalPnl)} tone={pnlColorClass(kpis.totalPnl)} />
        <Kpi label="Win Rate" value={kpis.trades > 0 ? `${kpis.winRate}%` : "--"} />
        <Kpi label="Trades" value={`${kpis.trades}`} />
        <Kpi label="Sharpe" value={kpis.sharpe} />
        <Kpi
          label="Max DD"
          value={kpis.maxDrawdown > 0 ? `-$${kpis.maxDrawdown.toFixed(2)}` : "--"}
          tone={kpis.maxDrawdown > 0 ? "text-[var(--accent-red)]" : ""}
        />
      </div>

      <div className="bg-[var(--bg-panel)] rounded-lg p-4 flex flex-col h-[220px]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Equity
            <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
              · with drawdown overlay
            </span>
          </h2>
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-[2px] bg-[var(--accent-green)]" />
              Live
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-3 h-[2px]"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, var(--accent-yellow) 50%, transparent 50%)",
                  backgroundSize: "4px 2px",
                }}
              />
              Shadow
            </span>
          </div>
        </div>
        <EquityChart live={equityLive} shadow={equityShadow} drawdown={drawdown} />
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/EquityChart.tsx src/components/TradingFilterBar.tsx src/components/TradingTabs.tsx src/components/TradingHero.tsx
git commit -m "feat(trading): add hero, filter bar, tabs, and equity chart components"
```

---

### Task 6: Live tab — `PositionCard` + `RiskSummary` + `OrderTape` + `LiveTab`

**Files:**
- Create: `src/components/PositionCard.tsx`
- Create: `src/components/RiskSummary.tsx`
- Create: `src/components/OrderTape.tsx`
- Create: `src/components/LiveTab.tsx`

- [ ] **Step 1: Write `src/components/PositionCard.tsx`**

Create with this exact content:

```tsx
import type { Position } from "../hooks/useTradingSimulation";
import { formatPrice } from "../hooks/useTradingSimulation";
import { formatDuration, formatPnl, pnlColorClass } from "../lib/tradingView";

type PositionCardProps = {
  position: Position;
  openSinceTs: number | null;
};

export const PositionCard = ({ position, openSinceTs }: PositionCardProps) => {
  const isShadow = position.account === "shadow";
  const sideColor = position.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";
  const now = Date.now();
  const held = openSinceTs ? formatDuration(openSinceTs, now) : "--";

  return (
    <div className="flex-1 min-w-[240px] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold">{position.symbol}</div>
        <span
          className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold ${
            isShadow
              ? "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
              : "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
          }`}
        >
          {isShadow ? "Shadow" : "Live"}
        </span>
      </div>
      <div className="text-[10px] text-[var(--text-secondary)] mb-2 truncate">
        {position.algo || "—"} · {position.account}
      </div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-medium ${sideColor}`}>
          {position.side} {position.qty}
        </span>
        <span className={`text-sm font-semibold font-mono tabular-nums ${pnlColorClass(position.pnl)}`}>
          {formatPnl(position.pnl)}
        </span>
      </div>
      <div className="text-[10px] text-[var(--text-secondary)] font-mono">
        entry {formatPrice(position.symbol, position.avgPrice)} · held {held}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Write `src/components/RiskSummary.tsx`**

Create with this exact content:

```tsx
import type { Position } from "../hooks/useTradingSimulation";

type AccountSummary = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

type RiskSummaryProps = {
  positions: Position[];
  accounts: Record<string, AccountSummary>;
};

const Cell = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="flex-1 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
      {label}
    </div>
    <div className={`text-base font-semibold font-mono tabular-nums ${tone ?? ""}`}>{value}</div>
  </div>
);

const formatDollars = (v: number): string => `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const RiskSummary = ({ positions, accounts }: RiskSummaryProps) => {
  const liveAccounts = Object.entries(accounts).filter(([name]) => name !== "shadow");
  const totalBuyingPower = liveAccounts.reduce((s, [, a]) => s + a.buying_power, 0);

  // Open risk = sum of negative unrealized P&Ls across open positions (how much we could still lose
  // if every position adversely hit zero at current prices). A crude but useful gauge.
  const openRisk = positions.reduce((s, p) => s + (p.pnl < 0 ? Math.abs(p.pnl) : 0), 0);
  const openPositions = positions.length;
  const portfolioHeat =
    totalBuyingPower > 0 ? ((openRisk / totalBuyingPower) * 100).toFixed(2) : "--";
  const marginUsed = totalBuyingPower > 0 ? ((openRisk / totalBuyingPower) * 100).toFixed(0) : "--";

  return (
    <div className="grid grid-cols-5 gap-4 p-3 bg-[var(--bg-panel)] rounded-lg">
      <Cell
        label="Open Risk"
        value={openRisk > 0 ? `-${formatDollars(openRisk)}` : "$0"}
        tone={openRisk > 0 ? "text-[var(--accent-yellow)]" : ""}
      />
      <Cell
        label="Portfolio Heat"
        value={portfolioHeat === "--" ? "--" : `${portfolioHeat}%`}
      />
      <Cell
        label="Buying Power"
        value={totalBuyingPower > 0 ? formatDollars(totalBuyingPower) : "--"}
      />
      <Cell label="Margin Used" value={marginUsed === "--" ? "--" : `${marginUsed}%`} />
      <Cell label="Open Positions" value={`${openPositions}`} />
    </div>
  );
};
```

- [ ] **Step 3: Write `src/components/OrderTape.tsx`**

Create with this exact content:

```tsx
import type { SimOrder } from "../hooks/useTradingSimulation";

type OrderTapeProps = {
  orders: SimOrder[];
};

const statusTone = (status: SimOrder["status"]): string => {
  switch (status) {
    case "Filled":
      return "bg-[var(--accent-green)]/15 text-[var(--accent-green)]";
    case "Working":
      return "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]";
    case "Cancelled":
      return "bg-[var(--accent-red)]/15 text-[var(--accent-red)]";
  }
};

export const OrderTape = ({ orders }: OrderTapeProps) => {
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Order Tape
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">
          {orders.length > 0 ? `${orders.length} recent` : "live-updating"}
        </span>
      </div>
      <div className="flex-1 overflow-auto max-h-[260px]">
        {orders.length === 0 ? (
          <div className="px-4 py-5 text-center text-sm text-[var(--text-secondary)]">
            No orders yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">Symbol</th>
                <th className="text-left px-4 py-2 font-medium">Side</th>
                <th className="text-right px-4 py-2 font-medium">Qty</th>
                <th className="text-right px-4 py-2 font-medium">Price</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Algo</th>
                <th className="text-left px-4 py-2 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--text-secondary)] font-mono text-[11px]">
                    {o.time}
                  </td>
                  <td className="px-4 py-2 font-medium">{o.symbol}</td>
                  <td
                    className={`px-4 py-2 ${
                      o.side === "Buy" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"
                    }`}
                  >
                    {o.side}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{o.qty}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{o.price}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded ${statusTone(o.status)}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{o.algo || "—"}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">
                    {o.account === "shadow" ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
                        shadow
                      </span>
                    ) : (
                      o.account
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Write `src/components/LiveTab.tsx`**

Create with this exact content:

```tsx
import type { Position, SimOrder } from "../hooks/useTradingSimulation";
import { RiskSummary } from "./RiskSummary";
import { PositionCard } from "./PositionCard";
import { OrderTape } from "./OrderTape";

type AccountSummary = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

type LiveTabProps = {
  positions: Position[];
  orders: SimOrder[];
  accounts: Record<string, AccountSummary>;
  // Map posKey ("dataSourceId:symbol:account") → open-since timestamp; provided by useTradeHistory
  // so position cards can render "held Xm" consistently. If a card has no entry in the map,
  // fallback to "--" via null.
  openSinceByPosKey: Map<string, number>;
};

export const LiveTab = ({ positions, orders, accounts, openSinceByPosKey }: LiveTabProps) => {
  const hasAnything = positions.length > 0 || orders.length > 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <RiskSummary positions={positions} accounts={accounts} />

      <div className="bg-[var(--bg-panel)] rounded-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Open Positions
          </h2>
          <span className="text-[10px] text-[var(--text-muted)]">{positions.length}</span>
        </div>
        {positions.length === 0 ? (
          <div className="text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg p-6 text-center">
            {hasAnything ? "No matching open positions" : "No open positions"}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {positions.map((p) => {
              const posKey = `${p.dataSourceId}:${p.symbol}:${p.account}`;
              return (
                <PositionCard
                  key={posKey}
                  position={p}
                  openSinceTs={openSinceByPosKey.get(posKey) ?? null}
                />
              );
            })}
          </div>
        )}
      </div>

      <OrderTape orders={orders} />
    </div>
  );
};
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/PositionCard.tsx src/components/RiskSummary.tsx src/components/OrderTape.tsx src/components/LiveTab.tsx
git commit -m "feat(trading): add Live tab components (position cards, risk summary, order tape)"
```

---

### Task 7: Performance tab — `BreakdownTable` + `LiveShadowDelta` + `PerformanceTab`

**Files:**
- Create: `src/components/BreakdownTable.tsx`
- Create: `src/components/LiveShadowDelta.tsx`
- Create: `src/components/PerformanceTab.tsx`

- [ ] **Step 1: Write `src/components/BreakdownTable.tsx`**

Create with this exact content:

```tsx
import type { BreakdownRow } from "../lib/tradingView";
import { formatPnl, pnlColorClass, sparklinePoints } from "../lib/tradingView";

type BreakdownTableProps = {
  title: string;
  rows: BreakdownRow[];
  labelHeader: string;
  emptyMessage?: string;
  onRowDeepLink?: (row: BreakdownRow) => void;
  deepLinkLabel?: string;
};

const SPARK_W = 80;
const SPARK_H = 20;

export const BreakdownTable = ({
  title,
  rows,
  labelHeader,
  emptyMessage,
  onRowDeepLink,
  deepLinkLabel,
}: BreakdownTableProps) => {
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {title}
        </h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          {emptyMessage ?? "No data yet"}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
              <th className="text-left px-4 py-2 font-medium">{labelHeader}</th>
              <th className="text-right px-4 py-2 font-medium">Trades</th>
              <th className="text-right px-4 py-2 font-medium">Win %</th>
              <th className="text-right px-4 py-2 font-medium">P&L</th>
              <th className="text-right px-4 py-2 font-medium">Sharpe</th>
              <th className="text-right px-4 py-2 font-medium">Avg Win</th>
              <th className="text-right px-4 py-2 font-medium">Avg Loss</th>
              <th className="text-right px-4 py-2 font-medium">Profit Factor</th>
              <th className="text-right px-4 py-2 font-medium">Trend</th>
              {onRowDeepLink && <th className="text-right px-4 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const strokeColor = row.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)";
              const points = sparklinePoints(row.sparkline, SPARK_W, SPARK_H);
              return (
                <tr key={row.key} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {row.label === "shadow" ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
                        shadow
                      </span>
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.trades}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.winRate}%</td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums font-medium ${pnlColorClass(row.pnl)}`}>
                    {formatPnl(row.pnl)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.sharpe}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--accent-green)]">
                    {formatPnl(row.avgWin)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--accent-red)]">
                    {formatPnl(row.avgLoss)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.profitFactor}</td>
                  <td className="px-4 py-2 text-right">
                    {points ? (
                      <svg
                        className="inline-block"
                        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                        preserveAspectRatio="none"
                        width={SPARK_W}
                        height={SPARK_H}
                        aria-hidden
                      >
                        <polyline fill="none" stroke={strokeColor} strokeWidth="1.2" points={points} />
                      </svg>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  {onRowDeepLink && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onRowDeepLink(row)}
                        className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
                        title={deepLinkLabel}
                      >
                        →
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Write `src/components/LiveShadowDelta.tsx`**

Create with this exact content:

```tsx
import type { LiveShadowPair } from "../lib/tradingView";
import { formatPnl, pnlColorClass } from "../lib/tradingView";

type LiveShadowDeltaProps = {
  pairs: LiveShadowPair[];
};

export const LiveShadowDelta = ({ pairs }: LiveShadowDeltaProps) => {
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Live vs. Shadow
        </h2>
      </div>
      {pairs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          No paired trades yet · run the same algo live and shadow to compare
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
              <th className="text-left px-4 py-2 font-medium">Algo</th>
              <th className="text-right px-4 py-2 font-medium">Live P&L</th>
              <th className="text-right px-4 py-2 font-medium">Shadow P&L</th>
              <th className="text-right px-4 py-2 font-medium">Δ</th>
              <th className="text-right px-4 py-2 font-medium">Live Win %</th>
              <th className="text-right px-4 py-2 font-medium">Shadow Win %</th>
              <th className="text-right px-4 py-2 font-medium">Slippage est.</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.algoId} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2 font-medium">{p.algoName}</td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums ${pnlColorClass(p.live?.pnl ?? 0)}`}>
                  {p.live ? formatPnl(p.live.pnl) : "—"}
                </td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums ${pnlColorClass(p.shadow?.pnl ?? 0)}`}>
                  {p.shadow ? formatPnl(p.shadow.pnl) : "—"}
                </td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums font-semibold ${pnlColorClass(p.delta)}`}>
                  {formatPnl(p.delta)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {p.live ? `${p.live.winRate}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {p.shadow ? `${p.shadow.winRate}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                  {p.live && p.shadow ? `${formatPnl(p.slippagePerTrade)}/trade` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Write `src/components/PerformanceTab.tsx`**

Create with this exact content:

```tsx
import type { BreakdownRow, LiveShadowPair } from "../lib/tradingView";
import { BreakdownTable } from "./BreakdownTable";
import { LiveShadowDelta } from "./LiveShadowDelta";

type PerformanceTabProps = {
  byAlgo: BreakdownRow[];
  bySymbol: BreakdownRow[];
  byAccount: BreakdownRow[];
  liveVsShadow: LiveShadowPair[];
  onOpenAlgoInEditor: (algoId: number) => void;
  onViewAccountInAlgos: (account: string) => void;
};

export const PerformanceTab = ({
  byAlgo,
  bySymbol,
  byAccount,
  liveVsShadow,
  onOpenAlgoInEditor,
  onViewAccountInAlgos,
}: PerformanceTabProps) => {
  return (
    <div className="flex flex-col gap-3 p-3">
      <BreakdownTable
        title="By Algo"
        labelHeader="Algo"
        rows={byAlgo}
        emptyMessage="No completed trades yet — breakdowns appear after your first roundtrip"
        onRowDeepLink={(row) => {
          const id = Number(row.key);
          if (Number.isFinite(id) && id > 0) onOpenAlgoInEditor(id);
        }}
        deepLinkLabel="Open in Editor"
      />

      <div className="grid grid-cols-2 gap-3">
        <BreakdownTable
          title="By Symbol"
          labelHeader="Symbol"
          rows={bySymbol}
          emptyMessage="No completed trades yet"
        />
        <BreakdownTable
          title="By Account"
          labelHeader="Account"
          rows={byAccount}
          emptyMessage="No completed trades yet"
          onRowDeepLink={(row) => onViewAccountInAlgos(row.key)}
          deepLinkLabel="View algos for this account"
        />
      </div>

      <LiveShadowDelta pairs={liveVsShadow} />
    </div>
  );
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/BreakdownTable.tsx src/components/LiveShadowDelta.tsx src/components/PerformanceTab.tsx
git commit -m "feat(trading): add Performance tab components (breakdowns, live-vs-shadow)"
```

---

### Task 8: Analytics tab — `TradeDistribution` + `SessionHeatmap` + `RollingMetricsChart` + `AnalyticsTab`

**Files:**
- Create: `src/components/TradeDistribution.tsx`
- Create: `src/components/SessionHeatmap.tsx`
- Create: `src/components/RollingMetricsChart.tsx`
- Create: `src/components/AnalyticsTab.tsx`

- [ ] **Step 1: Write `src/components/TradeDistribution.tsx`**

Create with this exact content:

```tsx
import type { DistributionBucket } from "../lib/tradingView";

type TradeDistributionProps = {
  buckets: DistributionBucket[];
  totalTrades: number;
};

export const TradeDistribution = ({ buckets, totalTrades }: TradeDistributionProps) => {
  if (buckets.length === 0 || totalTrades === 0) {
    return (
      <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
        <div className="px-4 py-2.5 border-b border-[var(--border)]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Trade P&L Distribution
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
          No completed trades yet
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Trade P&L Distribution
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">{totalTrades} trades</span>
      </div>
      <div className="flex-1 px-4 py-3 flex flex-col">
        <div className="flex-1 flex items-end gap-[2px]">
          {buckets.map((b, i) => {
            const height = `${(b.count / maxCount) * 100}%`;
            const isNegative = b.hi <= 0;
            const color = isNegative
              ? "bg-[var(--accent-red)]"
              : b.lo >= 0
                ? "bg-[var(--accent-green)]"
                : "bg-[var(--text-muted)]";
            return (
              <div
                key={i}
                className={`flex-1 rounded-t ${color}`}
                style={{ height, minHeight: b.count > 0 ? "2px" : "0" }}
                title={`${b.count} trades · ${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}`}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-2 font-mono">
          <span>{buckets[0].lo.toFixed(0)}</span>
          <span>0</span>
          <span>+{buckets[buckets.length - 1].hi.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Write `src/components/SessionHeatmap.tsx`**

Create with this exact content:

```tsx
import type { HeatCell } from "../lib/tradingView";

type SessionHeatmapProps = {
  grid: HeatCell[][];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const cellColor = (cell: HeatCell, absMax: number): string => {
  if (cell.trades === 0) return "var(--bg-elevated)";
  const intensity = Math.min(1, Math.abs(cell.pnl) / (absMax || 1));
  const alpha = 0.15 + intensity * 0.75;
  return cell.pnl >= 0
    ? `rgba(0, 214, 143, ${alpha.toFixed(2)})`
    : `rgba(255, 77, 106, ${alpha.toFixed(2)})`;
};

export const SessionHeatmap = ({ grid }: SessionHeatmapProps) => {
  const totalTrades = grid.reduce((s, row) => s + row.reduce((a, c) => a + c.trades, 0), 0);
  const absMax = Math.max(
    1,
    ...grid.flatMap((row) => row.map((c) => Math.abs(c.pnl))),
  );

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Hour × Day Heatmap <span className="font-normal normal-case tracking-normal text-[var(--text-muted)]">· P&L</span>
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">{totalTrades} trades</span>
      </div>
      <div className="flex-1 px-4 py-3 overflow-auto">
        {totalTrades === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)]">
            No completed trades yet
          </div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            <div className="flex gap-[2px] pl-[40px] text-[9px] text-[var(--text-muted)] font-mono">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center">
                  {h % 3 === 0 ? h : ""}
                </div>
              ))}
            </div>
            {grid.map((row, d) => (
              <div key={d} className="flex gap-[2px] items-center">
                <div className="w-[36px] text-[10px] text-[var(--text-secondary)] font-mono">
                  {DAY_LABELS[d]}
                </div>
                {row.map((cell, h) => (
                  <div
                    key={h}
                    className="flex-1 h-[16px] rounded-sm"
                    style={{ backgroundColor: cellColor(cell, absMax) }}
                    title={
                      cell.trades === 0
                        ? "No trades"
                        : `${cell.trades} trades · ${cell.winRate}% win · ${cell.pnl >= 0 ? "+" : "-"}$${Math.abs(cell.pnl).toFixed(2)}`
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Write `src/components/RollingMetricsChart.tsx`**

Create with this exact content:

```tsx
import { useState, useEffect, useRef } from "react";
import type { RollingMetric, RollingPoint } from "../hooks/useRollingMetrics";

type RollingMetricsChartProps = {
  sharpe: RollingPoint[];
  winRate: RollingPoint[];
  expectancy: RollingPoint[];
};

const PICKERS: { id: RollingMetric; label: string }[] = [
  { id: "sharpe", label: "Sharpe" },
  { id: "winRate", label: "Win %" },
  { id: "expectancy", label: "Expectancy" },
];

export const RollingMetricsChart = ({ sharpe, winRate, expectancy }: RollingMetricsChartProps) => {
  const [metric, setMetric] = useState<RollingMetric>("sharpe");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const series = metric === "sharpe" ? sharpe : metric === "winRate" ? winRate : expectancy;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (series.length < 2) {
      ctx.fillStyle = "rgba(136, 136, 160, 0.5)";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const msg =
        series.length === 0
          ? "No rolling data yet"
          : `Partial window · ${series[0].windowSize}/20 trades`;
      ctx.fillText(msg, w / 2, h / 2);
      return;
    }

    const values = series.map((p) => p.value);
    const vMin = Math.min(0, ...values);
    const vMax = Math.max(0, ...values);
    const vRange = vMax - vMin || 1;
    const pad = vRange * 0.1;
    const toX = (i: number) => (i / Math.max(series.length - 1, 1)) * w;
    const toY = (v: number) => h - ((v - vMin + pad) / (vRange + pad * 2)) * h;

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = "rgba(136, 136, 160, 0.2)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Line
    const lastVal = values[values.length - 1];
    ctx.strokeStyle = lastVal >= 0 ? "#00d68f" : "#ff4d6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = toX(i);
      const y = toY(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Last point dot
    const lx = toX(series.length - 1);
    const ly = toY(lastVal);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = lastVal >= 0 ? "#00d68f" : "#ff4d6a";
    ctx.fill();
  }, [series]);

  const partialWindowNotice =
    series.length > 0 && series[0].windowSize < 20
      ? ` · partial ${series[0].windowSize}/20`
      : "";

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Rolling Metrics
          <span className="font-normal normal-case tracking-normal text-[var(--text-muted)]">
            {" "}
            · 20-trade window{partialWindowNotice}
          </span>
        </h2>
        <div className="flex gap-1">
          {PICKERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setMetric(p.id)}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                metric === p.id
                  ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 px-4 py-3">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Write `src/components/AnalyticsTab.tsx`**

Create with this exact content:

```tsx
import type { DistributionBucket, HeatCell } from "../lib/tradingView";
import type { RollingMetrics } from "../hooks/useRollingMetrics";
import { TradeDistribution } from "./TradeDistribution";
import { SessionHeatmap } from "./SessionHeatmap";
import { RollingMetricsChart } from "./RollingMetricsChart";

type AnalyticsTabProps = {
  distribution: DistributionBucket[];
  heatmap: HeatCell[][];
  rolling: RollingMetrics;
  totalTrades: number;
};

export const AnalyticsTab = ({
  distribution,
  heatmap,
  rolling,
  totalTrades,
}: AnalyticsTabProps) => {
  return (
    <div className="flex flex-col gap-3 p-3">
      <TradeDistribution buckets={distribution} totalTrades={totalTrades} />
      <div className="grid grid-cols-2 gap-3">
        <SessionHeatmap grid={heatmap} />
        <RollingMetricsChart
          sharpe={rolling.sharpe}
          winRate={rolling.winRate}
          expectancy={rolling.expectancy}
        />
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/TradeDistribution.tsx src/components/SessionHeatmap.tsx src/components/RollingMetricsChart.tsx src/components/AnalyticsTab.tsx
git commit -m "feat(trading): add Analytics tab components (distribution, heatmap, rolling metrics)"
```

---

### Task 9: Trades tab — `RoundtripsTable` + `TradeDetailPanel` + `TradesTab`

**Files:**
- Create: `src/components/RoundtripsTable.tsx`
- Create: `src/components/TradeDetailPanel.tsx`
- Create: `src/components/TradesTab.tsx`

- [ ] **Step 1: Write `src/components/RoundtripsTable.tsx`**

Create with this exact content:

```tsx
import type { Roundtrip } from "../lib/tradingView";
import { formatDuration, formatPnl, pnlColorClass } from "../lib/tradingView";

type RoundtripsTableProps = {
  roundtrips: Roundtrip[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const formatHm = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
};

export const RoundtripsTable = ({
  roundtrips,
  selectedId,
  onSelect,
}: RoundtripsTableProps) => {
  const sorted = [...roundtrips].sort((a, b) => b.closeTimestamp - a.closeTimestamp);

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden h-full">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Roundtrips
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">{sorted.length}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] px-4 py-6">
          No completed trades yet
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-panel)] z-10">
              <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
                <th className="text-left px-3 py-2 font-medium">Opened</th>
                <th className="text-left px-3 py-2 font-medium">Closed</th>
                <th className="text-left px-3 py-2 font-medium">Symbol</th>
                <th className="text-left px-3 py-2 font-medium">Side</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Dur</th>
                <th className="text-right px-3 py-2 font-medium">R</th>
                <th className="text-right px-3 py-2 font-medium">P&L</th>
                <th className="text-left px-3 py-2 font-medium">Algo</th>
                <th className="text-left px-3 py-2 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isSelected = selectedId === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    className={`border-b border-[var(--border)] last:border-0 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[var(--accent-blue)]/10 border-l-2 border-l-[var(--accent-blue)]"
                        : "hover:bg-[var(--bg-secondary)]"
                    }`}
                  >
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-[11px]">
                      {formatHm(r.openTimestamp)}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-[11px]">
                      {formatHm(r.closeTimestamp)}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.symbol}</td>
                    <td
                      className={`px-3 py-2 ${
                        r.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"
                      }`}
                    >
                      {r.side}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.qty}</td>
                    <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-mono tabular-nums">
                      {formatDuration(r.openTimestamp, r.closeTimestamp)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.rMultiple !== null ? r.rMultiple.toFixed(1) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums font-medium ${pnlColorClass(r.pnl)}`}>
                      {formatPnl(r.pnl)}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-[120px]">
                      {r.algo || "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {r.isShadow ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
                          shadow
                        </span>
                      ) : (
                        r.account
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Write `src/components/TradeDetailPanel.tsx`**

Create with this exact content:

```tsx
import { useEffect } from "react";
import type { Roundtrip } from "../lib/tradingView";
import { formatDuration, formatPnl, pnlColorClass } from "../lib/tradingView";
import { formatPrice } from "../hooks/useTradingSimulation";

type TradeDetailPanelProps = {
  roundtrip: Roundtrip | null;
  onClose: () => void;
};

const formatFullTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const CHART_W = 320;
const CHART_H = 80;

const samplePoints = (
  samples: { t: number; pnl: number }[],
  width: number,
  height: number,
): { zeroY: number; path: string } => {
  if (samples.length < 2) return { zeroY: height / 2, path: "" };
  const tMin = samples[0].t;
  const tMax = samples[samples.length - 1].t;
  const tRange = Math.max(tMax - tMin, 1);
  const pnls = samples.map((s) => s.pnl);
  const vMin = Math.min(0, ...pnls);
  const vMax = Math.max(0, ...pnls);
  const vRange = vMax - vMin || 1;
  const pad = vRange * 0.1;
  const toX = (t: number) => ((t - tMin) / tRange) * width;
  const toY = (v: number) => height - ((v - vMin + pad) / (vRange + pad * 2)) * height;
  const path = samples
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(s.t).toFixed(1)},${toY(s.pnl).toFixed(1)}`)
    .join(" ");
  return { zeroY: toY(0), path };
};

export const TradeDetailPanel = ({ roundtrip, onClose }: TradeDetailPanelProps) => {
  useEffect(() => {
    if (!roundtrip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roundtrip, onClose]);

  if (!roundtrip) {
    return (
      <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden h-full items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)]">
        Click a roundtrip to see execution detail
      </div>
    );
  }

  const r = roundtrip;
  const sideColor = r.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";
  const { zeroY, path } = samplePoints(r.maeMfeSamples, CHART_W, CHART_H);
  const strokeColor = r.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)";

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden h-full">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-sm font-semibold truncate">{r.symbol}</h2>
            <span className={`text-xs font-medium ${sideColor}`}>{r.side}</span>
            {r.isShadow && (
              <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] font-semibold">
                Shadow
              </span>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] font-mono">
            {formatFullTime(r.openTimestamp)} → {formatFullTime(r.closeTimestamp)} · {r.algo || "—"} ·{" "}
            {r.account}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg leading-none"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      <div className="overflow-auto p-3 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--bg-elevated)] rounded-md p-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">
              P&L
            </div>
            <div className={`text-base font-semibold font-mono tabular-nums ${pnlColorClass(r.pnl)}`}>
              {formatPnl(r.pnl)}
            </div>
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-md p-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">
              R
            </div>
            <div className="text-base font-semibold font-mono tabular-nums">
              {r.rMultiple !== null ? r.rMultiple.toFixed(2) : "—"}
            </div>
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-md p-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">
              Dur
            </div>
            <div className="text-base font-semibold font-mono tabular-nums">
              {formatDuration(r.openTimestamp, r.closeTimestamp)}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Execution
          </div>
          <div className="text-sm space-y-1 font-mono">
            <div>
              <span className={r.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}>
                {r.side === "Long" ? "Buy" : "Sell"} {r.qty} @ {formatPrice(r.symbol, r.entryPrice)}
              </span>{" "}
              <span className="text-[var(--text-muted)]">· {formatFullTime(r.openTimestamp)}</span>
            </div>
            <div>
              <span className={r.side === "Long" ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"}>
                {r.side === "Long" ? "Sell" : "Buy"} {r.qty} @ {formatPrice(r.symbol, r.exitPrice)}
              </span>{" "}
              <span className="text-[var(--text-muted)]">· {formatFullTime(r.closeTimestamp)}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Excursion
          </div>
          <div className="text-sm space-y-1 font-mono">
            <div>
              <span className="text-[var(--text-secondary)]">MAE:</span>{" "}
              <span className="text-[var(--accent-red)]">
                {r.mae >= 0 ? "$0.00" : formatPnl(r.mae)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">MFE:</span>{" "}
              <span className="text-[var(--accent-green)]">
                {r.mfe <= 0 ? "$0.00" : formatPnl(r.mfe)}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Unrealized P&L over hold
          </div>
          {path ? (
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              preserveAspectRatio="none"
              width="100%"
              height={CHART_H}
              className="bg-[var(--bg-elevated)] rounded"
            >
              <line
                x1={0}
                y1={zeroY}
                x2={CHART_W}
                y2={zeroY}
                stroke="rgba(136,136,160,0.3)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <path d={path} fill="none" stroke={strokeColor} strokeWidth={1.5} />
            </svg>
          ) : (
            <div className="text-[var(--text-muted)] text-xs">Not enough samples</div>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Write `src/components/TradesTab.tsx`**

Create with this exact content:

```tsx
import type { Roundtrip } from "../lib/tradingView";
import { RoundtripsTable } from "./RoundtripsTable";
import { TradeDetailPanel } from "./TradeDetailPanel";

type TradesTabProps = {
  roundtrips: Roundtrip[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export const TradesTab = ({ roundtrips, selectedId, onSelect }: TradesTabProps) => {
  const selected = selectedId ? roundtrips.find((r) => r.id === selectedId) ?? null : null;

  return (
    <div className="flex gap-3 p-3 h-full min-h-0">
      <div className={`flex-1 min-h-0 ${selected ? "basis-3/5" : ""}`}>
        <RoundtripsTable
          roundtrips={roundtrips}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
      {selected && (
        <div className="basis-2/5 min-h-0">
          <TradeDetailPanel roundtrip={selected} onClose={() => onSelect(null)} />
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/RoundtripsTable.tsx src/components/TradeDetailPanel.tsx src/components/TradesTab.tsx
git commit -m "feat(trading): add Trades tab components (roundtrips table, drill-down panel)"
```

---

### Task 10: Coordinated rewire — rewrite `TradingView.tsx` + wire new hooks in `App.tsx`

**Files:**
- Rewrite: `src/views/TradingView.tsx` (delete existing contents, replace)
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite `src/views/TradingView.tsx`**

Replace the entire file with this exact content:

```tsx
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

```

- [ ] **Step 2: Update `src/App.tsx`**

Open `src/App.tsx`. Perform the following edits in order:

**Edit 1: Add imports** — add these import lines after the existing `useTradingSimulation` import (around line 15):

```tsx
import { useTradeHistory } from "./hooks/useTradeHistory";
import { useEquityTimeline } from "./hooks/useEquityTimeline";
import { useRollingMetrics } from "./hooks/useRollingMetrics";
```

**Edit 2: Compose the new hooks** — just after the line `const simulation = useTradingSimulation(algos, activeRuns, dataSources);` (around line 52 today), add:

```tsx
const tradeHistory = useTradeHistory(algos, activeRuns);
const equity = useEquityTimeline(tradeHistory.roundtrips);
const rolling = useRollingMetrics(tradeHistory.roundtrips);
```

**Edit 3: Pass the new props to `TradingView`** — replace the current `{activeView === "trading" && (...)}` block with:

```tsx
{activeView === "trading" && (
  <TradingView
    simulation={simulation}
    tradeHistory={tradeHistory}
    equity={equity}
    rolling={rolling}
    algos={algos}
    activeRuns={activeRuns}
    dataSources={dataSources}
    accounts={accounts}
    initialContext={pendingNavContext}
    onContextConsumed={clearPendingNavContext}
    onNavigate={handleNavigate}
  />
)}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors. If TypeScript reports errors about the removed props on `TradingView` (e.g. `algos`, `activeRuns`), re-check Edit 3 above — the new prop shape should match.

- [ ] **Step 4: Smoke — launch the dev app and walk through the view**

Run: `npm run dev`
In the app, navigate to the Trading view. Verify:

- **No charts connected:** "Connect a NinjaTrader chart…" message shows below the hero.
- **Connect a chart, start a live algo:** filter bar appears with Chart / Account / Algo chips. Hero KPIs show zeros initially. Equity chart is a flat zero line.
- **First position opens:** Live tab — position card appears with Live pill, `held Xs` counts up; order tape shows the entry order. Hero's Unrealized updates.
- **Position closes:** a roundtrip appears in the Trades tab. Performance tab: By Algo / By Symbol / By Account each gain a row. Analytics tab: distribution histogram gains a bar; heatmap cell gains color; rolling-metrics chart appears (starting with a "partial window" notice).
- **Start a shadow algo:** second position card with Shadow pill; equity chart gains a dashed yellow series.
- **Click a roundtrip row:** detail panel opens to the right (60/40 split). Shows execution, MAE/MFE, and the per-tick unrealized P&L SVG. Press Esc or click × to close.
- **Filter bar:** click a Chart chip — every tab narrows; clearing returns to aggregate.
- **Deep-link out:** on the Performance tab, click the `→` on an algo row. The app navigates to the Editor with that algo in view.
- **Deep-link in:** on the Algos view, click "View trades" (or the existing Trading deep-link in Algos view detail panel). The Trading view opens with the account filter applied and scrolls/activates the Live tab.

- [ ] **Step 5: Commit**

```bash
git add src/views/TradingView.tsx src/App.tsx
git commit -m "feat(trading): unified dashboard — hero, filters, tabs, detail drill-down"
```

---

### Task 11: Final smoke walk-through and polish

**Files:**
- Modify only if issues surface during smoke.

- [ ] **Step 1: Type-check + build**

Run: `npm run build`
Expected: zero TypeScript errors, Vite bundle succeeds.

- [ ] **Step 2: Smoke — full walk-through**

Launch `npm run dev`. With NinjaTrader running and at least one chart connected, walk through every user flow from the spec. Focus areas:

- **Pinned hero always visible.** Scroll within any tab — hero + filter bar + tab bar should not scroll off.
- **Filter bar union.** After several algos have started + stopped, the Algo filter should include stopped algos that still have roundtrips in history (not only currently-running ones). Chart and Account filters similarly.
- **Live + Shadow on equity chart.** Run the same algo live and shadow simultaneously. Equity chart shows a solid line (live) and a dashed yellow line (shadow). Legend labels match.
- **Drawdown overlay.** Go briefly into drawdown (a losing trade). The underwater band appears beneath the live line in muted red and the hero's "Max DD" updates.
- **Performance tab filter consistency.** Apply the Algo filter to a specific algo — all three breakdown tables narrow to that algo's rows. The Live-vs-Shadow panel narrows accordingly.
- **Analytics tab.** With 20+ completed trades, verify Sharpe / Win% / Expectancy toggle in the rolling chart; switching does not reset filters. Heatmap highlights the hours/days where you traded most.
- **Trades tab drill-down.** Click several roundtrips in succession — detail panel updates in place. Scroll the roundtrips table while a detail is open; panel stays put.
- **Empty-state copy is correct** per the spec's empty-state table.
- **Nav in/out:**
  - From Algos view, `onNavigate("trading", { accountFilter: "<account>" })` lands with filter applied.
  - From Trading's Performance tab, clicking `→` on an algo row opens the Editor with that algo.
  - From Trading's Performance tab, clicking `→` on an account row opens the Algos view filtered to that account.
- **No regressions in Home / Editor / Algos views.** Visit each briefly — their data comes from `useTradingSimulation` which is unchanged.

- [ ] **Step 3: Visual polish pass**

Open each tab and check for:
- Table row padding consistent across Performance tab's three breakdown tables.
- Card / panel gaps uniform at 12px (`gap-3`).
- Pill casing consistent (Live / Shadow / filled / cancelled / working).
- Equity chart legend not overflowing on narrow viewports.
- Position card "held Xm" counter doesn't flicker (it only updates on React re-renders, not per-frame — this is intentional; verify it updates when a new `nt-position` event arrives).

If anything looks off, fix inline in the relevant component file. Type-check after each fix.

- [ ] **Step 4: Commit any polish fixes**

Only if Step 3 surfaced changes:

```bash
git add -u
git commit -m "style(trading): post-smoke polish"
```

- [ ] **Step 5: Push branch and open PR**

Run:

```bash
git push -u origin feat/trading-view-redesign
```

Then open a pull request targeting `main` with:

**Title:** `feat: trading view redesign — unified dashboard (hero + filters + tabs + drill-down)`

**Body** (use the following template, adapting as needed):

```markdown
## Summary
Rebuilds the Trading view as a unified dashboard per `docs/superpowers/specs/2026-04-19-trading-view-redesign-design.md`:

- Pinned hero (7 KPIs + equity curve with drawdown overlay)
- Global Chart / Account / Algo filter bar
- Four tabs: Live, Performance, Analytics, Trades
- Right-side drill-down panel for per-roundtrip execution + MAE/MFE

Adds three sibling hooks (`useTradeHistory`, `useEquityTimeline`, `useRollingMetrics`) alongside the existing `useTradingSimulation` (unchanged). No backend / Tauri / event-payload changes.

## Test plan
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Smoke per `docs/superpowers/plans/2026-04-19-trading-view-redesign.md` Task 11 Step 2
- [ ] Home / Editor / Algos views unchanged visually and functionally
```

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| Pure helpers (`tradingView.ts`, `roundtrips.ts`) | Task 1 |
| `useTradeHistory` hook (roundtrip pairing, aggregates) | Task 2 |
| `useEquityTimeline` hook | Task 3 |
| `useRollingMetrics` hook | Task 4 |
| Pinned hero (KPIs + equity + drawdown overlay) | Tasks 5, 10 |
| Global Chart/Account/Algo filter bar | Tasks 5, 10 |
| Tabs (Live / Performance / Analytics / Trades) | Tasks 5, 10 |
| Live tab (position cards, risk summary, order tape) | Task 6 |
| Performance tab (by-algo/symbol/account, live-vs-shadow) | Task 7 |
| Analytics tab (distribution, heatmap, rolling metrics) | Task 8 |
| Trades tab + drill-down panel (MAE/MFE chart) | Task 9 |
| `App.tsx` wiring | Task 10 |
| Shadow data inline (pills, dashed equity series) | Tasks 5, 6, 7, 8, 9 |
| No mode toggle | Task 10 (filter set has no mode key) |
| Deep-link contract (algo → editor, account → algos) | Task 7 + Task 10 (`onNavigate` wiring) |
| Empty states for: no charts / no runs / filter excludes all / no trade selected | Task 10 (view) + Tasks 6–9 (per tab) |
| In-memory only (no persistence across restarts) | Task 10 (local `useState` only) |
| No backend / Rust / Tauri / event-schema changes | All tasks |
| Smoke verification | Task 10 Step 4, Task 11 Step 2 |

All spec requirements map to at least one task.

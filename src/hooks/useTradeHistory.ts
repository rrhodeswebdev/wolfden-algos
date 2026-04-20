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
import type { AlgoStats } from "./useTradingSimulation";

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

type TradeEvent = {
  source_id: string;
  account: string;
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  entry_price: number;
  exit_price: number;
  exit_time: number;
  pnl: number;
  gross_pnl: number;
  commission: number;
  flattens: boolean;
  order_id: string;
  instance_id: string;
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
  // Accumulated P&L from nt-trade events (NT-reported, authoritative for live accounts)
  ntPnl: number;
  ntTradeCount: number;
  ntExitPrice: number | null;
  // Flat arrived from NT but we're still waiting for the nt-trade event that carries
  // NT's final realized P&L. Finalize the roundtrip when the trade arrives (or on timeout).
  closingPending: boolean;
  closingFlatTimestamp: number | null;
  closingTimeoutId: ReturnType<typeof setTimeout> | null;
};

// Live accounts wait this long after nt-position Flat for the nt-trade event before
// falling back to the unrealized snapshot. NT normally posts realized-P&L within a few
// hundred ms of the fill; 3 seconds is a generous safety net.
const TRADE_WAIT_MS = 3000;

export type TradeHistory = {
  roundtrips: Roundtrip[];
  byAlgo: BreakdownRow[];
  bySymbol: BreakdownRow[];
  byAccount: BreakdownRow[];
  liveVsShadow: LiveShadowPair[];
  distribution: DistributionBucket[];
  heatmap: HeatCell[][];
  // Live per-instance performance derived from roundtrips (keyed by AlgoRun.instance_id).
  // Used to override backtest-only AlgoStats on the Algos/Home views so per-algo P&L reflects
  // actual trade activity once the algo has closed at least one roundtrip.
  statsByInstance: Record<string, AlgoStats>;
  pnlHistoryByInstance: Record<string, number[]>;
};

const aggregateByInstance = (
  roundtrips: Roundtrip[],
): { stats: Record<string, AlgoStats>; pnlHistories: Record<string, number[]> } => {
  const groups = new Map<string, Roundtrip[]>();
  for (const r of roundtrips) {
    if (!r.instanceId) continue; // unattributed — skip (shows as zero on the view)
    const existing = groups.get(r.instanceId) ?? [];
    existing.push(r);
    groups.set(r.instanceId, existing);
  }
  const stats: Record<string, AlgoStats> = {};
  const pnlHistories: Record<string, number[]> = {};
  for (const [instanceId, trips] of groups) {
    const sorted = [...trips].sort((a, b) => a.closeTimestamp - b.closeTimestamp);
    const wins = sorted.filter((t) => t.pnl > 0);
    const losses = sorted.filter((t) => t.pnl < 0);
    const totalPnl = sorted.reduce((s, t) => s + t.pnl, 0);
    const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const winRate = sorted.length > 0 ? Math.round((wins.length / sorted.length) * 100) : 0;
    const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
    const avgLoss =
      losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const profitFactor =
      totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : wins.length > 0 ? "∞" : "--";

    const cum: number[] = [];
    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const r of sorted) {
      running += r.pnl;
      cum.push(Math.round(running * 100) / 100);
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const pnls = sorted.map((t) => t.pnl);
    const mean = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    const variance =
      pnls.length > 0 ? pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length : 0;
    const std = Math.sqrt(variance);
    const sharpe = pnls.length >= 2 && std > 0 ? (mean / std).toFixed(2) : "--";

    stats[instanceId] = {
      totalTrades: sorted.length,
      winRate,
      pnl: Math.round(totalPnl * 100) / 100,
      sharpe,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor,
    };
    pnlHistories[instanceId] = cum;
  }
  return { stats, pnlHistories };
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

  // Finalize a pending roundtrip. Called either when the nt-trade event arrives (carrying
  // NT's authoritative net P&L) or when the trade-wait timer expires (fallback path —
  // uses the last unrealized snapshot, which may drift from NT's real number).
  const finalizeRoundtrip = (posKey: string) => {
    const open = openPositions.current.get(posKey);
    if (!open) return;
    if (open.closingTimeoutId) {
      clearTimeout(open.closingTimeoutId);
      open.closingTimeoutId = null;
    }
    const closeTs = open.closingFlatTimestamp ?? Date.now();
    const { algoId, algoName, instanceId } = resolveAttribution(open.dataSourceId, open.account);
    const { mae, mfe } = deriveMaeMfe(open.samples);
    const useNtPnl = open.account !== "shadow" && open.ntTradeCount > 0;
    const finalPnl = useNtPnl ? open.ntPnl : open.lastPnl;
    const exitPrice = open.ntExitPrice ?? open.lastExitPrice ?? open.entryPrice;
    const trip: Roundtrip = {
      id: `${posKey}-${open.openTimestamp}`,
      symbol: open.symbol,
      side: open.side,
      qty: open.qty,
      entryPrice: open.entryPrice,
      exitPrice,
      openTimestamp: open.openTimestamp,
      closeTimestamp: closeTs,
      pnl: Math.round(finalPnl * 100) / 100,
      mae: Math.round(mae * 100) / 100,
      mfe: Math.round(mfe * 100) / 100,
      rMultiple: computeRMultiple(finalPnl, mae),
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
        const isShadow = open.account === "shadow";
        // Shadow accounts don't go through NT and never get nt-trade events; finalize now.
        // Live accounts with a trade already buffered (event arrived before Flat) finalize now.
        // Otherwise wait for nt-trade; if it never arrives within TRADE_WAIT_MS, fall back.
        if (isShadow || open.ntTradeCount > 0) {
          open.closingFlatTimestamp = now;
          finalizeRoundtrip(posKey);
        } else {
          open.closingPending = true;
          open.closingFlatTimestamp = now;
          open.closingTimeoutId = setTimeout(() => finalizeRoundtrip(posKey), TRADE_WAIT_MS);
        }
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
          ntPnl: 0,
          ntTradeCount: 0,
          ntExitPrice: null,
          closingPending: false,
          closingFlatTimestamp: null,
          closingTimeoutId: null,
        });
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // NinjaTrader-reported realized P&L per roundtrip. Accumulates into the open position;
  // if the Flat event already arrived and is waiting on the trade, finalize immediately.
  useEffect(() => {
    const unlisten = listen<TradeEvent>("nt-trade", (event) => {
      const t = event.payload;
      const posKey = posKeyOf(t.source_id, t.symbol, t.account);
      const open = openPositions.current.get(posKey);
      if (!open) return;
      open.ntPnl += t.pnl;
      open.ntTradeCount += 1;
      open.ntExitPrice = t.exit_price;
      if (open.closingPending) {
        finalizeRoundtrip(posKey);
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
          if (val.closingTimeoutId) clearTimeout(val.closingTimeoutId);
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
  const byInstance = useMemo(() => aggregateByInstance(roundtrips), [roundtrips]);

  return {
    roundtrips,
    byAlgo,
    bySymbol,
    byAccount,
    liveVsShadow,
    distribution,
    heatmap,
    statsByInstance: byInstance.stats,
    pnlHistoryByInstance: byInstance.pnlHistories,
  };
};

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

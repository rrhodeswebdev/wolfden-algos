import { useState, useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";

export type StrategyPnlEvent = {
  source_id: string;
  account: string;
  symbol: string;
  realized: number;
  unrealized: number;
  total: number;
};

export type StrategyPnl = {
  sourceId: string;
  account: string;
  symbol: string;
  realized: number;
  unrealized: number;
  total: number;
};

export type StrategyPnlState = {
  /** Per-strategy snapshot keyed by `${source_id}:${account}`. */
  byKey: Record<string, StrategyPnl>;
  /** Aggregate across every strategy the bridge has reported. */
  total: { realized: number; unrealized: number; total: number };
};

const keyOf = (sourceId: string, account: string): string => `${sourceId}:${account}`;

/**
 * Subscribes to `nt-strategy-pnl` events from the bridge. Each WolfDenBridge
 * instance (one per NT chart) emits its own strategy P&L snapshot periodically;
 * NT's Strategy Performance view sums the same underlying numbers, so displaying
 * these directly guarantees the Trading View matches NT.
 *
 * The bridge emits keyed by `source_id` (e.g. "ES 09-26:5min"); we key by
 * source_id + account so different accounts trading the same symbol are separate.
 * When a chart disconnects, the caller clears it through `nt-chart-removed`.
 */
export const useStrategyPnl = (): StrategyPnlState => {
  const [byKey, setByKey] = useState<Record<string, StrategyPnl>>({});

  useEffect(() => {
    const unlisten = listen<StrategyPnlEvent>("nt-strategy-pnl", (event) => {
      const e = event.payload;
      const k = keyOf(e.source_id, e.account);
      setByKey((prev) => ({
        ...prev,
        [k]: {
          sourceId: e.source_id,
          account: e.account,
          symbol: e.symbol,
          realized: e.realized,
          unrealized: e.unrealized,
          total: e.total,
        },
      }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Drop snapshots for charts that disconnected — otherwise the hero keeps showing
  // stale P&L for a strategy that isn't running anymore.
  useEffect(() => {
    const unlisten = listen<string>("nt-chart-removed", (event) => {
      const removedId = event.payload;
      setByKey((prev) => {
        const next: Record<string, StrategyPnl> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.sourceId !== removedId) next[k] = v;
        }
        return next;
      });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const total = useMemo(() => {
    let realized = 0;
    let unrealized = 0;
    for (const v of Object.values(byKey)) {
      realized += v.realized;
      unrealized += v.unrealized;
    }
    return {
      realized: Math.round(realized * 100) / 100,
      unrealized: Math.round(unrealized * 100) / 100,
      total: Math.round((realized + unrealized) * 100) / 100,
    };
  }, [byKey]);

  return { byKey, total };
};

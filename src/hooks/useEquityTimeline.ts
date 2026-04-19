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

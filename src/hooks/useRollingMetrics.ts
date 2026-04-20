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

import { useState, useEffect, useRef } from "react";

type Algo = {
  id: number;
  name: string;
};

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
};

export type Position = {
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  avgPrice: number;
  pnl: number;
  targetPnl: number;
  algo: string;
  algoId: number;
};

export type SimOrder = {
  id: number;
  time: string;
  symbol: string;
  side: "Buy" | "Sell";
  qty: number;
  price: number;
  status: "Filled" | "Working" | "Cancelled";
  algo: string;
  algoId: number;
};

export type AlgoStats = {
  totalTrades: number;
  winRate: number;
  pnl: number;
  sharpe: string;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: string;
};

export type TradingSimulation = {
  positions: Position[];
  orders: SimOrder[];
  pnlHistory: number[];
  stats: {
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    winRate: number;
    totalTrades: number;
    maxDrawdown: number;
    sharpe: string;
  };
  algoStats: Record<number, AlgoStats>;
};

const SYMBOLS = ["ES", "NQ", "YM", "RTY", "CL", "GC"];

const randomFrom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

export const basePrices: Record<string, number> = {
  ES: 5425.50, NQ: 19850.25, YM: 40125.00, RTY: 2085.50, CL: 78.45, GC: 2345.80,
};

export const tickSizes: Record<string, number> = {
  ES: 0.25, NQ: 0.25, YM: 1.0, RTY: 0.10, CL: 0.01, GC: 0.10,
};

export const formatPrice = (symbol: string, price: number) => {
  const tick = tickSizes[symbol] ?? 0.01;
  const rounded = Math.round(price / tick) * tick;
  const decimals = tick < 0.1 ? 2 : tick < 1 ? 1 : 0;
  return rounded.toFixed(decimals);
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Assign each algo a consistent symbol pool based on its id
const getAlgoSymbols = (algoId: number): string[] => {
  const shuffled = [...SYMBOLS].sort((a, b) => {
    const ha = (algoId * 31 + a.charCodeAt(0)) % 100;
    const hb = (algoId * 31 + b.charCodeAt(0)) % 100;
    return ha - hb;
  });
  return shuffled.slice(0, 2 + (algoId % 3));
};

// Per-algo stats that stay consistent across views — seeded by algo id but with
// realistic, correlated numbers
const computeAlgoStats = (algoId: number, orders: SimOrder[], positions: Position[]): AlgoStats => {
  const algoOrders = orders.filter((o) => o.algoId === algoId && o.status === "Filled");
  const algoPositions = positions.filter((p) => p.algoId === algoId);
  const totalTrades = algoOrders.length;
  const seed = algoId * 7;
  const winRate = totalTrades > 0 ? 52 + (seed % 20) : 0;
  const pnl = algoPositions.reduce((sum, p) => sum + p.targetPnl, 0);
  const sharpe = totalTrades > 3 ? (1.2 + (seed % 15) / 10).toFixed(2) : "--";
  const maxDrawdown = totalTrades > 0 ? -(200 + (seed % 800)) : 0;
  const avgWin = totalTrades > 0 ? 180 + (seed % 120) : 0;
  const avgLoss = totalTrades > 0 ? -(120 + (seed % 80)) : 0;
  const profitFactor = totalTrades > 3 ? (1.1 + (seed % 20) / 10).toFixed(2) : "--";

  return { totalTrades, winRate, pnl, sharpe, maxDrawdown, avgWin, avgLoss, profitFactor };
};

export const useTradingSimulation = (algos: Algo[], activeRuns: AlgoRun[]): TradingSimulation => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<SimOrder[]>([]);
  const [pnlHistory, setPnlHistory] = useState<number[]>([0]);
  const nextOrderId = useRef(1);
  const prevRunIdsRef = useRef<Set<number>>(new Set());

  const runningAlgos = algos.filter((a) => activeRuns.some((r) => r.algo_id === a.id));
  const getAlgoName = (id: number) => algos.find((a) => a.id === id)?.name ?? "unknown";

  // When an algo starts: seed initial positions + entry orders
  // When an algo stops: close its positions + add exit orders
  useEffect(() => {
    const currentRunIds = new Set(activeRuns.map((r) => r.algo_id));
    const prevRunIds = prevRunIdsRef.current;

    // Newly started algos
    const started = [...currentRunIds].filter((id) => !prevRunIds.has(id));
    // Newly stopped algos
    const stopped = [...prevRunIds].filter((id) => !currentRunIds.has(id));

    if (started.length > 0) {
      const newPositions: Position[] = [];
      const newOrders: SimOrder[] = [];
      const now = new Date();

      for (const algoId of started) {
        const algoName = getAlgoName(algoId);
        const symbols = getAlgoSymbols(algoId);

        for (const symbol of symbols) {
          const base = basePrices[symbol] ?? 100;
          const side = randomFrom(["Long", "Short"] as const);
          const price = parseFloat(formatPrice(symbol, base + randomBetween(-3, 3)));
          const qty = Math.ceil(Math.random() * 4);
          const pnl = randomBetween(-50, 100);

          newPositions.push({
            symbol,
            side,
            qty,
            avgPrice: price,
            pnl,
            targetPnl: pnl,
            algo: algoName,
            algoId,
          });

          newOrders.push({
            id: nextOrderId.current++,
            time: formatTime(now),
            symbol,
            side: side === "Long" ? "Buy" : "Sell",
            qty,
            price,
            status: "Filled",
            algo: algoName,
            algoId,
          });
        }
      }

      setPositions((prev) => [...prev, ...newPositions]);
      setOrders((prev) => [...newOrders, ...prev].slice(0, 100));
    }

    if (stopped.length > 0) {
      const exitOrders: SimOrder[] = [];
      const now = new Date();

      setPositions((prev) => {
        const closing = prev.filter((p) => stopped.includes(p.algoId));
        for (const pos of closing) {
          const base = basePrices[pos.symbol] ?? 100;
          exitOrders.push({
            id: nextOrderId.current++,
            time: formatTime(now),
            symbol: pos.symbol,
            side: pos.side === "Long" ? "Sell" : "Buy",
            qty: pos.qty,
            price: parseFloat(formatPrice(pos.symbol, base + randomBetween(-2, 2))),
            status: "Filled",
            algo: pos.algo,
            algoId: pos.algoId,
          });
        }
        return prev.filter((p) => !stopped.includes(p.algoId));
      });

      if (exitOrders.length > 0) {
        setOrders((prev) => [...exitOrders, ...prev].slice(0, 100));
      }
    }

    prevRunIdsRef.current = currentRunIds;
  }, [activeRuns, algos]);

  // Jitter P&L targets for running positions
  useEffect(() => {
    if (runningAlgos.length === 0) return;
    const interval = setInterval(() => {
      setPositions((prev) =>
        prev.map((p) => ({
          ...p,
          targetPnl: p.targetPnl + randomBetween(-15, 15),
        }))
      );
    }, 1500);
    return () => clearInterval(interval);
  }, [runningAlgos.length]);

  // Add P&L chart points
  useEffect(() => {
    if (runningAlgos.length === 0) return;
    const interval = setInterval(() => {
      setPnlHistory((prev) => {
        const last = prev[prev.length - 1] ?? 0;
        const drift = runningAlgos.length * randomBetween(-15, 18);
        return [...prev.slice(-119), Math.round((last + drift) * 100) / 100];
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [runningAlgos.length]);

  // Generate new orders from running algos
  useEffect(() => {
    if (runningAlgos.length === 0) return;
    const interval = setInterval(() => {
      const algo = randomFrom(runningAlgos);
      const symbols = getAlgoSymbols(algo.id);
      const symbol = randomFrom(symbols);
      const base = basePrices[symbol] ?? 100;
      const side = randomFrom(["Buy", "Sell"] as const);
      const status = randomFrom(["Filled", "Filled", "Filled", "Working"] as const);

      const newOrder: SimOrder = {
        id: nextOrderId.current++,
        time: formatTime(new Date()),
        symbol,
        side,
        qty: Math.ceil(Math.random() * 4),
        price: parseFloat(formatPrice(symbol, base + randomBetween(-5, 5))),
        status,
        algo: algo.name,
        algoId: algo.id,
      };

      setOrders((prev) => [newOrder, ...prev].slice(0, 100));
    }, 3000);
    return () => clearInterval(interval);
  }, [runningAlgos]);

  // Occasionally open/close positions for running algos
  useEffect(() => {
    if (runningAlgos.length === 0) return;
    const interval = setInterval(() => {
      setPositions((prev) => {
        const action = Math.random();
        const runningPositions = prev.filter((p) =>
          activeRuns.some((r) => r.algo_id === p.algoId)
        );

        if (action < 0.25 && runningPositions.length > runningAlgos.length) {
          // Close a random position (keep at least one per algo)
          const idx = Math.floor(Math.random() * prev.length);
          const target = prev[idx];
          const algoPositionCount = prev.filter((p) => p.algoId === target.algoId).length;
          if (algoPositionCount <= 1) return prev;
          return prev.filter((_, i) => i !== idx);
        } else if (action < 0.4 && runningPositions.length < runningAlgos.length * 4) {
          // Open a new position for a random running algo
          const algo = randomFrom(runningAlgos);
          const usedSymbols = prev.filter((p) => p.algoId === algo.id).map((p) => p.symbol);
          const available = SYMBOLS.filter((s) => !usedSymbols.includes(s));
          if (available.length === 0) return prev;
          const symbol = randomFrom(available);
          const base = basePrices[symbol] ?? 100;
          const pnl = randomBetween(-80, 80);
          return [
            ...prev,
            {
              symbol,
              side: randomFrom(["Long", "Short"] as const),
              qty: Math.ceil(Math.random() * 4),
              avgPrice: parseFloat(formatPrice(symbol, base + randomBetween(-3, 3))),
              pnl,
              targetPnl: pnl,
              algo: algo.name,
              algoId: algo.id,
            },
          ];
        }
        return prev;
      });
    }, 8000);
    return () => clearInterval(interval);
  }, [runningAlgos, activeRuns]);

  // Compute aggregate stats
  const realizedPnl = pnlHistory[pnlHistory.length - 1] ?? 0;
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.targetPnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const filledOrders = orders.filter((o) => o.status === "Filled");
  const totalTrades = filledOrders.length;
  const wins = Math.ceil(totalTrades * 0.58);
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  const maxDrawdown = pnlHistory.length > 0 ? Math.min(...pnlHistory, 0) : 0;
  const sharpe = pnlHistory.length > 2
    ? (() => {
        const returns = pnlHistory.slice(1).map((v, i) => v - pnlHistory[i]);
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
        return std > 0 ? (mean / std).toFixed(2) : "--";
      })()
    : "--";

  // Per-algo stats
  const algoStats: Record<number, AlgoStats> = {};
  for (const run of activeRuns) {
    algoStats[run.algo_id] = computeAlgoStats(run.algo_id, orders, positions);
  }

  return {
    positions,
    orders,
    pnlHistory,
    stats: { realizedPnl, unrealizedPnl, totalPnl, winRate, totalTrades, maxDrawdown, sharpe },
    algoStats,
  };
};

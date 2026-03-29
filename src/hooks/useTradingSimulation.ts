import { useState, useEffect, useRef } from "react";

type Algo = {
  id: number;
  name: string;
};

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
  account: string;
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
  account: string;
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
  account: string;
};

export const ACCOUNTS = ["Demo-1", "Demo-2", "Demo-3", "Demo-4", "Demo-5"] as const;

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
  runPnlHistories: Record<string, number[]>;
  stats: {
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    winRate: number;
    totalTrades: number;
    wins: number;
    losses: number;
    maxDrawdown: number;
    sharpe: string;
    profitFactor: string;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
    openPositions: number;
    avgTradeDuration: string;
    consecutiveWins: number;
    consecutiveLosses: number;
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

const runKey = (r: AlgoRun) => `${r.algo_id}:${r.account}`;

export const useTradingSimulation = (algos: Algo[], activeRuns: AlgoRun[]): TradingSimulation => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<SimOrder[]>([]);
  const [pnlHistory, setPnlHistory] = useState<number[]>([0]);
  const nextOrderId = useRef(1);
  const prevRunKeysRef = useRef<Set<string>>(new Set());

  const runningAlgos = algos.filter((a) => activeRuns.some((r) => r.algo_id === a.id));
  const getAlgoName = (id: number) => algos.find((a) => a.id === id)?.name ?? "unknown";

  // When an algo starts on an account: seed initial positions + entry orders
  // When an algo stops on an account: close its positions + add exit orders
  useEffect(() => {
    const currentKeys = new Set(activeRuns.map(runKey));
    const prevKeys = prevRunKeysRef.current;

    // Newly started runs
    const startedKeys = [...currentKeys].filter((k) => !prevKeys.has(k));
    const stoppedKeys = [...prevKeys].filter((k) => !currentKeys.has(k));

    const started = startedKeys.map((k) => {
      const [idStr, account] = k.split(":");
      return { algoId: parseInt(idStr), account };
    });
    const stopped = stoppedKeys.map((k) => {
      const [idStr, account] = k.split(":");
      return { algoId: parseInt(idStr), account };
    });

    if (started.length > 0) {
      const newPositions: Position[] = [];
      const newOrders: SimOrder[] = [];
      const now = new Date();

      for (const { algoId, account } of started) {
        const algoName = getAlgoName(algoId);
        const symbols = getAlgoSymbols(algoId);

        for (const symbol of symbols) {
          const base = basePrices[symbol] ?? 100;
          const side = randomFrom(["Long", "Short"] as const);
          const price = parseFloat(formatPrice(symbol, base + randomBetween(-3, 3)));
          const qty = Math.ceil(Math.random() * 4);
          const pnl = randomBetween(-50, 100);

          newPositions.push({
            symbol, side, qty, avgPrice: price, pnl, targetPnl: pnl,
            algo: algoName, algoId, account,
          });

          newOrders.push({
            id: nextOrderId.current++, time: formatTime(now),
            symbol, side: side === "Long" ? "Buy" : "Sell", qty, price,
            status: "Filled", algo: algoName, algoId, account,
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
        const closing = prev.filter((p) =>
          stopped.some((s) => s.algoId === p.algoId && s.account === p.account)
        );
        for (const pos of closing) {
          const base = basePrices[pos.symbol] ?? 100;
          exitOrders.push({
            id: nextOrderId.current++, time: formatTime(now),
            symbol: pos.symbol, side: pos.side === "Long" ? "Sell" : "Buy",
            qty: pos.qty, price: parseFloat(formatPrice(pos.symbol, base + randomBetween(-2, 2))),
            status: "Filled", algo: pos.algo, algoId: pos.algoId, account: pos.account,
          });
        }
        return prev.filter((p) =>
          !stopped.some((s) => s.algoId === p.algoId && s.account === p.account)
        );
      });

      if (exitOrders.length > 0) {
        setOrders((prev) => [...exitOrders, ...prev].slice(0, 100));
      }

      // Clean up per-run P&L histories for stopped runs
      setRunPnlHistories((prev) => {
        const next = { ...prev };
        for (const { algoId, account } of stopped) {
          delete next[`${algoId}:${account}`];
        }
        return next;
      });
    }

    prevRunKeysRef.current = currentKeys;
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

  const [runPnlHistories, setRunPnlHistories] = useState<Record<string, number[]>>({});

  // Add P&L chart points (aggregate + per-run)
  useEffect(() => {
    if (activeRuns.length === 0) return;
    const interval = setInterval(() => {
      const runDrifts: Record<string, number> = {};
      let totalDrift = 0;
      for (const run of activeRuns) {
        const key = runKey(run);
        const drift = randomBetween(-15, 18);
        runDrifts[key] = drift;
        totalDrift += drift;
      }

      setPnlHistory((prev) => {
        const last = prev[prev.length - 1] ?? 0;
        return [...prev.slice(-119), Math.round((last + totalDrift) * 100) / 100];
      });

      setRunPnlHistories((prev) => {
        const next = { ...prev };
        for (const run of activeRuns) {
          const key = runKey(run);
          const history = next[key] ?? [0];
          const last = history[history.length - 1] ?? 0;
          next[key] = [...history.slice(-119), Math.round((last + runDrifts[key]) * 100) / 100];
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [activeRuns.length]);

  // Simulate active trading: open new positions, close existing ones, generate orders
  useEffect(() => {
    if (runningAlgos.length === 0) return;

    // Close a position (with exit order)
    const closeInterval = setInterval(() => {
      setPositions((prev) => {
        if (prev.length <= runningAlgos.length) return prev; // keep at least 1 per algo
        const idx = Math.floor(Math.random() * prev.length);
        const pos = prev[idx];
        const algoCount = prev.filter((p) => p.algoId === pos.algoId).length;
        if (algoCount <= 1) return prev; // don't close last position for an algo

        const base = basePrices[pos.symbol] ?? 100;
        const exitPrice = parseFloat(formatPrice(pos.symbol, base + randomBetween(-3, 3)));
        const exitOrder: SimOrder = {
          id: nextOrderId.current++,
          time: formatTime(new Date()),
          symbol: pos.symbol,
          side: pos.side === "Long" ? "Sell" : "Buy",
          qty: pos.qty,
          price: exitPrice,
          status: "Filled",
          algo: pos.algo,
          algoId: pos.algoId,
          account: pos.account,
        };
        setOrders((o) => [exitOrder, ...o].slice(0, 100));
        return prev.filter((_, i) => i !== idx);
      });
    }, 4000 + Math.random() * 2000);

    // Open a new position (with entry order)
    const openInterval = setInterval(() => {
      if (activeRuns.length === 0) return;
      const run = randomFrom(activeRuns);
      const algo = algos.find((a) => a.id === run.algo_id);
      if (!algo) return;
      setPositions((prev) => {
        const runPositions = prev.filter((p) => p.algoId === algo.id && p.account === run.account);
        if (runPositions.length >= 4) return prev;
        const usedSymbols = runPositions.map((p) => p.symbol);
        const available = SYMBOLS.filter((s) => !usedSymbols.includes(s));
        if (available.length === 0) return prev;

        const symbol = randomFrom(available);
        const base = basePrices[symbol] ?? 100;
        const side = randomFrom(["Long", "Short"] as const);
        const price = parseFloat(formatPrice(symbol, base + randomBetween(-3, 3)));
        const qty = Math.ceil(Math.random() * 4);
        const pnl = randomBetween(-30, 30);

        const entryOrder: SimOrder = {
          id: nextOrderId.current++, time: formatTime(new Date()),
          symbol, side: side === "Long" ? "Buy" : "Sell", qty, price,
          status: "Filled", algo: algo.name, algoId: algo.id, account: run.account,
        };
        setOrders((o) => [entryOrder, ...o].slice(0, 100));

        return [
          ...prev,
          { symbol, side, qty, avgPrice: price, pnl, targetPnl: pnl, algo: algo.name, algoId: algo.id, account: run.account },
        ];
      });
    }, 5000 + Math.random() * 3000);

    // Occasional working orders that don't result in positions (limit orders, cancels)
    const workingInterval = setInterval(() => {
      if (activeRuns.length === 0) return;
      const run = randomFrom(activeRuns);
      const algo = algos.find((a) => a.id === run.algo_id);
      if (!algo) return;
      const symbols = getAlgoSymbols(algo.id);
      const symbol = randomFrom(symbols);
      const base = basePrices[symbol] ?? 100;
      const status = randomFrom(["Working", "Working", "Cancelled"] as const);

      const order: SimOrder = {
        id: nextOrderId.current++, time: formatTime(new Date()),
        symbol, side: randomFrom(["Buy", "Sell"] as const),
        qty: Math.ceil(Math.random() * 3),
        price: parseFloat(formatPrice(symbol, base + randomBetween(-8, 8))),
        status, algo: algo.name, algoId: algo.id, account: run.account,
      };
      setOrders((o) => [order, ...o].slice(0, 100));
    }, 6000 + Math.random() * 4000);

    return () => {
      clearInterval(closeInterval);
      clearInterval(openInterval);
      clearInterval(workingInterval);
    };
  }, [runningAlgos]);

  // Compute aggregate stats
  const realizedPnl = pnlHistory[pnlHistory.length - 1] ?? 0;
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.targetPnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const filledOrders = orders.filter((o) => o.status === "Filled");
  const totalTrades = filledOrders.length;
  const wins = Math.ceil(totalTrades * 0.58);
  const losses = totalTrades - wins;
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

  // Simulated per-trade P&L for detailed metrics (seeded from trade count)
  const seed = totalTrades * 13;
  const avgWin = totalTrades > 0 ? 145 + (seed % 80) : 0;
  const avgLoss = totalTrades > 0 ? -(95 + (seed % 50)) : 0;
  const largestWin = totalTrades > 0 ? avgWin * 2.8 : 0;
  const largestLoss = totalTrades > 0 ? avgLoss * 2.2 : 0;
  const profitFactor = totalTrades > 3 && losses > 0
    ? ((wins * avgWin) / (losses * Math.abs(avgLoss))).toFixed(2)
    : "--";
  const openPositions = positions.length;
  const avgTradeDuration = totalTrades > 0
    ? `${Math.floor(2 + (seed % 8))}m ${Math.floor(seed % 60)}s`
    : "--";
  const consecutiveWins = totalTrades > 0 ? 2 + (seed % 5) : 0;
  const consecutiveLosses = totalTrades > 0 ? 1 + (seed % 3) : 0;

  // Per-algo stats
  const algoStats: Record<number, AlgoStats> = {};
  for (const run of activeRuns) {
    algoStats[run.algo_id] = computeAlgoStats(run.algo_id, orders, positions);
  }

  return {
    positions,
    orders,
    pnlHistory,
    runPnlHistories,
    stats: {
      realizedPnl, unrealizedPnl, totalPnl, winRate, totalTrades, wins, losses,
      maxDrawdown, sharpe, profitFactor, avgWin, avgLoss, largestWin, largestLoss,
      openPositions, avgTradeDuration, consecutiveWins, consecutiveLosses,
    },
    algoStats,
  };
};

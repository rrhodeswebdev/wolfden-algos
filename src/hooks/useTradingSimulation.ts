import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Algo, AlgoRun } from "../types";

export type DataSource = {
  id: string;           // "ES 09-26:5min"
  instrument: string;   // "ES 09-26"
  timeframe: string;    // "5min"
  account: string;      // "Sim101"
};

export type AlgoInstance = {
  id: string;
  algo_id: number;
  data_source_id: string;
  account: string;
  mode: "live" | "shadow";
  status: "stopped" | "starting" | "running" | "error";
  max_position_size: number;
  max_daily_loss: number;
  max_daily_trades: number;
  stop_loss_ticks: number | null;
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
  dataSourceId: string;
  instanceId: string;
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
  dataSourceId: string;
  instanceId: string;
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
  label?: string;
};

export type TradingSimulation = {
  positions: Position[];
  orders: SimOrder[];
  pnlHistory: number[];
  shadowPnlHistory: number[];
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
  shadowStats: {
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
  algoStats: Record<string, AlgoStats>;
};

export const formatPrice = (_symbol: string, price: number) => {
  return price.toFixed(2);
};

// --- Event payload types from Rust ---

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

type AccountSnapshot = {
  name: string;
  buying_power: number;
  cash: number;
  realized_pnl: number;
  unrealized_pnl: number;
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

type CompletedTrade = {
  pnl: number;
};

type BacktestResultEvent = {
  instance_id: string;
  algo_id: string;
  source_id: string;
  bars_count: number;
  pnl?: number;
  win_rate?: number;
  sharpe?: string;
  profit_factor?: string;
  total_trades?: number;
  avg_win?: number;
  avg_loss?: number;
  max_drawdown?: number;
  skipped?: boolean;
  reason?: string;
};

const formatTime = (ts: number | null) => {
  const date = ts ? new Date(ts) : new Date();
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const mapOrderStatus = (state: string): "Filled" | "Working" | "Cancelled" => {
  switch (state) {
    case "filled":
    case "partial":
      return "Filled";
    case "cancelled":
    case "rejected":
      return "Cancelled";
    default:
      return "Working";
  }
};

const mapSide = (side: string | null): "Buy" | "Sell" => {
  if (side === "SELL" || side === "Sell") return "Sell";
  return "Buy";
};

export const useTradingSimulation = (_algos: Algo[], _activeRuns: AlgoRun[], _dataSources: DataSource[]): TradingSimulation => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<SimOrder[]>([]);
  const [pnlHistory, setPnlHistory] = useState<number[]>([0]);
  const [realizedPnl, setRealizedPnl] = useState(0);
  const [shadowPnlHistory, setShadowPnlHistory] = useState<number[]>([0]);
  const [shadowRealizedPnl, setShadowRealizedPnl] = useState(0);
  const shadowRealizedPnlRef = useRef(0);
  const [completedTrades, setCompletedTrades] = useState<CompletedTrade[]>([]);
  const [shadowCompletedTrades, setShadowCompletedTrades] = useState<CompletedTrade[]>([]);
  const [backtestStats, setBacktestStats] = useState<Record<string, AlgoStats & { label?: string }>>({});
  const nextOrderId = useRef(1);
  // Track last known unrealized P&L per position key (used as fallback for shadow accounts)
  const positionPnlRef = useRef<Map<string, number>>(new Map());
  // NT-reported realized P&L accumulated per open position (authoritative for live accounts)
  const ntPnlRef = useRef<Map<string, number>>(new Map());
  const ntTradeCountRef = useRef<Map<string, number>>(new Map());
  // Live positions whose Flat event arrived before nt-trade — we defer recording the
  // completed trade until the NT-reported P&L lands (or the timeout expires).
  const pendingCloseRef = useRef<Map<string, { isShadow: boolean; timeoutId: ReturnType<typeof setTimeout> }>>(new Map());
  // Track which positions are shadow (by posKey)
  const shadowPositionKeys = useRef<Set<string>>(new Set());

  const TRADE_WAIT_MS_SIM = 3000;
  // Ref to avoid stale closures in the sampling interval
  const realizedPnlRef = useRef(0);

  // Listen for account updates to get realized P&L from NinjaTrader
  useEffect(() => {
    const unlisten = listen<AccountSnapshot>("nt-account", (event) => {
      const a = event.payload;
      if (a.realized_pnl !== 0 || a.cash !== 0) {
        const prev = realizedPnlRef.current;
        setRealizedPnl(a.realized_pnl);
        realizedPnlRef.current = a.realized_pnl;
        // Append to P&L history only when realized P&L changes (trade closure)
        if (a.realized_pnl !== prev) {
          setPnlHistory((h) => {
            const next = [...h, a.realized_pnl];
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Record a completed trade into the stats pipeline. Called either when Flat + nt-trade
  // have both arrived, or when the post-Flat timeout expires and we fall back to the
  // unrealized snapshot. Separated from the Flat handler so the UI position removal can
  // happen immediately while the stat recording waits for NT's authoritative number.
  const recordCompletedTrade = (posKey: string, isShadow: boolean) => {
    const pending = pendingCloseRef.current.get(posKey);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingCloseRef.current.delete(posKey);
    }
    const ntCount = ntTradeCountRef.current.get(posKey) ?? 0;
    const ntPnl = ntPnlRef.current.get(posKey) ?? 0;
    const lastPnl = positionPnlRef.current.get(posKey) ?? 0;
    const tradePnl = !isShadow && ntCount > 0 ? ntPnl : lastPnl;
    if (tradePnl !== 0) {
      if (isShadow) {
        setShadowCompletedTrades((prev) => {
          const next = [...prev, { pnl: tradePnl }];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
        const newTotal = Math.round((shadowRealizedPnlRef.current + tradePnl) * 100) / 100;
        setShadowRealizedPnl(newTotal);
        shadowRealizedPnlRef.current = newTotal;
        setShadowPnlHistory((h) => {
          const next = [...h, newTotal];
          return next.length > 500 ? next.slice(-500) : next;
        });
      } else {
        setCompletedTrades((prev) => {
          const next = [...prev, { pnl: tradePnl }];
          return next.length > 1000 ? next.slice(-1000) : next;
        });
      }
    }
    positionPnlRef.current.delete(posKey);
    ntPnlRef.current.delete(posKey);
    ntTradeCountRef.current.delete(posKey);
    shadowPositionKeys.current.delete(posKey);
  };

  // Listen for position updates from NinjaTrader
  useEffect(() => {
    const unlisten = listen<PositionEvent>("nt-position", (event) => {
      const p = event.payload;
      const posKey = `${p.source_id}:${p.symbol}`;

      const isShadow = p.account === "shadow";

      if (p.direction === "Flat" || p.qty === 0) {
        // Remove the live position from the UI immediately.
        setPositions((prev) => prev.filter(
          (pos) => !(pos.dataSourceId === p.source_id && pos.symbol === p.symbol)
        ));

        // Record the completed trade. For shadow or already-arrived NT trade: record now.
        // For live waiting on nt-trade: defer up to TRADE_WAIT_MS_SIM so stats reflect NT's number.
        const ntCount = ntTradeCountRef.current.get(posKey) ?? 0;
        if (isShadow || ntCount > 0) {
          recordCompletedTrade(posKey, isShadow);
        } else {
          const timeoutId = setTimeout(() => recordCompletedTrade(posKey, false), TRADE_WAIT_MS_SIM);
          pendingCloseRef.current.set(posKey, { isShadow: false, timeoutId });
        }
        return;
      }

      // Track current unrealized P&L for this position
      positionPnlRef.current.set(posKey, p.unrealized_pnl);
      if (isShadow) shadowPositionKeys.current.add(posKey);

      const side: "Long" | "Short" = p.direction === "Long" ? "Long" : "Short";
      const newPos: Position = {
        symbol: p.symbol,
        side,
        qty: Math.abs(p.qty),
        avgPrice: p.avg_price,
        pnl: p.unrealized_pnl,
        targetPnl: p.unrealized_pnl,
        algo: "",
        algoId: 0,
        account: p.account,
        dataSourceId: p.source_id,
        instanceId: "",
      };

      setPositions((prev) => {
        const idx = prev.findIndex(
          (pos) => pos.dataSourceId === p.source_id && pos.symbol === p.symbol
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = newPos;
          return next;
        }
        return [...prev, newPos];
      });
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Listen for NT-reported trade P&L (authoritative realized P&L for the roundtrip).
  // If Flat already arrived and we're waiting on this event, finalize now instead of
  // letting the timeout fall back to the unrealized snapshot.
  useEffect(() => {
    const unlisten = listen<TradeEvent>("nt-trade", (event) => {
      const t = event.payload;
      const posKey = `${t.source_id}:${t.symbol}`;
      ntPnlRef.current.set(posKey, (ntPnlRef.current.get(posKey) ?? 0) + t.pnl);
      ntTradeCountRef.current.set(posKey, (ntTradeCountRef.current.get(posKey) ?? 0) + 1);
      const pending = pendingCloseRef.current.get(posKey);
      if (pending) {
        recordCompletedTrade(posKey, pending.isShadow);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Listen for order updates from NinjaTrader
  useEffect(() => {
    const unlisten = listen<OrderEvent>("nt-order-update", (event) => {
      const o = event.payload;
      const status = mapOrderStatus(o.state);

      setOrders((prev) => {
        const idx = prev.findIndex((ord) => ord.instanceId === o.order_id);
        if (idx >= 0) {
          // Update existing order
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            status,
            qty: o.filled_qty ?? next[idx].qty,
            price: o.fill_price ?? o.avg_fill_price ?? next[idx].price,
          };
          return next;
        }
        // New order
        const newOrder: SimOrder = {
          id: nextOrderId.current++,
          time: formatTime(o.timestamp),
          symbol: o.symbol,
          side: mapSide(o.side),
          qty: o.filled_qty ?? o.remaining ?? 0,
          price: o.fill_price ?? o.avg_fill_price ?? 0,
          status,
          algo: "",
          algoId: 0,
          account: o.account,
          dataSourceId: o.source_id,
          instanceId: o.order_id,
        };
        return [newOrder, ...prev].slice(0, 200);
      });
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Remove positions/orders when a chart disconnects
  useEffect(() => {
    const unlisten = listen<string>("nt-chart-removed", (event) => {
      const removedId = event.payload;
      setPositions((prev) => prev.filter((p) => p.dataSourceId !== removedId));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Listen for backtest results from algo runners
  useEffect(() => {
    const unlisten = listen<BacktestResultEvent>("algo-backtest-result", (event) => {
      const r = event.payload;
      if (r.skipped) {
        // Tick-only algo — no backtest available
        return;
      }
      const instanceId = r.instance_id;
      const days = r.bars_count > 0 ? Math.max(1, Math.round(r.bars_count / 78)) : 0; // ~78 5min bars per day
      const label = days > 0 ? `Backtest (${days}d)` : "Backtest";
      setBacktestStats((prev) => ({
        ...prev,
        [instanceId]: {
          pnl: r.pnl ?? 0,
          winRate: r.win_rate ?? 0,
          sharpe: r.sharpe ?? "--",
          profitFactor: r.profit_factor ?? "--",
          totalTrades: r.total_trades ?? 0,
          avgWin: r.avg_win ?? 0,
          avgLoss: r.avg_loss ?? 0,
          maxDrawdown: r.max_drawdown ?? 0,
          label,
        },
      }));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);


  // Compute stats for a given set of trades and history
  const computeStats = (
    realized: number,
    positionList: Position[],
    trades: CompletedTrade[],
    history: number[],
  ) => {
    const unrealized = positionList.reduce((sum, p) => sum + p.pnl, 0);
    const total = realized + unrealized;

    let peak = 0;
    let dd = 0;
    for (const v of history) {
      if (v > peak) peak = v;
      const currentDd = peak - v;
      if (currentDd > dd) dd = currentDd;
    }

    const w = trades.filter((t) => t.pnl > 0);
    const l = trades.filter((t) => t.pnl < 0);
    const wc = w.length;
    const lc = l.length;
    const tc = wc + lc;
    const winRate = tc > 0 ? Math.round((wc / tc) * 100) : 0;
    const avgWin = wc > 0 ? w.reduce((s, t) => s + t.pnl, 0) / wc : 0;
    const avgLoss = lc > 0 ? l.reduce((s, t) => s + t.pnl, 0) / lc : 0;
    const largestWin = wc > 0 ? Math.max(...w.map((t) => t.pnl)) : 0;
    const largestLoss = lc > 0 ? Math.min(...l.map((t) => t.pnl)) : 0;
    const totalWin = w.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : wc > 0 ? "∞" : "--";

    let consecutiveWins = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if (trades[i].pnl > 0) consecutiveWins++;
      else break;
    }
    let consecutiveLosses = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if (trades[i].pnl < 0) consecutiveLosses++;
      else break;
    }

    const sharpe = history.length > 2
      ? (() => {
          const returns = history.slice(1).map((v, i) => v - history[i]);
          const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
          const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
          return std > 0 ? (mean / std).toFixed(2) : "--";
        })()
      : "--";

    return {
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      totalPnl: total,
      winRate,
      totalTrades: tc,
      wins: wc,
      losses: lc,
      maxDrawdown: dd,
      sharpe,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      openPositions: positionList.length,
      avgTradeDuration: "--" as const,
      consecutiveWins,
      consecutiveLosses,
    };
  };

  const livePositions = positions.filter((p) => p.account !== "shadow");
  const shadowPositions = positions.filter((p) => p.account === "shadow");
  const liveStats = computeStats(realizedPnl, livePositions, completedTrades, pnlHistory);
  const shadowStatsComputed = computeStats(shadowRealizedPnl, shadowPositions, shadowCompletedTrades, shadowPnlHistory);

  // Build per-instance algoStats: start with backtest, merge live data on top
  const algoStats: Record<string, AlgoStats> = {};
  for (const [instanceId, bt] of Object.entries(backtestStats)) {
    algoStats[instanceId] = {
      pnl: bt.pnl,
      winRate: bt.winRate,
      sharpe: bt.sharpe,
      profitFactor: bt.profitFactor,
      totalTrades: bt.totalTrades,
      avgWin: bt.avgWin,
      avgLoss: bt.avgLoss,
      maxDrawdown: bt.maxDrawdown,
      label: bt.label,
    };
  }

  return {
    positions,
    orders,
    pnlHistory,
    shadowPnlHistory,
    runPnlHistories: {},
    stats: liveStats,
    shadowStats: shadowStatsComputed,
    algoStats,
  };
};

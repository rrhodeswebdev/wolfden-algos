import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

type Algo = {
  id: number;
  name: string;
};

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

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
  account: string;
  data_source_id: string;
  instance_id: string;
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
  filled_qty: number | null;
  avg_fill_price: number | null;
  fill_price: number | null;
  remaining: number | null;
  error: string | null;
  timestamp: number | null;
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

export const useTradingSimulation = (_algos: Algo[], _activeRuns: AlgoRun[], _dataSources: DataSource[]): TradingSimulation => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<SimOrder[]>([]);
  const [pnlHistory, setPnlHistory] = useState<number[]>([0]);
  const nextOrderId = useRef(1);

  // Listen for position updates from NinjaTrader
  useEffect(() => {
    const unlisten = listen<PositionEvent>("nt-position", (event) => {
      const p = event.payload;

      if (p.direction === "Flat" || p.qty === 0) {
        // Position closed — remove it
        setPositions((prev) => prev.filter(
          (pos) => !(pos.dataSourceId === p.source_id && pos.symbol === p.symbol)
        ));
        return;
      }

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
          side: "Buy", // Will be updated when we have direction info
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

  // Sample P&L history every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPositions((currentPositions) => {
        const unrealizedPnl = currentPositions.reduce((sum, p) => sum + p.pnl, 0);
        if (currentPositions.length > 0 || pnlHistory.length > 1) {
          setPnlHistory((prev) => [...prev.slice(-119), Math.round(unrealizedPnl * 100) / 100]);
        }
        return currentPositions;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [pnlHistory.length]);

  // Compute stats from real data
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const filledOrders = orders.filter((o) => o.status === "Filled");
  const totalTrades = filledOrders.length;
  const realizedPnl = pnlHistory[pnlHistory.length - 1] ?? 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const maxDrawdown = pnlHistory.length > 0 ? Math.min(...pnlHistory, 0) : 0;

  const sharpe = pnlHistory.length > 2
    ? (() => {
        const returns = pnlHistory.slice(1).map((v, i) => v - pnlHistory[i]);
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
        return std > 0 ? (mean / std).toFixed(2) : "--";
      })()
    : "--";

  return {
    positions,
    orders,
    pnlHistory,
    runPnlHistories: {},
    stats: {
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      winRate: 0,
      totalTrades,
      wins: 0,
      losses: 0,
      maxDrawdown,
      sharpe,
      profitFactor: "--",
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      openPositions: positions.length,
      avgTradeDuration: "--",
      consecutiveWins: 0,
      consecutiveLosses: 0,
    },
    algoStats: {},
  };
};

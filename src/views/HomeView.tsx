import type { Algo, AlgoRun, NavOptions, View } from "../types";
import type { AlgoStats } from "../hooks/useTradingSimulation";

type Position = {
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

type SessionStats = {
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

type AccountData = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

type HomeViewProps = {
  connectionStatus: "waiting" | "connected" | "error";
  accounts: Record<string, AccountData>;
  algos: Algo[];
  activeRuns: AlgoRun[];
  stats: SessionStats;
  positions: Position[];
  pnlHistory: number[];
  runPnlHistories: Record<string, number[]>;
  algoStats: Record<string, AlgoStats>;
  onNavigate: (view: View, options?: NavOptions) => void;
  onStopAlgo: (instanceId: string) => void;
};

export const HomeView = (props: HomeViewProps) => {
  const accountCount = Object.keys(props.accounts).length;
  const runningCount = props.activeRuns.length;
  const connectionLabel =
    props.connectionStatus === "connected"
      ? `Connected to NinjaTrader · ${accountCount} account${accountCount === 1 ? "" : "s"} · ${runningCount} algo${runningCount === 1 ? "" : "s"} running`
      : props.connectionStatus === "error"
        ? "Connection error"
        : "Waiting for NinjaTrader…";
  const statusColor =
    props.connectionStatus === "connected"
      ? "bg-[var(--accent-green)]"
      : props.connectionStatus === "error"
        ? "bg-[var(--accent-red)]"
        : "bg-[var(--accent-yellow)] animate-pulse";

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-[var(--bg-primary)]">
      <div className="max-w-[1400px] w-full mx-auto p-5 flex flex-col gap-4">
        {/* Section 0: Compact header */}
        <div id="home-section-header" className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Wolf Den</h1>
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span>{connectionLabel}</span>
          </div>
        </div>

        {/* Section 1: Account strip — filled in Task 5 */}
        <div id="home-section-accounts" />

        {/* Section 2: KPI row — filled in Task 6 */}
        <div id="home-section-kpis" />

        {/* Section 3: Hero P&L chart — filled in Task 7 */}
        <div id="home-section-chart" />

        {/* Section 4: Bottom split (algos tape + performance) — filled in Tasks 8 & 9 */}
        <div id="home-section-bottom" className="grid grid-cols-3 gap-4">
          <div id="home-section-algos" className="col-span-2" />
          <div id="home-section-performance" className="col-span-1" />
        </div>
      </div>
    </div>
  );
};

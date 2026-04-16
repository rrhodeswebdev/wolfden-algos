import type { Algo, AlgoRun } from "../types";

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
};

const formatPnl = (value: number) => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
};

const pnlColor = (value: number) =>
  value >= 0 ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";

export const HomeView = ({ connectionStatus, accounts, algos, activeRuns, stats, positions }: HomeViewProps) => {
  const accountNames = Object.keys(accounts);
  const hasActivity = activeRuns.length > 0;
  const t = stats.totalTrades;

  const accountPositionCount = (accountName: string) =>
    positions.filter((p) => p.account === accountName).length;

  const accountPnl = (accountName: string) =>
    positions.filter((p) => p.account === accountName).reduce((sum, p) => sum + p.targetPnl, 0);

  const accountRunCount = (accountName: string) =>
    activeRuns.filter((r) => r.account === accountName).length;

  const isAccountActive = (accountName: string) => accountRunCount(accountName) > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Hero Header */}
      <div className="px-5 pt-5 pb-4 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <h1 className="text-xl font-semibold mb-1">Wolf Den</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          Algorithmic trading command center
        </p>
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              connectionStatus === "connected"
                ? "bg-[var(--accent-green)]"
                : connectionStatus === "error"
                  ? "bg-[var(--accent-red)]"
                  : "bg-[var(--accent-yellow)] animate-pulse"
            }`}
          />
          <span
            className={`text-sm ${
              connectionStatus === "connected"
                ? "text-[var(--accent-green)]"
                : connectionStatus === "error"
                  ? "text-[var(--accent-red)]"
                  : "text-[var(--accent-yellow)]"
            }`}
          >
            {connectionStatus === "connected" && "Connected to NinjaTrader"}
            {connectionStatus === "waiting" && "Waiting for NinjaTrader..."}
            {connectionStatus === "error" && "Connection error"}
          </span>
        </div>
      </div>

      {/* Three-Column Layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column: Accounts */}
        <div className="flex-1 p-5 overflow-auto border-r border-[var(--border)]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Accounts
          </h2>

          <div className="space-y-3">
            {accountNames.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No accounts connected
              </p>
            ) : accountNames.map((name) => {
              const data = accounts[name];
              const balance = data.cash || data.buying_power;
              const dayPnl = data.realized_pnl + accountPnl(name);
              return (
                <div
                  key={name}
                  className="p-4 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          isAccountActive(name)
                            ? "bg-[var(--accent-green)]"
                            : "bg-[var(--border)]"
                        }`}
                      />
                      <span className="text-sm font-medium">{name}</span>
                    </div>
                    <span className="text-[10px] uppercase text-[var(--text-secondary)]">
                      NinjaTrader
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Balance</div>
                      <div className="text-sm font-medium">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Day P&L</div>
                      <div className={`text-sm font-medium ${dayPnl !== 0 ? pnlColor(dayPnl) : ""}`}>
                        {dayPnl !== 0 ? formatPnl(dayPnl) : "$0.00"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Positions</div>
                      <div className="text-sm font-medium">{accountPositionCount(name)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Middle Column: Session Stats */}
        <div className="flex-1 p-5 overflow-auto border-r border-[var(--border)]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Today's Session
          </h2>

          <div className="space-y-3">
            <StatRow
              label="Total P&L"
              value={hasActivity ? formatPnl(stats.totalPnl) : "$0.00"}
              color={hasActivity ? pnlColor(stats.totalPnl) : undefined}
            />
            <StatRow
              label="Realized"
              value={hasActivity ? formatPnl(stats.realizedPnl) : "$0.00"}
              color={hasActivity ? pnlColor(stats.realizedPnl) : undefined}
            />
            <StatRow
              label="Unrealized"
              value={hasActivity ? formatPnl(stats.unrealizedPnl) : "$0.00"}
              color={hasActivity ? pnlColor(stats.unrealizedPnl) : undefined}
            />

            <div className="border-t border-[var(--border)]" />
            <SectionLabel label="Performance" />
            <StatRow label="Win Rate" value={t > 0 ? `${stats.winRate}%` : "--"} />
            <StatRow label="Profit Factor" value={stats.profitFactor} />
            <StatRow label="Sharpe Ratio" value={stats.sharpe} />
            <StatRow label="Max Drawdown" value={t > 0 ? formatPnl(stats.maxDrawdown) : "--"} color={t > 0 ? "text-[var(--accent-red)]" : undefined} />

            <div className="border-t border-[var(--border)]" />
            <SectionLabel label="Trades" />
            <StatRow label="Total Trades" value={`${stats.totalTrades}`} />
            <StatRow label="Wins / Losses" value={t > 0 ? `${stats.wins} / ${stats.losses}` : "0 / 0"} />
            <StatRow label="Avg Win" value={t > 0 ? formatPnl(stats.avgWin) : "--"} color={t > 0 ? "text-[var(--accent-green)]" : undefined} />
            <StatRow label="Avg Loss" value={t > 0 ? formatPnl(stats.avgLoss) : "--"} color={t > 0 ? "text-[var(--accent-red)]" : undefined} />
            <StatRow label="Largest Win" value={t > 0 ? formatPnl(stats.largestWin) : "--"} color={t > 0 ? "text-[var(--accent-green)]" : undefined} />
            <StatRow label="Largest Loss" value={t > 0 ? formatPnl(stats.largestLoss) : "--"} color={t > 0 ? "text-[var(--accent-red)]" : undefined} />
            <StatRow label="Avg Duration" value={stats.avgTradeDuration} />

            <div className="border-t border-[var(--border)]" />
            <SectionLabel label="Streaks" />
            <StatRow label="Consecutive Wins" value={t > 0 ? `${stats.consecutiveWins}` : "--"} color={t > 0 ? "text-[var(--accent-green)]" : undefined} />
            <StatRow label="Consecutive Losses" value={t > 0 ? `${stats.consecutiveLosses}` : "--"} color={t > 0 ? "text-[var(--accent-red)]" : undefined} />

            <div className="border-t border-[var(--border)]" />
            <SectionLabel label="Exposure" />
            <StatRow label="Open Positions" value={`${stats.openPositions}`} />
            <StatRow label="Active Algos" value={`${activeRuns.length}`} />
          </div>
        </div>

        {/* Right Column: Active Algos */}
        <div className="flex-1 flex flex-col p-5 overflow-auto">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Active Algos
          </h2>

          <div className="flex-1 min-h-0">
            {activeRuns.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No algos running — start one from the Algos view
              </p>
            ) : (
              <div className="space-y-2">
                {activeRuns.map((run) => {
                  const algo = algos.find((a) => a.id === run.algo_id);
                  if (!algo) return null;
                  return (
                    <div
                      key={run.instance_id}
                      className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            run.mode === "live"
                              ? "bg-[var(--accent-green)]"
                              : "bg-[var(--accent-yellow)]"
                          }`}
                        />
                        <div>
                          <span className="text-sm">{algo.name}</span>
                          <span className="text-xs text-[var(--text-secondary)] ml-2">
                            {run.data_source_id.split(":")[0].split(" ")[0]} {run.data_source_id.split(":")[1]}
                          </span>
                          <span className="text-xs text-[var(--text-secondary)] ml-1">{run.account}</span>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] uppercase px-2.5 py-1 rounded-md font-medium ${
                          run.mode === "live"
                            ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                            : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
                        }`}
                      >
                        {run.mode}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionLabel = ({ label }: { label: string }) => (
  <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold pt-1">
    {label}
  </div>
);

const StatRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
    <span className={`text-sm font-semibold ${color ?? ""}`}>{value}</span>
  </div>
);

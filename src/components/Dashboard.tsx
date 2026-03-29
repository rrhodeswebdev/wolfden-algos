type DashboardProps = {
  connectionStatus: "waiting" | "connected" | "error";
};

export const Dashboard = ({ connectionStatus }: DashboardProps) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Trading Dashboard
        </span>
      </div>
      <div className="flex-1 p-5 space-y-5 overflow-auto">
        {/* P&L Summary */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Realized P&L" value="$0.00" color="neutral" />
          <StatCard label="Unrealized P&L" value="$0.00" color="neutral" />
          <StatCard label="Total P&L" value="$0.00" color="neutral" />
        </div>

        {/* Session Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Win Rate" value="--" color="neutral" />
          <StatCard label="Trades" value="0" color="neutral" />
          <StatCard label="Max Drawdown" value="--" color="neutral" />
          <StatCard label="Sharpe" value="--" color="neutral" />
        </div>

        {/* Open Positions */}
        <div className="pt-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
            Open Positions
          </h3>
          <div className="text-sm text-[var(--text-secondary)]">
            {connectionStatus === "connected"
              ? "No open positions"
              : "Waiting for NinjaTrader connection..."}
          </div>
        </div>

        {/* Recent Trades */}
        <div className="pt-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
            Recent Trades
          </h3>
          <div className="text-sm text-[var(--text-secondary)]">No trades yet</div>
        </div>
      </div>
    </div>
  );
};

type StatCardProps = {
  label: string;
  value: string;
  color: "green" | "red" | "neutral";
};

const StatCard = ({ label, value, color }: StatCardProps) => {
  const colorClass =
    color === "green"
      ? "text-[var(--accent-green)]"
      : color === "red"
        ? "text-[var(--accent-red)]"
        : "text-[var(--text-primary)]";

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-2">
        {label}
      </div>
      <div className={`text-lg font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
};

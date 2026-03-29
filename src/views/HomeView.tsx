type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
};

type Algo = {
  id: number;
  name: string;
};

type HomeViewProps = {
  connectionStatus: "waiting" | "connected" | "error";
  algos: Algo[];
  activeRuns: AlgoRun[];
};

export const HomeView = ({ connectionStatus, algos, activeRuns }: HomeViewProps) => {
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

      {/* Two-Column Layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column: Session Stats */}
        <div className="flex-1 p-5 overflow-auto border-r border-[var(--border)]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Today's Session
          </h2>

          <div className="space-y-3">
            <StatRow label="Total P&L" value="$0.00" />
            <StatRow label="Realized" value="$0.00" />
            <StatRow label="Unrealized" value="$0.00" />
            <div className="border-t border-[var(--border)]" />
            <StatRow label="Win Rate" value="--" />
            <StatRow label="Trades" value="0" />
            <StatRow label="Max Drawdown" value="--" />
            <StatRow label="Sharpe Ratio" value="--" />
          </div>
        </div>

        {/* Right Column: Active Algos */}
        <div className="flex-1 flex flex-col p-5 overflow-auto">
          {/* Active Algos */}
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Active Algos
          </h2>

          <div className="flex-1 min-h-0">
            {activeRuns.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No algos running — start one from Algo Management
              </p>
            ) : (
              <div className="space-y-2">
                {activeRuns.map((run) => {
                  const algo = algos.find((a) => a.id === run.algo_id);
                  if (!algo) return null;
                  return (
                    <div
                      key={algo.id}
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
                        <span className="text-sm">{algo.name}</span>
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

const StatRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
    <span className="text-sm font-semibold">{value}</span>
  </div>
);

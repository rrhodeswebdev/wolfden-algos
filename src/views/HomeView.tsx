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
  onNavigate: (view: "algos" | "trading") => void;
};

export const HomeView = ({ connectionStatus, algos, activeRuns, onNavigate }: HomeViewProps) => {
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

        {/* Right Column: Active Algos + Quick Actions */}
        <div className="flex-1 flex flex-col p-5 overflow-auto">
          {/* Active Algos */}
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-4">
            Active Algos
          </h2>

          <div className="flex-1 min-h-0">
            {algos.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No algos yet — create one in Algo Management
              </p>
            ) : (
              <div className="space-y-2">
                {algos.map((algo) => {
                  const run = activeRuns.find((r) => r.algo_id === algo.id);
                  const isRunning = run?.status === "running";
                  return (
                    <div
                      key={algo.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            isRunning
                              ? run?.mode === "live"
                                ? "bg-[var(--accent-green)]"
                                : "bg-[var(--accent-yellow)]"
                              : "bg-[var(--border)]"
                          }`}
                        />
                        <span className="text-sm">{algo.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        {isRunning ? (
                          <span
                            className={`text-[10px] uppercase px-2.5 py-1 rounded-md font-medium ${
                              run?.mode === "live"
                                ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                                : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
                            }`}
                          >
                            {run?.mode}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)]">stopped</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Quick Actions
            </h2>
            <div className="flex gap-3">
              <button
                onClick={() => onNavigate("algos")}
                className="flex-1 flex items-center gap-3 p-3.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--accent-blue)]/40 transition-colors text-left"
              >
                <span className="text-xl">λ</span>
                <div>
                  <div className="text-sm font-medium">Algo Management</div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                    Write, edit & manage algos
                  </div>
                </div>
              </button>
              <button
                onClick={() => onNavigate("trading")}
                className="flex-1 flex items-center gap-3 p-3.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--accent-blue)]/40 transition-colors text-left"
              >
                <span className="text-xl">⇅</span>
                <div>
                  <div className="text-sm font-medium">Trading View</div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                    Positions, orders & P&L
                  </div>
                </div>
              </button>
            </div>
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

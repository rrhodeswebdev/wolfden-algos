import { type AlgoStats } from "../hooks/useTradingSimulation";

type Algo = {
  id: number;
  name: string;
  code: string;
  config: string | null;
  dependencies: string;
  deps_hash: string;
  created_at: string;
  updated_at: string;
};

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
};

type AlgosViewProps = {
  algos: Algo[];
  activeRuns: AlgoRun[];
  algoStats: Record<number, AlgoStats>;
  onStartAlgo: (id: number, mode: "live" | "shadow") => void;
  onStopAlgo: (id: number) => void;
};

type AlgoWithRun = {
  algo: Algo;
  run: AlgoRun | undefined;
};

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">{label}</div>
    <div className={`text-sm font-medium ${color ?? ""}`}>{value}</div>
  </div>
);

const PerformanceStats = ({ stats }: { stats: AlgoStats }) => {
  const pnlColor = stats.pnl >= 0 ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";

  return (
    <div className="grid grid-cols-4 gap-x-6 gap-y-3 px-6 pb-4 pt-2">
      <Stat label="P&L" value={`${stats.pnl >= 0 ? "+" : ""}$${Math.abs(Math.round(stats.pnl)).toLocaleString()}`} color={pnlColor} />
      <Stat label="Win Rate" value={stats.totalTrades > 0 ? `${stats.winRate}%` : "--"} />
      <Stat label="Sharpe" value={stats.sharpe} />
      <Stat label="Profit Factor" value={stats.profitFactor} />
      <Stat label="Total Trades" value={`${stats.totalTrades}`} />
      <Stat label="Avg Win" value={stats.totalTrades > 0 ? `+$${stats.avgWin}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined} />
      <Stat label="Avg Loss" value={stats.totalTrades > 0 ? `-$${Math.abs(stats.avgLoss)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined} />
      <Stat label="Max Drawdown" value={stats.totalTrades > 0 ? `-$${Math.abs(stats.maxDrawdown).toLocaleString()}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined} />
    </div>
  );
};

const AlgoRow = ({
  algo,
  run,
  stats,
  onStartAlgo,
  onStopAlgo,
}: AlgoWithRun & {
  stats: AlgoStats | undefined;
  onStartAlgo: (id: number, mode: "live" | "shadow") => void;
  onStopAlgo: (id: number) => void;
}) => (
  <div>
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <div>
          <div className="text-sm font-medium">{algo.name}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {run ? (
          <button
            onClick={() => onStopAlgo(algo.id)}
            className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Stop
          </button>
        ) : (
          <>
            <button
              onClick={() => onStartAlgo(algo.id, "shadow")}
              className="px-4 py-2 text-xs bg-[var(--accent-yellow)] text-black rounded-md hover:opacity-90 transition-opacity font-medium"
            >
              Shadow
            </button>
            <button
              onClick={() => onStartAlgo(algo.id, "live")}
              className="px-4 py-2 text-xs bg-[var(--accent-green)] text-black rounded-md hover:opacity-90 transition-opacity font-medium"
            >
              Live
            </button>
          </>
        )}
      </div>
    </div>
    {run && stats && <PerformanceStats stats={stats} />}
  </div>
);

const Section = ({
  title,
  count,
  color,
  children,
}: {
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) => (
  <div className="bg-[var(--bg-panel)] rounded-lg overflow-hidden">
    <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)]">
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {title}
      </span>
      <span className="text-xs text-[var(--text-secondary)]">{count}</span>
    </div>
    {count > 0 ? (
      <div className="divide-y divide-[var(--border)]">{children}</div>
    ) : (
      <div className="px-6 py-4 text-xs text-[var(--text-secondary)]">
        No algos
      </div>
    )}
  </div>
);

export const AlgosView = ({
  algos,
  activeRuns,
  algoStats,
  onStartAlgo,
  onStopAlgo,
}: AlgosViewProps) => {
  const getRunForAlgo = (id: number) => activeRuns.find((r) => r.algo_id === id);

  const liveAlgos = algos.filter((a) => getRunForAlgo(a.id)?.mode === "live");
  const shadowAlgos = algos.filter((a) => getRunForAlgo(a.id)?.mode === "shadow");
  const availableAlgos = algos.filter((a) => !getRunForAlgo(a.id));

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-auto">
      <Section title="Available" count={availableAlgos.length} color="bg-[var(--accent-blue)]">
        {availableAlgos.map((algo) => (
          <AlgoRow
            key={algo.id}
            algo={algo}
            run={getRunForAlgo(algo.id)}
            stats={algoStats[algo.id]}
            onStartAlgo={onStartAlgo}
            onStopAlgo={onStopAlgo}
          />
        ))}
      </Section>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Shadow" count={shadowAlgos.length} color="bg-[var(--accent-yellow)]">
          {shadowAlgos.map((algo) => (
            <AlgoRow
              key={algo.id}
              algo={algo}
              run={getRunForAlgo(algo.id)}
              stats={algoStats[algo.id]}
              onStartAlgo={onStartAlgo}
              onStopAlgo={onStopAlgo}
            />
          ))}
        </Section>

        <Section title="Live" count={liveAlgos.length} color="bg-[var(--accent-green)]">
          {liveAlgos.map((algo) => (
            <AlgoRow
              key={algo.id}
              algo={algo}
              run={getRunForAlgo(algo.id)}
              stats={algoStats[algo.id]}
              onStartAlgo={onStartAlgo}
              onStopAlgo={onStopAlgo}
            />
          ))}
        </Section>
      </div>
    </div>
  );
};

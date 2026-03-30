import { useState } from "react";
import { type AlgoStats, type DataSource, DUMMY_DATA_SOURCES } from "../hooks/useTradingSimulation";

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
  account: string;
  data_source_id: string;
  instance_id: string;
};

type AlgosViewProps = {
  algos: Algo[];
  activeRuns: AlgoRun[];
  algoStats: Record<string, AlgoStats>;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
  onStopAlgo: (instanceId: string) => void;
};

const formatDataSource = (ds: DataSource) => {
  const symbol = ds.instrument.split(" ")[0];
  return `${symbol} ${ds.timeframe}`;
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
      <Stat label="P&L" value={`${stats.pnl >= 0 ? "+" : ""}$${Math.abs(stats.pnl).toFixed(2)}`} color={pnlColor} />
      <Stat label="Win Rate" value={stats.totalTrades > 0 ? `${stats.winRate}%` : "--"} />
      <Stat label="Sharpe" value={stats.sharpe} />
      <Stat label="Profit Factor" value={stats.profitFactor} />
      <Stat label="Total Trades" value={`${stats.totalTrades}`} />
      <Stat label="Avg Win" value={stats.totalTrades > 0 ? `+$${stats.avgWin.toFixed(2)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined} />
      <Stat label="Avg Loss" value={stats.totalTrades > 0 ? `-$${Math.abs(stats.avgLoss).toFixed(2)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined} />
      <Stat label="Max Drawdown" value={stats.totalTrades > 0 ? `-$${Math.abs(stats.maxDrawdown).toFixed(2)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined} />
    </div>
  );
};

const ChartCard = ({
  ds,
  isSelected,
  runCount,
  onClick,
}: {
  ds: DataSource;
  isSelected: boolean;
  runCount: number;
  onClick: () => void;
}) => {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border transition-colors ${
        isSelected
          ? "bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/30"
          : "bg-[var(--bg-panel)] border-[var(--border)] hover:border-[var(--text-secondary)]/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--accent-green)]" />
          <span className="text-sm font-medium">{formatDataSource(ds)}</span>
        </div>
        {runCount > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">
            {runCount} algo{runCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
        <span>{ds.instrument}</span>
        <span>{ds.timeframe}</span>
        <span>{ds.account}</span>
      </div>
    </button>
  );
};

const AddAlgoPanel = ({
  algos,
  chartRuns,
  ds,
  onStartAlgo,
}: {
  algos: Algo[];
  chartRuns: AlgoRun[];
  ds: DataSource;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
}) => {
  const availableAlgos = algos.filter(
    (a) => !chartRuns.some((r) => r.algo_id === a.id)
  );

  if (availableAlgos.length === 0) {
    return (
      <div className="px-6 py-4 text-xs text-[var(--text-secondary)]">
        All algos are already running on this chart
      </div>
    );
  }

  return (
    <div className="px-6 py-4 border-t border-[var(--border)]">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-3 font-semibold">
        Add Algo
      </div>
      <div className="space-y-2">
        {availableAlgos.map((algo) => (
          <div
            key={algo.id}
            className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
          >
            <span className="text-sm font-medium">{algo.name}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onStartAlgo(algo.id, "shadow", ds.account, ds.id)}
                className="px-3 py-1.5 text-[11px] bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] rounded-md hover:bg-[var(--accent-yellow)]/25 transition-colors font-medium"
              >
                Shadow
              </button>
              <button
                onClick={() => onStartAlgo(algo.id, "live", ds.account, ds.id)}
                className="px-3 py-1.5 text-[11px] bg-[var(--accent-green)]/15 text-[var(--accent-green)] rounded-md hover:bg-[var(--accent-green)]/25 transition-colors font-medium"
              >
                Live
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const RunningInstanceRow = ({
  algo,
  run,
  stats,
  onStopAlgo,
}: {
  algo: Algo;
  run: AlgoRun;
  stats: AlgoStats | undefined;
  onStopAlgo: (instanceId: string) => void;
}) => (
  <div>
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{algo.name}</div>
            <span className={`text-[10px] uppercase px-2 py-0.5 rounded-md font-medium ${
              run.mode === "live"
                ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
            }`}>
              {run.mode}
            </span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">{run.account}</div>
        </div>
      </div>
      <button
        onClick={() => onStopAlgo(run.instance_id)}
        className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
      >
        Stop
      </button>
    </div>
    {stats && <PerformanceStats stats={stats} />}
  </div>
);

export const AlgosView = ({
  algos,
  activeRuns,
  algoStats,
  onStartAlgo,
  onStopAlgo,
}: AlgosViewProps) => {
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const dataSources = DUMMY_DATA_SOURCES;

  const selectedDs = dataSources.find((ds) => ds.id === selectedChartId) ?? null;
  const chartRuns = selectedChartId
    ? activeRuns.filter((r) => r.data_source_id === selectedChartId)
    : [];

  const getRunCount = (dsId: string) => activeRuns.filter((r) => r.data_source_id === dsId).length;

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-hidden">
      {/* Left: Charts Panel */}
      <div className="w-72 flex flex-col gap-3 overflow-auto flex-shrink-0">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Charts
          </h2>
          <span className="text-xs text-[var(--text-secondary)]">
            {dataSources.length} connected
          </span>
        </div>

        {dataSources.length === 0 ? (
          <div className="p-4 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)] text-xs text-[var(--text-secondary)]">
            No charts connected. Add the WolfDenBridge indicator to a NinjaTrader chart to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {dataSources.map((ds) => (
              <ChartCard
                key={ds.id}
                ds={ds}
                isSelected={selectedChartId === ds.id}
                runCount={getRunCount(ds.id)}
                onClick={() => setSelectedChartId(ds.id === selectedChartId ? null : ds.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: Chart Detail / Instance Management */}
      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {selectedDs ? (
          <>
            {/* Chart header */}
            <div className="bg-[var(--bg-panel)] rounded-lg p-4 border border-[var(--border)]">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent-green)]" />
                <h2 className="text-base font-semibold">{formatDataSource(selectedDs)}</h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)] ml-5">
                <span>{selectedDs.instrument}</span>
                <span>{selectedDs.timeframe}</span>
                <span>{selectedDs.account}</span>
              </div>
            </div>

            {/* Running instances on this chart */}
            <div className="flex-1 bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Running Algos
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">{chartRuns.length}</span>
                </div>
                {chartRuns.length > 0 && (
                  <button
                    onClick={() => chartRuns.forEach((r) => onStopAlgo(r.instance_id))}
                    className="px-3 py-1.5 text-[11px] bg-[var(--accent-red)]/15 text-[var(--accent-red)] rounded-md hover:bg-[var(--accent-red)]/25 transition-colors font-medium"
                  >
                    Stop All
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-auto divide-y divide-[var(--border)]">
                {chartRuns.length === 0 ? (
                  <div className="px-6 py-6 text-xs text-[var(--text-secondary)] text-center">
                    No algos running on this chart. Add one below.
                  </div>
                ) : (
                  chartRuns.map((run) => {
                    const algo = algos.find((a) => a.id === run.algo_id);
                    if (!algo) return null;
                    return (
                      <RunningInstanceRow
                        key={run.instance_id}
                        algo={algo}
                        run={run}
                        stats={algoStats[run.instance_id]}
                        onStopAlgo={onStopAlgo}
                      />
                    );
                  })
                )}
              </div>

              {/* Add algo to this chart */}
              <AddAlgoPanel
                  algos={algos}
                  chartRuns={chartRuns}
                  ds={selectedDs}
                  onStartAlgo={onStartAlgo}
                />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
            Select a chart to manage algos
          </div>
        )}
      </div>
    </div>
  );
};

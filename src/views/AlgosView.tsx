import { useState, useEffect } from "react";
import { type AlgoStats, type DataSource } from "../hooks/useTradingSimulation";
import { type InstanceErrors, type AlgoError } from "../hooks/useAlgoErrors";
import { type LogEntry } from "../hooks/useAlgoLogs";
import { type AlgoHealth } from "../hooks/useAlgoHealth";
import { LogPanel } from "../components/LogPanel";

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
  dataSources: DataSource[];
  activeRuns: AlgoRun[];
  algoStats: Record<string, AlgoStats>;
  errorsByInstance: Record<string, InstanceErrors>;
  logsByInstance: Record<string, LogEntry[]>;
  healthByInstance: Record<string, AlgoHealth>;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
  onStopAlgo: (instanceId: string) => void;
  onClearErrors: (instanceId: string) => void;
  onClearLogs: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
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
    <div>
      {stats.label && (
        <div className="px-6 pb-1">
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] font-medium">
            {stats.label}
          </span>
        </div>
      )}
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
    </div>
  );
};

const ErrorBadge = ({ errors }: { errors: InstanceErrors }) => {
  if (errors.errorCount === 0 && errors.warningCount === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {errors.errorCount > 0 && (
        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-[var(--accent-red)]/15 text-[var(--accent-red)]">
          {errors.errorCount} error{errors.errorCount !== 1 ? "s" : ""}
        </span>
      )}
      {errors.warningCount > 0 && (
        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
          {errors.warningCount} warning{errors.warningCount !== 1 ? "s" : ""}
        </span>
      )}
      {errors.autoStopped && (
        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-[var(--accent-red)]/15 text-[var(--accent-red)]">
          halted
        </span>
      )}
    </div>
  );
};

const formatErrorTime = (ts: number) => {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const ErrorRow = ({ error }: { error: AlgoError }) => {
  const [expanded, setExpanded] = useState(false);
  const severityColor = error.severity === "warning"
    ? "text-[var(--accent-yellow)]"
    : "text-[var(--accent-red)]";

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--text-secondary)] font-mono shrink-0">
            {formatErrorTime(error.timestamp)}
          </span>
          <span className={`text-[10px] uppercase font-medium shrink-0 ${severityColor}`}>
            {error.severity}
          </span>
          <span className="text-xs text-[var(--text-primary)] truncate">{error.message}</span>
          {error.handler && (
            <span className="text-[10px] text-[var(--text-secondary)] shrink-0 font-mono">
              {error.handler}
            </span>
          )}
        </div>
      </button>
      {expanded && error.traceback && (
        <div className="px-4 pb-3">
          <pre className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-md p-3 overflow-x-auto font-mono whitespace-pre-wrap">
            {error.traceback}
          </pre>
        </div>
      )}
    </div>
  );
};

const ErrorList = ({ errors }: { errors: InstanceErrors }) => {
  if (errors.errors.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] max-h-48 overflow-auto">
      {errors.autoStopped && (
        <div className="px-4 py-2 bg-[var(--accent-red)]/10 text-[var(--accent-red)] text-xs font-medium">
          Algo halted due to repeated errors
        </div>
      )}
      {errors.errors.map((error) => (
        <ErrorRow key={error.id} error={error} />
      ))}
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
  onOpenAiTerminal,
  aiTerminalAlgoIds,
}: {
  algos: Algo[];
  chartRuns: AlgoRun[];
  ds: DataSource;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
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
        {availableAlgos.map((algo) => {
          const hasActiveTerminal = aiTerminalAlgoIds?.has(algo.id) ?? false;
          return (
            <div
              key={algo.id}
              className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{algo.name}</span>
                {hasActiveTerminal && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-2">
                {onOpenAiTerminal && (
                  <button
                    onClick={() => onOpenAiTerminal(algo.id)}
                    disabled={hasActiveTerminal}
                    className={`px-3 py-1.5 text-[11px] rounded-md font-medium transition-colors ${
                      hasActiveTerminal
                        ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]/50 cursor-not-allowed"
                        : "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/25"
                    }`}
                  >
                    AI
                  </button>
                )}
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
          );
        })}
      </div>
    </div>
  );
};

const RunningInstanceRow = ({
  algo,
  run,
  stats,
  instanceErrors,
  isSelectedForLogs,
  onSelectForLogs,
  onStopAlgo,
  onOpenAiTerminal,
  hasActiveTerminal,
}: {
  algo: Algo;
  run: AlgoRun;
  stats: AlgoStats | undefined;
  instanceErrors: InstanceErrors | undefined;
  isSelectedForLogs: boolean;
  onSelectForLogs: () => void;
  onStopAlgo: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  hasActiveTerminal: boolean;
}) => {
  const [showErrors, setShowErrors] = useState(false);
  const hasErrors = instanceErrors && (instanceErrors.errorCount > 0 || instanceErrors.warningCount > 0);

  return (
    <div className={isSelectedForLogs ? "bg-[var(--accent-blue)]/5" : ""}>
      <div className="flex items-center justify-between px-6 py-4 cursor-pointer" onClick={onSelectForLogs}>
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">{algo.name}</div>
              {run.status === "installing" ? (
                <span className="text-[10px] uppercase px-2 py-0.5 rounded-md font-medium bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
                  installing deps
                </span>
              ) : (
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-md font-medium ${
                  run.mode === "live"
                    ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                    : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
                }`}>
                  {run.mode}
                </span>
              )}
              {hasActiveTerminal && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse" title="AI terminal active" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-[var(--text-secondary)]">{run.account}</span>
              {hasErrors && (
                <button onClick={() => setShowErrors(!showErrors)}>
                  <ErrorBadge errors={instanceErrors} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenAiTerminal && (
            <button
              onClick={() => onOpenAiTerminal(algo.id)}
              disabled={hasActiveTerminal}
              className={`px-3 py-1.5 text-[11px] rounded-md font-medium transition-colors ${
                hasActiveTerminal
                  ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]/50 cursor-not-allowed"
                  : "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/25"
              }`}
            >
              AI
            </button>
          )}
          <button
            onClick={() => onStopAlgo(run.instance_id)}
            disabled={run.status === "installing"}
            className={`px-4 py-2 text-xs rounded-md font-medium transition-opacity ${
              run.status === "installing"
                ? "bg-[var(--bg-secondary)] text-[var(--text-secondary)] cursor-not-allowed"
                : "bg-[var(--accent-red)] text-white hover:opacity-90"
            }`}
          >
            {run.status === "installing" ? "Installing..." : "Stop"}
          </button>
        </div>
      </div>
      {stats && <PerformanceStats stats={stats} />}
      {showErrors && hasErrors && <ErrorList errors={instanceErrors} />}
    </div>
  );
};

export const AlgosView = ({
  algos,
  dataSources,
  activeRuns,
  algoStats,
  errorsByInstance,
  logsByInstance,
  healthByInstance,
  onStartAlgo,
  onStopAlgo,
  onClearErrors: _onClearErrors,
  onClearLogs,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
}: AlgosViewProps) => {
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  // Auto-select first running algo on mount
  useEffect(() => {
    if (hasAutoSelected) return;
    const firstRunning = activeRuns.find((r) => r.status === "running");
    if (firstRunning) {
      setSelectedChartId(firstRunning.data_source_id);
      setSelectedInstanceId(firstRunning.instance_id);
      setHasAutoSelected(true);
    }
  }, [activeRuns, hasAutoSelected]);

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
                        instanceErrors={errorsByInstance[run.instance_id]}
                        isSelectedForLogs={selectedInstanceId === run.instance_id}
                        onSelectForLogs={() => setSelectedInstanceId(run.instance_id)}
                        onStopAlgo={onStopAlgo}
                        onOpenAiTerminal={onOpenAiTerminal}
                        hasActiveTerminal={aiTerminalAlgoIds?.has(algo.id) ?? false}
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
                  onOpenAiTerminal={onOpenAiTerminal}
                  aiTerminalAlgoIds={aiTerminalAlgoIds}
                />

              {/* Log Panel */}
              {selectedInstanceId && logsByInstance[selectedInstanceId] && (
                <LogPanel
                  logs={logsByInstance[selectedInstanceId]}
                  health={healthByInstance[selectedInstanceId]}
                  onClear={() => onClearLogs(selectedInstanceId)}
                />
              )}
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

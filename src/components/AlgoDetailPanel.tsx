import { useEffect, useState } from "react";
import type { InstanceView } from "../lib/algoInstanceView";
import { formatPnl, pnlColorClass } from "../lib/algoInstanceView";
import type { LogEntry } from "../hooks/useAlgoLogs";
import type { AlgoHealth } from "../hooks/useAlgoHealth";
import type { AlgoError } from "../hooks/useAlgoErrors";
import { LogPanel } from "./LogPanel";

type Tab = "logs" | "errors" | "config";

type AlgoDetailPanelProps = {
  instance: InstanceView | null;
  logs: LogEntry[];
  health: AlgoHealth | undefined;
  onClearLogs: () => void;
  onStop: () => void;
  onOpenInEditor: () => void;
  onViewTrades: () => void;
  onOpenAiTerminal?: () => void;
  hasActiveAiTerminal: boolean;
  onRunNewAlgo: () => void;
};

const formatErrorTime = (ts: number) => {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const ErrorRow = ({ error }: { error: AlgoError }) => {
  const [expanded, setExpanded] = useState(false);
  const severityColor =
    error.severity === "warning"
      ? "text-[var(--accent-yellow)]"
      : "text-[var(--accent-red)]";
  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
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

const Stat = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
      {label}
    </span>
    <span className={`text-sm font-mono font-medium tabular-nums ${color ?? ""}`}>
      {value}
    </span>
  </div>
);

const EmptyState = ({
  title,
  body,
  cta,
  onCta,
}: {
  title: string;
  body: string;
  cta?: string;
  onCta?: () => void;
}) => (
  <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center gap-3">
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="text-xs text-[var(--text-secondary)] max-w-[280px]">{body}</p>
    {cta && onCta && (
      <button
        type="button"
        onClick={onCta}
        className="mt-2 px-3 py-1.5 text-xs rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90"
      >
        {cta}
      </button>
    )}
  </div>
);

export const AlgoDetailPanel = ({
  instance,
  logs,
  health,
  onClearLogs,
  onStop,
  onOpenInEditor,
  onViewTrades,
  onOpenAiTerminal,
  hasActiveAiTerminal,
  onRunNewAlgo,
}: AlgoDetailPanelProps) => {
  const [tab, setTab] = useState<Tab>("logs");

  // Reset tab when selection changes: Errors if there are any, otherwise Logs.
  // We intentionally depend only on the instance id so that live error updates
  // on the currently-selected instance don't yank the user back to the Errors tab.
  const selId = instance?.run.instance_id ?? null;
  useEffect(() => {
    if (!instance) return;
    if (instance.errors && instance.errors.errorCount > 0) {
      setTab("errors");
    } else {
      setTab("logs");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  if (!instance) {
    return (
      <div className="w-[380px] border-l border-[var(--border)] bg-[var(--bg-panel)] flex flex-col">
        <EmptyState
          title="Select an instance to see details"
          body="Click a running algo on the left to see its stats, logs, errors, and quick actions."
          cta="Run your first algo"
          onCta={onRunNewAlgo}
        />
      </div>
    );
  }

  const { run, algo, dataSource, stats, errors, status } = instance;
  const pnl = stats?.pnl ?? 0;
  const errorCount = errors?.errorCount ?? 0;
  const warnCount = errors?.warningCount ?? 0;

  const pillClass =
    status === "halted"
      ? "bg-[var(--accent-red)]/15 text-[var(--accent-red)]"
      : run.mode === "live"
        ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
        : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]";

  const pillLabel = status === "halted" ? "Halted" : run.mode === "live" ? "Live" : "Shadow";

  return (
    <div className="w-[380px] border-l border-[var(--border)] bg-[var(--bg-panel)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{algo.name}</h3>
            <div className="text-[11px] text-[var(--text-secondary)] truncate">
              on {dataSource.instrument} {dataSource.timeframe}
            </div>
          </div>
          <button
            type="button"
            onClick={onStop}
            disabled={status === "halted" || run.status === "installing"}
            className="px-2.5 py-1 text-[11px] rounded-md font-medium bg-[var(--accent-red)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {run.status === "installing" ? "Installing…" : "Stop"}
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${pillClass}`}
          >
            {pillLabel}
          </span>
          <span className="text-[var(--text-secondary)]">{run.account}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <button
          type="button"
          onClick={onOpenInEditor}
          className="px-2.5 py-1 text-[11px] rounded-md font-medium bg-[var(--bg-panel)] border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] transition-colors"
        >
          λ Open in Editor
        </button>
        <button
          type="button"
          onClick={onViewTrades}
          className="px-2.5 py-1 text-[11px] rounded-md font-medium bg-[var(--bg-panel)] border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] transition-colors"
        >
          ⇅ View trades
        </button>
        {onOpenAiTerminal && (
          <button
            type="button"
            onClick={onOpenAiTerminal}
            disabled={hasActiveAiTerminal}
            className={`px-2.5 py-1 text-[11px] rounded-md font-medium border border-[var(--border)] transition-colors ${
              hasActiveAiTerminal
                ? "bg-[var(--bg-panel)] text-[var(--text-secondary)] cursor-not-allowed opacity-60"
                : "bg-[var(--bg-panel)] text-[var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
            }`}
          >
            ◎ AI terminal
          </button>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 border-b border-[var(--border)]">
        <Stat label="P&L" value={formatPnl(pnl)} color={pnlColorClass(pnl)} />
        <Stat
          label="Win rate"
          value={stats && stats.totalTrades > 0 ? `${stats.winRate}%` : "—"}
        />
        <Stat label="Sharpe" value={stats?.sharpe ?? "—"} />
        <Stat label="Profit factor" value={stats?.profitFactor ?? "—"} />
        <Stat
          label="Avg win"
          value={stats && stats.totalTrades > 0 ? formatPnl(stats.avgWin) : "—"}
          color={stats && stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined}
        />
        <Stat
          label="Avg loss"
          value={stats && stats.totalTrades > 0 ? formatPnl(stats.avgLoss) : "—"}
          color={stats && stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
        />
        <Stat
          label="Max DD"
          value={stats && stats.totalTrades > 0 ? formatPnl(-Math.abs(stats.maxDrawdown)) : "—"}
          color={stats && stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
        />
        <Stat label="Trades" value={`${stats?.totalTrades ?? 0}`} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] px-2">
        {(
          [
            { id: "logs", label: "Logs" },
            { id: "errors", label: "Errors", count: errorCount + warnCount },
            { id: "config", label: "Config" },
          ] as { id: Tab; label: string; count?: number }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[11px] font-medium transition-colors border-b-2 ${
              tab === t.id
                ? "text-[var(--text-primary)] border-[var(--accent-blue)]"
                : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-[var(--accent-red)]/15 text-[var(--accent-red)]">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "logs" && (
          <LogPanel logs={logs} health={health} onClear={onClearLogs} />
        )}
        {tab === "errors" &&
          (errors && errors.errors.length > 0 ? (
            <div className="overflow-auto">
              {errors.autoStopped && (
                <div className="px-4 py-2 bg-[var(--accent-red)]/10 text-[var(--accent-red)] text-xs font-medium">
                  Algo halted due to repeated errors
                </div>
              )}
              {errors.errors.map((e) => (
                <ErrorRow key={e.id} error={e} />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-secondary)] py-8">
              No errors recorded
            </div>
          ))}
        {tab === "config" && (
          <div className="flex-1 overflow-auto p-4">
            {algo.config ? (
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-[var(--bg-primary)] rounded-md p-3 border border-[var(--border)]">
                {algo.config}
              </pre>
            ) : (
              <div className="text-xs text-[var(--text-secondary)]">
                No config defined. Edit in the Editor view.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

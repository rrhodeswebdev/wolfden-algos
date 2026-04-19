import { formatPnl, pnlColorClass } from "../lib/algoInstanceView";

type AlgosCommandBarProps = {
  chartCount: number;
  instanceCount: number;
  runningCount: number;
  haltedCount: number;
  sessionPnl: number;
  onRunNewAlgo: () => void;
};

export const AlgosCommandBar = ({
  chartCount,
  instanceCount,
  runningCount,
  haltedCount,
  sessionPnl,
  onRunNewAlgo,
}: AlgosCommandBarProps) => {
  const metaParts = [
    `${chartCount} chart${chartCount === 1 ? "" : "s"}`,
    `${instanceCount} instance${instanceCount === 1 ? "" : "s"}`,
    `${runningCount} running`,
  ];
  if (haltedCount > 0) metaParts.push(`${haltedCount} halted`);

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-panel)] border-b border-[var(--border)]">
      <div className="flex items-baseline gap-3 min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">Algos</h2>
        <span className="text-[11px] text-[var(--text-secondary)] truncate">
          {metaParts.join(" · ")}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
            Session
          </span>
          <span className={`text-sm font-mono font-semibold tabular-nums ${pnlColorClass(sessionPnl)}`}>
            {formatPnl(sessionPnl)}
          </span>
        </div>
        <button
          type="button"
          onClick={onRunNewAlgo}
          className="px-3.5 py-1.5 text-xs rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity"
        >
          + Run new algo
        </button>
      </div>
    </div>
  );
};

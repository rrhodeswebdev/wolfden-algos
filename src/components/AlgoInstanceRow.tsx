import type { InstanceView } from "../lib/algoInstanceView";
import {
  formatPnl,
  pnlColorClass,
  sparklinePoints,
} from "../lib/algoInstanceView";

type AlgoInstanceRowProps = {
  instance: InstanceView;
  isSelected: boolean;
  onSelect: () => void;
  onClear: () => void;
};

const pillClass = (status: InstanceView["status"], mode: string): string => {
  if (status === "halted") {
    return "bg-[var(--accent-red)]/15 text-[var(--accent-red)]";
  }
  if (mode === "live") {
    return "bg-[var(--accent-green)]/15 text-[var(--accent-green)]";
  }
  return "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]";
};

const dotClass = (status: InstanceView["status"]): string => {
  if (status === "halted") return "bg-[var(--accent-red)]";
  if (status === "warning") return "bg-[var(--accent-yellow)]";
  return "bg-[var(--accent-green)]";
};

const SPARK_W = 80;
const SPARK_H = 18;

export const AlgoInstanceRow = ({
  instance,
  isSelected,
  onSelect,
  onClear,
}: AlgoInstanceRowProps) => {
  const { run, algo, dataSource, stats, errors, status, pnlHistory } = instance;
  const pnl = stats?.pnl ?? 0;
  const points = sparklinePoints(pnlHistory, SPARK_W, SPARK_H);
  const strokeColor = pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)";

  const statusLabel =
    status === "halted"
      ? "halted"
      : errors && errors.warningCount > 0
        ? `${errors.warningCount} warn`
        : null;

  const pillLabel = status === "halted" ? "Halted" : run.mode === "live" ? "Live" : "Shadow";

  return (
    <div
      onClick={onSelect}
      className={`group grid items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] cursor-pointer transition-colors ${
        isSelected
          ? "bg-[var(--accent-blue)]/10 border-l-2 border-l-[var(--accent-blue)] pl-[14px]"
          : "hover:bg-[var(--bg-secondary)]"
      } ${status === "halted" ? "opacity-75" : ""}`}
      style={{ gridTemplateColumns: "18px 1fr 76px 80px 110px 96px 28px" }}
    >
      <span className={`w-2 h-2 rounded-full ${dotClass(status)}`} />

      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{algo.name}</span>
          {statusLabel && (
            <span
              className={`text-[10px] ${
                status === "halted" ? "text-[var(--accent-red)]" : "text-[var(--accent-yellow)]"
              }`}
            >
              {statusLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)] truncate">
          <span className="truncate">
            {dataSource.instrument} {dataSource.timeframe}
          </span>
          <span>·</span>
          <span className="truncate">{run.account}</span>
        </div>
      </div>

      <span
        className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold text-center ${pillClass(
          status,
          run.mode,
        )}`}
      >
        {pillLabel}
      </span>

      <div className="flex items-center justify-center h-[18px]">
        {points ? (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            preserveAspectRatio="none"
            width={SPARK_W}
            height={SPARK_H}
            aria-hidden
          >
            <polyline fill="none" stroke={strokeColor} strokeWidth="1.2" points={points} />
          </svg>
        ) : (
          <span className="text-[var(--text-secondary)] text-xs">—</span>
        )}
      </div>

      <span className={`text-sm font-mono tabular-nums text-right ${pnlColorClass(pnl)}`}>
        {formatPnl(pnl)}
      </span>

      <span className="text-[11px] text-[var(--text-secondary)] text-right font-mono tabular-nums">
        {stats && stats.totalTrades > 0
          ? `${stats.totalTrades} · ${stats.winRate}%`
          : "— · —"}
      </span>

      {status === "halted" ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent-red)] transition-all"
          title="Clear this row from the list"
        >
          ✕
        </button>
      ) : (
        <span />
      )}
    </div>
  );
};

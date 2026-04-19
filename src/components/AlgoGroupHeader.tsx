import type { GroupView } from "../lib/algoInstanceView";
import { formatPnl, pnlColorClass } from "../lib/algoInstanceView";

type AlgoGroupHeaderProps = {
  group: GroupView;
  onDeepLink: () => void;
  onAddAlgo: () => void;
};

export const AlgoGroupHeader = ({ group, onDeepLink, onAddAlgo }: AlgoGroupHeaderProps) => {
  if (group.groupBy === "none") return null;

  const linkLabel = group.groupBy === "chart" ? "→ chart" : "→ editor";
  const linkTitle =
    group.groupBy === "chart"
      ? "Open Trading view for this account"
      : "Open this algo in Editor";

  return (
    <div className="group flex items-center gap-3 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] sticky top-0 z-10">
      <span className="text-[var(--text-secondary)] text-xs">▼</span>
      <span className="text-xs font-semibold">{group.label}</span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
        {group.meta}
      </span>
      <div className="ml-auto flex items-center gap-3 text-[11px]">
        <span className={`font-mono tabular-nums ${pnlColorClass(group.aggregatePnl)}`}>
          {formatPnl(group.aggregatePnl)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddAlgo();
          }}
          className="opacity-0 group-hover:opacity-100 text-[10px] px-2 py-0.5 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] transition-all"
          title="Run a new algo in this group"
        >
          + add
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeepLink();
          }}
          className="text-[10px] text-[var(--accent-blue)] hover:underline"
          title={linkTitle}
        >
          {linkLabel}
        </button>
      </div>
    </div>
  );
};

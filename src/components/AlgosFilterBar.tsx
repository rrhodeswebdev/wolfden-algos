import type { GroupBy, ModeFilter, StatusFilter } from "../lib/algoInstanceView";

type AlgosFilterBarProps = {
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  modeFilter: ModeFilter;
  onModeFilterChange: (v: ModeFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
};

type SegItem<T extends string> = { value: T; label: string };

const GROUP_BY_OPTIONS: SegItem<GroupBy>[] = [
  { value: "chart", label: "Chart" },
  { value: "algo", label: "Algo" },
  { value: "none", label: "None" },
];

const MODE_OPTIONS: SegItem<ModeFilter>[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "shadow", label: "Shadow" },
];

const STATUS_OPTIONS: SegItem<StatusFilter>[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "warning", label: "Warning" },
  { value: "halted", label: "Halted" },
];

const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegItem<T>[];
  onChange: (v: T) => void;
}) => (
  <div className="flex bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md overflow-hidden">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange(opt.value)}
        className={`px-2.5 py-1 text-[11px] transition-colors ${
          value === opt.value
            ? "bg-[var(--bg-panel)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">
    {children}
  </span>
);

export const AlgosFilterBar = ({
  groupBy,
  onGroupByChange,
  modeFilter,
  onModeFilterChange,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
}: AlgosFilterBarProps) => (
  <div className="flex items-center gap-3 px-4 py-2 bg-[var(--bg-panel)] border-b border-[var(--border)]">
    <Label>Group by</Label>
    <Segmented value={groupBy} options={GROUP_BY_OPTIONS} onChange={onGroupByChange} />

    <Label>Mode</Label>
    <Segmented value={modeFilter} options={MODE_OPTIONS} onChange={onModeFilterChange} />

    <Label>Status</Label>
    <Segmented value={statusFilter} options={STATUS_OPTIONS} onChange={onStatusFilterChange} />

    <div className="flex-1" />

    <input
      type="search"
      value={searchQuery}
      onChange={(e) => onSearchQueryChange(e.target.value)}
      placeholder="Search algo, instrument, account…"
      className="w-[220px] px-2.5 py-1 text-[11px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
    />
  </div>
);

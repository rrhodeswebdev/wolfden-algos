# Algos View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Algos view as a single grouped instance list + always-visible detail panel + slide-over launcher, per `docs/superpowers/specs/2026-04-19-algos-view-redesign-design.md`.

**Architecture:** A pure helper module (`src/lib/algoInstanceView.ts`) owns grouping / filtering / aggregation / sparkline derivation. `AlgosView.tsx` becomes a layout-only orchestrator that composes new small components: `AlgosCommandBar`, `AlgosFilterBar`, `AlgosInstanceList` (built from `AlgoGroupHeader` + `AlgoInstanceRow`), `AlgoDetailPanel`, and `RunAlgoSlideOver`. The existing `LogPanel` is reused inside the detail panel's Logs tab. `App.tsx` adds one prop (`runPnlHistories`) to the Algos mount. No backend / Tauri-command / schema changes.

**Tech Stack:** React 19, TypeScript 6, Tailwind 4 + CSS vars (`src/styles.css`), no new dependencies.

---

## Project has no test framework — adapted task template

The standard `superpowers:writing-plans` template uses a TDD flow. This project has no vitest / jest setup (see `package.json`), and the spec's verification plan is `tsc` + manual smoke. Every task here replaces the "write failing test → run → implement → pass" cycle with:

1. **Implement** — write the code.
2. **Type-check** — run `npx tsc --noEmit` from the repo root; expect zero TypeScript errors. (Running `npm run build` is also valid but slower — it additionally produces a Vite bundle.)
3. **Smoke** — a targeted manual walk-through described per task. For pure-helper tasks, smoke = just type-check.
4. **Commit** — Conventional Commits.

Do not introduce a test framework in this plan. It's out of scope.

---

## Task dependency map

Tasks 1–7 produce self-contained new files. Task 8 is the coordinated rewire (`AlgosView.tsx` full rewrite + `App.tsx` one-line prop addition) where everything meets. Task 9 is final smoke + polish.

```
1 (helpers) ──┬──▶ 2 (row + group header) ─┐
              │                            ├──▶ 6 (InstanceList) ─┐
              ├──▶ 4 (DetailPanel)         │                       │
              │                            │                       ├──▶ 8 (rewire) ──▶ 9 (smoke)
              └──▶ 5 (Slide-over)          │                       │
                                           3 (CommandBar + FilterBar) ──▶ ┘
```

Tasks 2, 3, 4, 5, 6 can be done in parallel by a subagent runner once 1 is done.

---

### Task 1: Create `src/lib/algoInstanceView.ts` (pure helpers)

**Files:**
- Create: `src/lib/algoInstanceView.ts`

- [ ] **Step 1: Write the helper module**

Create `src/lib/algoInstanceView.ts` with this exact content:

```ts
import type { Algo, AlgoRun } from "../types";
import type { AlgoStats, DataSource } from "../hooks/useTradingSimulation";
import type { InstanceErrors } from "../hooks/useAlgoErrors";

export type GroupBy = "chart" | "algo" | "none";
export type ModeFilter = "all" | "live" | "shadow";
export type StatusFilter = "all" | "running" | "halted" | "warning";
export type InstanceStatus = "running" | "halted" | "warning";

export type ViewFilters = {
  mode: ModeFilter;
  status: StatusFilter;
  search: string;
};

export type InstanceView = {
  run: AlgoRun;
  algo: Algo;
  dataSource: DataSource;
  stats: AlgoStats | undefined;
  errors: InstanceErrors | undefined;
  status: InstanceStatus;
  pnlHistory: number[];
};

export type GroupView = {
  key: string;
  label: string;
  meta: string;
  aggregatePnl: number;
  instances: InstanceView[];
  groupBy: GroupBy;
  // Deep-link payloads — populated per-pivot:
  chartId?: string;
  account?: string;
  algoId?: number;
};

export const computeStatus = (errors: InstanceErrors | undefined): InstanceStatus => {
  if (!errors) return "running";
  if (errors.autoStopped) return "halted";
  if (errors.warningCount > 0 || errors.errorCount > 0) return "warning";
  return "running";
};

export const aggregatePnl = (instances: InstanceView[]): number =>
  instances.reduce((sum, i) => sum + (i.stats?.pnl ?? 0), 0);

export const sparklinePoints = (history: number[], width: number, height: number): string => {
  if (history.length <= 1) return "";
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const stepX = width / (history.length - 1);
  return history
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`)
    .join(" ");
};

export const passesFilters = (inst: InstanceView, filters: ViewFilters): boolean => {
  if (filters.mode !== "all" && inst.run.mode !== filters.mode) return false;
  if (filters.status !== "all" && inst.status !== filters.status) return false;
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const hay = [
      inst.algo.name,
      inst.dataSource.instrument,
      inst.dataSource.timeframe,
      inst.run.account,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
};

// Halted rows sort to the bottom of their group; running / warning in original order.
const sortInstances = (instances: InstanceView[]): InstanceView[] => {
  const rank = (s: InstanceStatus) => (s === "halted" ? 1 : 0);
  return [...instances].sort((a, b) => rank(a.status) - rank(b.status));
};

type BuildArgs = {
  activeRuns: AlgoRun[];
  algos: Algo[];
  dataSources: DataSource[];
  algoStats: Record<string, AlgoStats>;
  errorsByInstance: Record<string, InstanceErrors>;
  runPnlHistories: Record<string, number[]>;
  dismissedInstanceIds: Set<string>;
  groupBy: GroupBy;
  filters: ViewFilters;
};

export const buildInstanceViews = ({
  activeRuns,
  algos,
  dataSources,
  algoStats,
  errorsByInstance,
  runPnlHistories,
  dismissedInstanceIds,
}: Pick<
  BuildArgs,
  | "activeRuns"
  | "algos"
  | "dataSources"
  | "algoStats"
  | "errorsByInstance"
  | "runPnlHistories"
  | "dismissedInstanceIds"
>): InstanceView[] => {
  const views: InstanceView[] = [];
  for (const run of activeRuns) {
    if (dismissedInstanceIds.has(run.instance_id)) continue;
    const algo = algos.find((a) => a.id === run.algo_id);
    const dataSource = dataSources.find((d) => d.id === run.data_source_id);
    if (!algo || !dataSource) continue;
    const errors = errorsByInstance[run.instance_id];
    views.push({
      run,
      algo,
      dataSource,
      stats: algoStats[run.instance_id],
      errors,
      status: computeStatus(errors),
      pnlHistory: runPnlHistories[run.instance_id] ?? [],
    });
  }
  return views;
};

export const buildGroups = (args: BuildArgs): GroupView[] => {
  const allViews = buildInstanceViews(args);
  const filtered = allViews.filter((v) => passesFilters(v, args.filters));

  if (args.groupBy === "none") {
    const sorted = sortInstances(filtered);
    return [
      {
        key: "__all__",
        label: "All instances",
        meta: `${sorted.length} instance${sorted.length === 1 ? "" : "s"}`,
        aggregatePnl: aggregatePnl(sorted),
        instances: sorted,
        groupBy: "none",
      },
    ];
  }

  if (args.groupBy === "chart") {
    const groups: GroupView[] = [];
    for (const ds of args.dataSources) {
      const dsInstances = sortInstances(filtered.filter((v) => v.dataSource.id === ds.id));
      if (dsInstances.length === 0) continue;
      groups.push({
        key: `chart:${ds.id}`,
        label: `${ds.instrument} ${ds.timeframe}`,
        meta: `${ds.account} · ${dsInstances.length} algo${dsInstances.length === 1 ? "" : "s"}`,
        aggregatePnl: aggregatePnl(dsInstances),
        instances: dsInstances,
        groupBy: "chart",
        chartId: ds.id,
        account: ds.account,
      });
    }
    return groups;
  }

  // group by algo
  const byAlgo = new Map<number, InstanceView[]>();
  for (const v of filtered) {
    const existing = byAlgo.get(v.algo.id) ?? [];
    existing.push(v);
    byAlgo.set(v.algo.id, existing);
  }
  const groups: GroupView[] = [];
  const algoNameOrder = [...byAlgo.keys()].sort((a, b) => {
    const na = args.algos.find((x) => x.id === a)?.name ?? "";
    const nb = args.algos.find((x) => x.id === b)?.name ?? "";
    return na.localeCompare(nb);
  });
  for (const algoId of algoNameOrder) {
    const algo = args.algos.find((x) => x.id === algoId);
    if (!algo) continue;
    const instances = sortInstances(byAlgo.get(algoId) ?? []);
    groups.push({
      key: `algo:${algoId}`,
      label: algo.name,
      meta: `${instances.length} instance${instances.length === 1 ? "" : "s"}`,
      aggregatePnl: aggregatePnl(instances),
      instances,
      groupBy: "algo",
      algoId,
    });
  }
  return groups;
};

export const formatPnl = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const pnlColorClass = (value: number): string =>
  value > 0
    ? "text-[var(--accent-green)]"
    : value < 0
      ? "text-[var(--accent-red)]"
      : "text-[var(--text-primary)]";

export const formatDurationShort = (msElapsed: number): string => {
  if (msElapsed < 0) return "0s";
  const totalSeconds = Math.floor(msElapsed / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/algoInstanceView.ts
git commit -m "feat(algos): pure helpers for grouping, filtering, and view derivation"
```

---

### Task 2: Create `AlgoGroupHeader` + `AlgoInstanceRow`

**Files:**
- Create: `src/components/AlgoGroupHeader.tsx`
- Create: `src/components/AlgoInstanceRow.tsx`

- [ ] **Step 1: Write `AlgoGroupHeader.tsx`**

Create `src/components/AlgoGroupHeader.tsx` with this exact content:

```tsx
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
```

- [ ] **Step 2: Write `AlgoInstanceRow.tsx`**

Create `src/components/AlgoInstanceRow.tsx` with this exact content:

```tsx
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AlgoGroupHeader.tsx src/components/AlgoInstanceRow.tsx
git commit -m "feat(algos): group header + instance row components"
```

---

### Task 3: Create `AlgosCommandBar` + `AlgosFilterBar`

**Files:**
- Create: `src/components/AlgosCommandBar.tsx`
- Create: `src/components/AlgosFilterBar.tsx`

- [ ] **Step 1: Write `AlgosCommandBar.tsx`**

Create `src/components/AlgosCommandBar.tsx` with this exact content:

```tsx
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
```

- [ ] **Step 2: Write `AlgosFilterBar.tsx`**

Create `src/components/AlgosFilterBar.tsx` with this exact content:

```tsx
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AlgosCommandBar.tsx src/components/AlgosFilterBar.tsx
git commit -m "feat(algos): command + filter bars"
```

---

### Task 4: Create `AlgoDetailPanel.tsx`

**Files:**
- Create: `src/components/AlgoDetailPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/AlgoDetailPanel.tsx` with this exact content:

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AlgoDetailPanel.tsx
git commit -m "feat(algos): always-visible detail panel with stats, logs, errors, config tabs"
```

---

### Task 5: Create `RunAlgoSlideOver.tsx`

**Files:**
- Create: `src/components/RunAlgoSlideOver.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/RunAlgoSlideOver.tsx` with this exact content:

```tsx
import { useEffect, useState } from "react";
import type { Algo, AlgoRun } from "../types";
import type { DataSource } from "../hooks/useTradingSimulation";

type Mode = "live" | "shadow";

type RunAlgoSlideOverProps = {
  open: boolean;
  algos: Algo[];
  dataSources: DataSource[];
  activeRuns: AlgoRun[];
  prefill: { algoId?: number; chartId?: string } | null;
  onClose: () => void;
  onStart: (algoId: number, mode: Mode, account: string, dataSourceId: string) => void;
};

export const RunAlgoSlideOver = ({
  open,
  algos,
  dataSources,
  activeRuns,
  prefill,
  onClose,
  onStart,
}: RunAlgoSlideOverProps) => {
  const [algoId, setAlgoId] = useState<number | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("shadow");
  const [accountOverride, setAccountOverride] = useState<string>("");

  // Reset on open, respecting prefill.
  useEffect(() => {
    if (!open) return;
    setAlgoId(prefill?.algoId ?? null);
    setChartId(prefill?.chartId ?? null);
    setMode("shadow");
    setAccountOverride("");
  }, [open, prefill]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const chart = dataSources.find((d) => d.id === chartId) ?? null;
  const algo = algos.find((a) => a.id === algoId) ?? null;
  const effectiveAccount = accountOverride.trim() || chart?.account || "";
  const duplicate =
    algo &&
    chart &&
    activeRuns.some((r) => r.algo_id === algo.id && r.data_source_id === chart.id);

  const canSubmit = !!algo && !!chart && !!effectiveAccount && !duplicate;

  const handleSubmit = () => {
    if (!canSubmit || !algo || !chart) return;
    onStart(algo.id, mode, effectiveAccount, chart.id);
    onClose();
  };

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/30 z-20"
        aria-hidden
      />

      {/* Panel */}
      <aside
        className="absolute top-0 right-0 bottom-0 w-[380px] bg-[var(--bg-panel)] border-l border-[var(--border)] z-30 flex flex-col shadow-2xl"
        role="dialog"
        aria-label="Run a new algo"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold">Run a new algo</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          <Field label="Algo">
            <select
              value={algoId ?? ""}
              onChange={(e) => setAlgoId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="">Select an algo…</option>
              {algos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chart">
            <select
              value={chartId ?? ""}
              onChange={(e) => setChartId(e.target.value || null)}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="">Select a chart…</option>
              {dataSources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.instrument} {d.timeframe} · {d.account}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mode">
            <div className="grid grid-cols-2 gap-2">
              <ModeChip
                tone="yellow"
                selected={mode === "shadow"}
                label="◐ Shadow"
                onClick={() => setMode("shadow")}
              />
              <ModeChip
                tone="green"
                selected={mode === "live"}
                label="● Live"
                onClick={() => setMode("live")}
              />
            </div>
          </Field>

          <Field label="Account override (optional)">
            <input
              type="text"
              value={accountOverride}
              onChange={(e) => setAccountOverride(e.target.value)}
              placeholder={chart ? `use chart's account · ${chart.account}` : "pick a chart first"}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          {duplicate && (
            <div className="text-[11px] text-[var(--accent-yellow)]">
              This algo is already running on the selected chart.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3.5 py-1.5 text-xs rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start
          </button>
        </div>
      </aside>
    </>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">
      {label}
    </span>
    {children}
  </div>
);

const ModeChip = ({
  tone,
  selected,
  label,
  onClick,
}: {
  tone: "yellow" | "green";
  selected: boolean;
  label: string;
  onClick: () => void;
}) => {
  const base = "px-3 py-1.5 text-xs rounded-md font-medium border transition-colors";
  const toneClass =
    tone === "green"
      ? selected
        ? "bg-[var(--accent-green)]/15 border-[var(--accent-green)] text-[var(--accent-green)]"
        : "bg-transparent border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-green)]"
      : selected
        ? "bg-[var(--accent-yellow)]/15 border-[var(--accent-yellow)] text-[var(--accent-yellow)]"
        : "bg-transparent border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-yellow)]";
  return (
    <button type="button" onClick={onClick} className={`${base} ${toneClass}`}>
      {label}
    </button>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/RunAlgoSlideOver.tsx
git commit -m "feat(algos): run-new-algo slide-over launcher"
```

---

### Task 6: Create `AlgosInstanceList.tsx`

**Files:**
- Create: `src/components/AlgosInstanceList.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/AlgosInstanceList.tsx` with this exact content:

```tsx
import type { GroupView, InstanceView } from "../lib/algoInstanceView";
import { AlgoGroupHeader } from "./AlgoGroupHeader";
import { AlgoInstanceRow } from "./AlgoInstanceRow";

type AlgosInstanceListProps = {
  groups: GroupView[];
  hasAnyCharts: boolean;
  hasAnyInstances: boolean;
  selectedInstanceId: string | null;
  onSelect: (instance: InstanceView) => void;
  onClear: (instance: InstanceView) => void;
  onGroupDeepLink: (group: GroupView) => void;
  onGroupAddAlgo: (group: GroupView) => void;
  onClearFilters: () => void;
  onRunNewAlgo: () => void;
};

export const AlgosInstanceList = ({
  groups,
  hasAnyCharts,
  hasAnyInstances,
  selectedInstanceId,
  onSelect,
  onClear,
  onGroupDeepLink,
  onGroupAddAlgo,
  onClearFilters,
  onRunNewAlgo,
}: AlgosInstanceListProps) => {
  if (!hasAnyCharts) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-[380px] text-center text-xs text-[var(--text-secondary)]">
          No charts connected. Add the WolfDenBridge indicator to a NinjaTrader chart to get
          started.
        </div>
      </div>
    );
  }

  if (!hasAnyInstances) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <h3 className="text-sm font-medium">No algos running</h3>
        <p className="text-xs text-[var(--text-secondary)] max-w-[320px]">
          Charts are connected but no algos are running. Start one to see it here.
        </p>
        <button
          type="button"
          onClick={onRunNewAlgo}
          className="mt-1 px-3 py-1.5 text-xs rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90"
        >
          + Run new algo
        </button>
      </div>
    );
  }

  if (groups.length === 0 || groups.every((g) => g.instances.length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-xs text-[var(--text-secondary)] flex items-center gap-3">
          <span>No instances match these filters</span>
          <button
            type="button"
            onClick={onClearFilters}
            className="text-[var(--accent-blue)] hover:underline"
          >
            Clear filters
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {groups.map((group) => (
        <div key={group.key}>
          <AlgoGroupHeader
            group={group}
            onDeepLink={() => onGroupDeepLink(group)}
            onAddAlgo={() => onGroupAddAlgo(group)}
          />
          {group.instances.map((inst) => (
            <AlgoInstanceRow
              key={inst.run.instance_id}
              instance={inst}
              isSelected={selectedInstanceId === inst.run.instance_id}
              onSelect={() => onSelect(inst)}
              onClear={() => onClear(inst)}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AlgosInstanceList.tsx
git commit -m "feat(algos): grouped instance list with empty states"
```

---

### Task 7: Delete now-unused AI-terminal inline affordance code (none) — skipped

This task is intentionally empty. All soon-to-be-deleted code in the current `AlgosView.tsx` is internal to that file (its sub-components `ChartCard`, `AddAlgoPanel`, `RunningInstanceRow`, `PerformanceStats`, `ErrorBadge`, `ErrorRow`, `ErrorList`). They are removed as part of Task 8's full rewrite — no separate deletion step is needed.

Skip to Task 8.

---

### Task 8: Coordinated rewire — rewrite `AlgosView.tsx` + update `App.tsx`

This is the only task that touches multiple files at once because the new `AlgosViewProps` gains one field (`runPnlHistories`), which `App.tsx` must supply.

**Files:**
- Rewrite: `src/views/AlgosView.tsx`
- Modify: `src/App.tsx` (single line addition — pass `runPnlHistories`)

- [ ] **Step 1: Rewrite `src/views/AlgosView.tsx`**

Overwrite `src/views/AlgosView.tsx` with this exact content:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Algo, AlgoRun, NavOptions, View } from "../types";
import { type AlgoStats, type DataSource } from "../hooks/useTradingSimulation";
import { type InstanceErrors } from "../hooks/useAlgoErrors";
import { type LogEntry } from "../hooks/useAlgoLogs";
import { type AlgoHealth } from "../hooks/useAlgoHealth";
import {
  buildGroups,
  type GroupBy,
  type GroupView,
  type InstanceView,
  type ModeFilter,
  type StatusFilter,
} from "../lib/algoInstanceView";
import { AlgosCommandBar } from "../components/AlgosCommandBar";
import { AlgosFilterBar } from "../components/AlgosFilterBar";
import { AlgosInstanceList } from "../components/AlgosInstanceList";
import { AlgoDetailPanel } from "../components/AlgoDetailPanel";
import { RunAlgoSlideOver } from "../components/RunAlgoSlideOver";

type AlgosViewProps = {
  algos: Algo[];
  dataSources: DataSource[];
  activeRuns: AlgoRun[];
  algoStats: Record<string, AlgoStats>;
  runPnlHistories: Record<string, number[]>;
  errorsByInstance: Record<string, InstanceErrors>;
  logsByInstance: Record<string, LogEntry[]>;
  healthByInstance: Record<string, AlgoHealth>;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
  onStopAlgo: (instanceId: string) => void;
  onClearLogs: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
  initialInstanceId?: string | null;
  onInstanceFocused?: () => void;
  onNavigate: (view: View, options?: NavOptions) => void;
};

export const AlgosView = ({
  algos,
  dataSources,
  activeRuns,
  algoStats,
  runPnlHistories,
  errorsByInstance,
  logsByInstance,
  healthByInstance,
  onStartAlgo,
  onStopAlgo,
  onClearLogs,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
  initialInstanceId,
  onInstanceFocused,
  onNavigate,
}: AlgosViewProps) => {
  const [groupBy, setGroupBy] = useState<GroupBy>("chart");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherPrefill, setLauncherPrefill] = useState<{
    algoId?: number;
    chartId?: string;
  } | null>(null);
  const [dismissedInstanceIds, setDismissedInstanceIds] = useState<Set<string>>(() => new Set());

  // Auto-select on mount: navigation-provided instance, else first running.
  useEffect(() => {
    if (hasAutoSelected) return;
    if (initialInstanceId) {
      const run = activeRuns.find((r) => r.instance_id === initialInstanceId);
      if (run) {
        setSelectedInstanceId(run.instance_id);
      }
      setHasAutoSelected(true);
      onInstanceFocused?.();
      return;
    }
    const firstRunning = activeRuns.find((r) => r.status === "running");
    if (firstRunning) {
      setSelectedInstanceId(firstRunning.instance_id);
      setHasAutoSelected(true);
    }
  }, [activeRuns, hasAutoSelected, initialInstanceId, onInstanceFocused]);

  const groups = useMemo(
    () =>
      buildGroups({
        activeRuns,
        algos,
        dataSources,
        algoStats,
        errorsByInstance,
        runPnlHistories,
        dismissedInstanceIds,
        groupBy,
        filters: { mode: modeFilter, status: statusFilter, search: searchQuery },
      }),
    [
      activeRuns,
      algos,
      dataSources,
      algoStats,
      errorsByInstance,
      runPnlHistories,
      dismissedInstanceIds,
      groupBy,
      modeFilter,
      statusFilter,
      searchQuery,
    ],
  );

  const allInstances = useMemo(
    () => groups.flatMap((g) => g.instances),
    [groups],
  );

  const selectedInstance: InstanceView | null =
    allInstances.find((i) => i.run.instance_id === selectedInstanceId) ?? null;

  // Counts for the command bar — use activeRuns (not filtered) so headline numbers stay stable.
  const runningCount = activeRuns.filter((r) => r.status === "running").length;
  const haltedCount = activeRuns.filter(
    (r) => errorsByInstance[r.instance_id]?.autoStopped,
  ).length;
  const sessionPnl = Object.values(algoStats).reduce((sum, s) => sum + s.pnl, 0);

  const clearFilters = useCallback(() => {
    setModeFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
  }, []);

  const openLauncher = useCallback((prefill: { algoId?: number; chartId?: string } | null) => {
    setLauncherPrefill(prefill);
    setLauncherOpen(true);
  }, []);

  const handleGroupDeepLink = useCallback(
    (group: GroupView) => {
      if (group.groupBy === "chart" && group.account) {
        onNavigate("trading", { accountFilter: group.account });
      } else if (group.groupBy === "algo" && typeof group.algoId === "number") {
        onNavigate("editor", { algoFilter: group.algoId });
      }
    },
    [onNavigate],
  );

  const handleGroupAddAlgo = useCallback(
    (group: GroupView) => {
      if (group.groupBy === "chart" && group.chartId) {
        openLauncher({ chartId: group.chartId });
      } else if (group.groupBy === "algo" && typeof group.algoId === "number") {
        openLauncher({ algoId: group.algoId });
      } else {
        openLauncher(null);
      }
    },
    [openLauncher],
  );

  const handleStart = useCallback(
    (algoId: number, mode: "live" | "shadow", account: string, dataSourceId: string) => {
      onStartAlgo(algoId, mode, account, dataSourceId);
    },
    [onStartAlgo],
  );

  const clearInstance = useCallback((inst: InstanceView) => {
    setDismissedInstanceIds((prev) => {
      const next = new Set(prev);
      next.add(inst.run.instance_id);
      return next;
    });
    setSelectedInstanceId((sid) => (sid === inst.run.instance_id ? null : sid));
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)] relative">
      <AlgosCommandBar
        chartCount={dataSources.length}
        instanceCount={activeRuns.length}
        runningCount={runningCount}
        haltedCount={haltedCount}
        sessionPnl={sessionPnl}
        onRunNewAlgo={() => openLauncher(null)}
      />
      <AlgosFilterBar
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        modeFilter={modeFilter}
        onModeFilterChange={setModeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      <div className="flex-1 flex min-h-0">
        <AlgosInstanceList
          groups={groups}
          hasAnyCharts={dataSources.length > 0}
          hasAnyInstances={activeRuns.length > 0}
          selectedInstanceId={selectedInstanceId}
          onSelect={(inst) => setSelectedInstanceId(inst.run.instance_id)}
          onClear={clearInstance}
          onGroupDeepLink={handleGroupDeepLink}
          onGroupAddAlgo={handleGroupAddAlgo}
          onClearFilters={clearFilters}
          onRunNewAlgo={() => openLauncher(null)}
        />

        <AlgoDetailPanel
          instance={selectedInstance}
          logs={
            selectedInstance ? logsByInstance[selectedInstance.run.instance_id] ?? [] : []
          }
          health={
            selectedInstance ? healthByInstance[selectedInstance.run.instance_id] : undefined
          }
          onClearLogs={() => {
            if (selectedInstance) onClearLogs(selectedInstance.run.instance_id);
          }}
          onStop={() => {
            if (selectedInstance) onStopAlgo(selectedInstance.run.instance_id);
          }}
          onOpenInEditor={() => {
            if (selectedInstance) onNavigate("editor", { algoFilter: selectedInstance.algo.id });
          }}
          onViewTrades={() => {
            if (selectedInstance)
              onNavigate("trading", {
                accountFilter: selectedInstance.run.account,
                scrollTo: "positions",
              });
          }}
          onOpenAiTerminal={
            onOpenAiTerminal && selectedInstance
              ? () => onOpenAiTerminal(selectedInstance.algo.id)
              : undefined
          }
          hasActiveAiTerminal={
            !!(selectedInstance && aiTerminalAlgoIds?.has(selectedInstance.algo.id))
          }
          onRunNewAlgo={() => openLauncher(null)}
        />
      </div>

      <RunAlgoSlideOver
        open={launcherOpen}
        algos={algos}
        dataSources={dataSources}
        activeRuns={activeRuns}
        prefill={launcherPrefill}
        onClose={() => setLauncherOpen(false)}
        onStart={handleStart}
      />
    </div>
  );
};
```

- [ ] **Step 2: Update `src/App.tsx`**

Find the `<AlgosView` mount in `src/App.tsx` (around line 398) and add two new props: `runPnlHistories` and `onNavigate`.

Replace this block:

```tsx
        {activeView === "algos" && (
          <AlgosView
            algos={algos}
            dataSources={dataSources}
            activeRuns={activeRuns}
            algoStats={simulation.algoStats}
            errorsByInstance={errorsByInstance}
            logsByInstance={logsByInstance}
            healthByInstance={healthByInstance}
            onStartAlgo={handleStartAlgo}
            onStopAlgo={handleStopAlgo}
            onClearLogs={clearLogs}
            onOpenAiTerminal={handleOpenAiTerminal}
            aiTerminalAlgoIds={aiTerminalAlgoIds}
            initialInstanceId={pendingNavContext?.targetView === "algos" ? pendingNavContext.instanceId : null}
            onInstanceFocused={clearPendingNavContext}
          />
        )}
```

With:

```tsx
        {activeView === "algos" && (
          <AlgosView
            algos={algos}
            dataSources={dataSources}
            activeRuns={activeRuns}
            algoStats={simulation.algoStats}
            runPnlHistories={simulation.runPnlHistories}
            errorsByInstance={errorsByInstance}
            logsByInstance={logsByInstance}
            healthByInstance={healthByInstance}
            onStartAlgo={handleStartAlgo}
            onStopAlgo={handleStopAlgo}
            onClearLogs={clearLogs}
            onOpenAiTerminal={handleOpenAiTerminal}
            aiTerminalAlgoIds={aiTerminalAlgoIds}
            initialInstanceId={pendingNavContext?.targetView === "algos" ? pendingNavContext.instanceId : null}
            onInstanceFocused={clearPendingNavContext}
            onNavigate={handleNavigate}
          />
        )}
```

Confirm that `handleNavigate` already exists in `App.tsx` by searching for `const handleNavigate` or `onNavigate={handleNavigate}` elsewhere in the file — it is passed to `HomeView` already and its signature is `(view: View, options?: NavOptions) => void`. If the local name differs (e.g. `navigateTo`), use the matching name.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

If a TypeScript error appears for the navigate prop name, check how `HomeView` receives it in `App.tsx` and mirror that exactly.

- [ ] **Step 4: Smoke — full matrix**

Run: `npm run dev`

In the running app, walk through each case with NinjaTrader connected (or manually trigger runs if possible):

1. **Group-by Chart (default)**: Groups render one per connected chart. Aggregate P&L and meta in each header. Running algos render as rows. Halted instances sink to the bottom of their group.
2. **Group-by Algo**: Groups render one per algo that has any instance. Each header shows instance count + aggregate P&L. Instances labelled with their chart.
3. **Group-by None**: A single virtual group (no visible header); all filtered instances in one list.
4. **Mode filter**: Live / Shadow toggles remove non-matching rows.
5. **Status filter**: Running / Warning / Halted filter correctly.
6. **Search**: Type an algo name, instrument, or account — rows filter; clear → all return.
7. **No results state**: Apply contradictory filters → "No instances match these filters · Clear filters" renders; Clear filters resets.
8. **Detail panel selection**: Click different rows; header, actions, stats grid, tabs update. When an instance has errors, the Errors tab is pre-selected. When not, Logs is pre-selected. Manual tab switches stick until the selection changes.
9. **Detail actions**:
   - **Stop** calls `onStopAlgo` — disabled for halted rows and for `status === "installing"` runs.
   - **Open in Editor** navigates to Editor with that algo loaded.
   - **View trades** navigates to Trading with that account filter and scrolls to positions.
   - **AI terminal** opens the existing AI terminal tab; button disables when one is already active for that algo.
10. **Logs tab**: `LogPanel` renders inside the Logs tab with the correct logs + health. Clearing logs works.
11. **Errors tab**: Error rows render with severity colour; clicking expands traceback; `autoStopped` banner shows when applicable.
12. **Config tab**: Shows the algo's `config` string as a read-only `<pre>`; empty-state message when `config` is null / empty.
13. **Top bar launcher**: `+ Run new algo` opens the slide-over empty. Esc / scrim / Cancel all dismiss. Submit disabled until Algo + Chart selected. Start fires `onStartAlgo` and the new instance auto-appears in the list.
14. **Group-header launcher**: Hover a chart group → `+ add` appears on the right → opens the slide-over with Chart prefilled. Hover an algo group → `+ add` prefills Algo.
15. **Duplicate guard**: Select an algo already running on the chosen chart — yellow "already running" notice and Submit disabled.
16. **Halted row clear**: Hover a halted row → `✕` appears on the right → clicking removes the row locally. Re-selecting a dismissed row is impossible until it's re-added by `activeRuns` or via a view remount.
17. **Nav-in context**: Navigate to Algos from Home by clicking an algo tape row (already wired via `initialInstanceId`) → detail panel auto-focuses that instance exactly once.
18. **Empty states**:
    - Disconnect NinjaTrader (or simulate): list renders the "No charts connected" message; detail panel shows "Select an instance to see details".
    - Charts connected, no runs: list renders "No algos running · + Run new algo".

- [ ] **Step 5: Commit**

```bash
git add src/views/AlgosView.tsx src/App.tsx
git commit -m "feat(algos): rewrite view with grouped list + detail panel + launcher"
```

---

### Task 9: Final smoke walk-through and polish

**Files:**
- Any polish adjustments as they surface — likely small tweaks in the new components.

- [ ] **Step 1: Fresh smoke against the design spec**

Run `npm run dev`. Open the Algos view. With the spec (`docs/superpowers/specs/2026-04-19-algos-view-redesign-design.md`) open side-by-side, verify each Summary / Goals / User Flows bullet in the spec matches what you see.

- [ ] **Step 2: Visual polish pass**

Look for: inconsistent spacing, misaligned columns, off-color pills, missing hover states, detail panel overflow on narrow widths (≥1100px target — the Tauri default is wider, but resize-check down to 1100px). Tighten anything that looks off. Prefer the project's existing CSS variables — do not introduce new colors.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit any polish fixes**

If nothing changed, skip the commit. Otherwise:

```bash
git add -p   # stage only the polish changes
git commit -m "polish(algos): post-rewire visual fixes"
```

- [ ] **Step 5: Announce completion**

Report back with a short summary: what was rewritten, what was added, what was removed from the old `AlgosView.tsx`, and a 2–3 line smoke summary.

---

## Self-review completed

- Spec coverage: every section of the spec maps to a task — helpers (T1), row + group header (T2), command + filter bars (T3), detail panel incl. tabs & error drilldown (T4), slide-over (T5), list composition + empty states (T6), orchestrator rewrite + deep-link wiring + prop addition (T8), smoke (T9).
- No placeholders in task bodies — every `Step` contains either the full file text, the exact replacement block, or a concrete smoke matrix.
- Types are consistent across tasks: `InstanceView`, `GroupView`, `GroupBy`, `ModeFilter`, `StatusFilter`, `ViewFilters`, and helper function signatures are defined in T1 and used verbatim in T2, T6, and T8.
- `AlgosViewProps` gains `runPnlHistories` and `onNavigate`; `App.tsx` supplies both. The spec framed this as "reuse existing contract" — calling the tiny addition out explicitly here.

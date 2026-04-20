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

// Shared renderers live in ./format; re-export so callers keep their imports stable.
export { formatPnl, pnlColorClass, sparklinePoints } from "./format";

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


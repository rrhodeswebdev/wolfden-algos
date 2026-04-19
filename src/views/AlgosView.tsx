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

import type { GroupView, InstanceView } from "../lib/algoInstanceView";
import { AlgoGroupHeader } from "./AlgoGroupHeader";
import { AlgoInstanceRow } from "./AlgoInstanceRow";

type AlgosInstanceListProps = {
  groups: GroupView[];
  hasAnyCharts: boolean;
  hasAnyInstances: boolean;
  selectedInstanceId: string | null;
  aiTerminalAlgoIds?: Set<number>;
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
  aiTerminalAlgoIds,
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
              hasActiveAiTerminal={aiTerminalAlgoIds?.has(inst.algo.id) ?? false}
              onSelect={() => onSelect(inst)}
              onClear={() => onClear(inst)}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

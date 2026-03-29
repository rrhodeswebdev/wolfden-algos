
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
};

type AlgoManagerProps = {
  algos: Algo[];
  activeRuns: AlgoRun[];
  selectedAlgoId: number | null;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onDeleteAlgo: (id: number) => void;
  onStartAlgo: (id: number, mode: "live" | "shadow") => void;
  onStopAlgo: (id: number) => void;
};

export const AlgoManager = ({
  algos,
  activeRuns,
  selectedAlgoId,
  onSelectAlgo,
  onCreateAlgo,
  onDeleteAlgo,
  onStartAlgo,
  onStopAlgo,
}: AlgoManagerProps) => {
  const getRunStatus = (algoId: number) =>
    activeRuns.find((r) => r.algo_id === algoId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Algo Manager
        </span>
        <button
          onClick={onCreateAlgo}
          className="px-4 py-1.5 text-xs bg-[var(--accent-green)] text-black rounded-md hover:opacity-90 transition-opacity font-medium"
        >
          + New
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {algos.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            No algos yet. Click "+ New" to create one.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {algos.map((algo) => {
              const run = getRunStatus(algo.id);
              const isSelected = algo.id === selectedAlgoId;
              const isRunning = run?.status === "running";

              return (
                <div
                  key={algo.id}
                  onClick={() => onSelectAlgo(algo.id)}
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[var(--accent-blue)]/10 border-l-2 border-l-[var(--accent-blue)]"
                      : "hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isRunning
                          ? run.mode === "live"
                            ? "bg-[var(--accent-green)]"
                            : "bg-[var(--accent-yellow)]"
                          : "bg-[var(--border)]"
                      }`}
                    />
                    <span className="text-sm truncate">{algo.name}</span>
                    {isRunning && (
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                        {run.mode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isRunning ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStopAlgo(algo.id);
                        }}
                        className="px-3 py-1 text-[11px] bg-[var(--accent-red)]/20 text-[var(--accent-red)] rounded-md hover:bg-[var(--accent-red)]/30"
                      >
                        Stop
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartAlgo(algo.id, "shadow");
                          }}
                          className="px-3 py-1 text-[11px] bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)] rounded-md hover:bg-[var(--accent-yellow)]/30"
                        >
                          Shadow
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartAlgo(algo.id, "live");
                          }}
                          className="px-3 py-1 text-[11px] bg-[var(--accent-green)]/20 text-[var(--accent-green)] rounded-md hover:bg-[var(--accent-green)]/30"
                        >
                          Live
                        </button>
                      </>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteAlgo(algo.id);
                      }}
                      className="px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-red)] transition-colors"
                    >
                      x
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

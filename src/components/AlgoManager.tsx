
import { useState, useRef, useEffect } from "react";
import type { Algo } from "../types";

type AlgoManagerProps = {
  algos: Algo[];
  selectedAlgoId: number | null;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onCreateAlgoWithAi?: () => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
};

export const AlgoManager = ({
  algos,
  selectedAlgoId,
  onSelectAlgo,
  onCreateAlgo,
  onCreateAlgoWithAi,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
  onDeleteAlgo,
  onRenameAlgo,
}: AlgoManagerProps) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = (algo: Algo) => {
    setEditingId(algo.id);
    setEditingName(algo.name);
  };

  const commitRename = () => {
    if (editingId === null) return;
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== algos.find((a) => a.id === editingId)?.name) {
      onRenameAlgo(editingId, trimmed);
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Algo Manager
        </span>
        <div className="flex items-center gap-2">
          {onCreateAlgoWithAi && (
            <button
              onClick={onCreateAlgoWithAi}
              className="px-3 py-1.5 text-xs bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] rounded-md hover:bg-[var(--accent-blue)]/25 transition-colors font-medium"
            >
              + AI
            </button>
          )}
          <button
            onClick={onCreateAlgo}
            className="px-4 py-1.5 text-xs bg-[var(--accent-green)] text-black rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            + New
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {algos.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            No algos yet. Click "+ New" to create one.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {algos.map((algo) => {
              const isSelected = algo.id === selectedAlgoId;
              const isEditing = editingId === algo.id;

              const hasActiveTerminal = aiTerminalAlgoIds?.has(algo.id) ?? false;

              return (
                <div
                  key={algo.id}
                  onClick={() => onSelectAlgo(algo.id)}
                  className={`group/algo flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[var(--accent-blue)]/10 border-l-2 border-l-[var(--accent-blue)]"
                      : "hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") cancelRename();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--accent-blue)] rounded px-2 py-0.5 outline-none w-full min-w-0"
                      />
                    ) : (
                      <span className="text-sm truncate">
                        {algo.name}
                      </span>
                    )}
                    {hasActiveTerminal && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse flex-shrink-0" title="AI terminal active" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover/algo:opacity-100 transition-opacity">
                    {!isEditing && onOpenAiTerminal && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAlgo(algo.id);
                          onOpenAiTerminal(algo.id);
                        }}
                        disabled={hasActiveTerminal}
                        className={`px-2 py-1 text-[11px] transition-colors ${
                          hasActiveTerminal
                            ? "text-[var(--accent-blue)]/50 cursor-not-allowed"
                            : "text-[var(--text-secondary)] hover:text-[var(--accent-blue)]"
                        }`}
                      >
                        AI
                      </button>
                    )}
                    {!isEditing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAlgo(algo.id);
                          startRename(algo);
                        }}
                        className="px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          <path d="m15 5 4 4" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAlgo(algo.id);
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

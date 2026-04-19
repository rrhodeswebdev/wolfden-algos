import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Search, Terminal, Trash2 } from "lucide-react";
import type { Algo } from "../types";

type AlgoManagerProps = {
  algos: Algo[];
  selectedAlgoId: number | null;
  dirtyAlgoIds?: Set<number>;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
};

export const AlgoManager = ({
  algos,
  selectedAlgoId,
  dirtyAlgoIds,
  onSelectAlgo,
  onCreateAlgo,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
  onDeleteAlgo,
  onRenameAlgo,
}: AlgoManagerProps) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [filter, setFilter] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (menuRef.current?.contains(target as Node)) return;
      if (target?.closest("[data-menu-button]")) return;
      setMenuOpenId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpenId]);

  const startRename = (algo: Algo) => {
    setMenuOpenId(null);
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

  const cancelRename = () => setEditingId(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return algos;
    return algos.filter((a) => a.name.toLowerCase().includes(q));
  }, [algos, filter]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Algos · {algos.length}
          </span>
          <button
            onClick={onCreateAlgo}
            title="New algo (opens AI terminal)"
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter algos…"
            className="w-full bg-[var(--bg-secondary)] border border-transparent rounded-md pl-8 pr-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1.5">
        {algos.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            No algos yet. Click <span className="inline-block align-middle"><Plus size={12} /></span> to create one.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            No algos match "{filter}".
          </div>
        ) : (
          filtered.map((algo) => {
            const isSelected = algo.id === selectedAlgoId;
            const isEditing = editingId === algo.id;
            const isDirty = dirtyAlgoIds?.has(algo.id) ?? false;
            const hasActiveTerminal = aiTerminalAlgoIds?.has(algo.id) ?? false;
            const menuOpen = menuOpenId === algo.id;

            return (
              <div
                key={algo.id}
                onClick={() => !isEditing && onSelectAlgo(algo.id)}
                className={`group/algo relative flex items-center justify-between px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-[var(--accent-blue)]/10 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isDirty && !isEditing && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-yellow)] flex-shrink-0"
                      title="Unsaved"
                    />
                  )}
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
                    <span className="text-sm truncate">{algo.name}</span>
                  )}
                  {hasActiveTerminal && !isEditing && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse flex-shrink-0"
                      title="AI terminal active"
                    />
                  )}
                </div>
                {!isEditing && (
                  <div className="relative flex-shrink-0">
                    <button
                      data-menu-button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpen ? null : algo.id);
                      }}
                      className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors"
                      title="More actions"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {menuOpen && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full mt-1 z-30 w-44 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md shadow-xl py-1 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuRow
                          icon={<Pencil size={11} />}
                          label="Rename"
                          onClick={() => startRename(algo)}
                        />
                        {onOpenAiTerminal && (
                          <MenuRow
                            icon={<Terminal size={11} />}
                            label="AI terminal"
                            disabled={hasActiveTerminal}
                            onClick={() => {
                              setMenuOpenId(null);
                              onSelectAlgo(algo.id);
                              onOpenAiTerminal(algo.id);
                            }}
                          />
                        )}
                        <div className="h-px bg-[var(--border)] my-1" />
                        <MenuRow
                          icon={<Trash2 size={11} />}
                          label="Delete"
                          danger
                          onClick={() => {
                            setMenuOpenId(null);
                            onSelectAlgo(algo.id);
                            onDeleteAlgo(algo.id);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

type MenuRowProps = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const MenuRow = ({ icon, label, onClick, disabled, danger }: MenuRowProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger
        ? "text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
        : "text-[var(--text-primary)] hover:bg-[var(--bg-panel)]"
    }`}
  >
    <span className="text-[var(--text-muted)]">{icon}</span>
    <span>{label}</span>
  </button>
);

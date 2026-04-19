import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus, Sparkles, X } from "lucide-react";

export type EditorTab = {
  id: number;
  name: string;
  isDirty: boolean;
  hasAiTerminal: boolean;
};

type EditorTabsProps = {
  tabs: EditorTab[];
  activeTabId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onCreateAlgo: () => void;
  onCreateAlgoWithAi: () => void;
  onRenameActive: () => void;
  onDeleteActive: () => void;
  onCloseOthers: (id: number) => void;
  onCloseAll: () => void;
};

export const EditorTabs = ({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreateAlgo,
  onCreateAlgoWithAi,
  onRenameActive,
  onDeleteActive,
  onCloseOthers,
  onCloseAll,
}: EditorTabsProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const menuAction = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div className="flex items-stretch h-[38px] bg-[var(--bg-secondary)] border-b border-[var(--border)]">
      <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={`group/tab relative flex items-center gap-2 px-3 text-xs cursor-pointer flex-shrink-0 border-r border-[var(--border)] transition-colors ${
                isActive
                  ? "bg-[var(--bg-panel)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)]/30"
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--accent-blue)]" />
              )}
              <span className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-[3px] bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] text-[9px] font-bold flex-shrink-0">
                Py
              </span>
              <span className="max-w-[180px] truncate">{tab.name}</span>
              {tab.hasAiTerminal && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse flex-shrink-0"
                  title="AI terminal active"
                />
              )}
              {tab.isDirty && !tab.hasAiTerminal && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-yellow)] flex-shrink-0 group-hover/tab:hidden"
                  title="Unsaved"
                />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="inline-flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-opacity flex-shrink-0"
                title="Close tab"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 px-2 flex-shrink-0 border-l border-[var(--border)]">
        <button
          onClick={onCreateAlgo}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors"
          title="New algo"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={onCreateAlgoWithAi}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:bg-[var(--bg-panel)] transition-colors"
          title="New algo with AI"
        >
          <Sparkles size={13} />
        </button>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={activeTabId === null}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="More actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && activeTabId !== null && (
            <div className="absolute right-0 top-full mt-1 z-30 w-44 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md shadow-xl py-1 text-xs">
              <MenuItem label="Rename" onClick={menuAction(onRenameActive)} />
              <MenuItem
                label="Close others"
                onClick={menuAction(() => onCloseOthers(activeTabId))}
                disabled={tabs.length < 2}
              />
              <MenuItem
                label="Close all"
                onClick={menuAction(onCloseAll)}
              />
              <div className="h-px bg-[var(--border)] my-1" />
              <MenuItem
                label="Delete algo"
                onClick={menuAction(onDeleteActive)}
                danger
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

type MenuItemProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const MenuItem = ({ label, onClick, disabled, danger }: MenuItemProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full text-left px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger
        ? "text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
        : "text-[var(--text-primary)] hover:bg-[var(--bg-panel)]"
    }`}
  >
    {label}
  </button>
);

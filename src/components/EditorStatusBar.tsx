type EditorStatusBarProps = {
  isDirty: boolean;
  depsCount: number;
  cursorLine: number;
  cursorCol: number;
  onSave: () => void;
  onToggleDeps: () => void;
};

export const EditorStatusBar = ({
  isDirty,
  depsCount,
  cursorLine,
  cursorCol,
  onSave,
  onToggleDeps,
}: EditorStatusBarProps) => {
  return (
    <div className="flex items-center justify-between h-[26px] px-4 border-t border-[var(--border)] bg-[var(--bg-panel)] text-[11px] text-[var(--text-secondary)] select-none">
      {/* Left group */}
      <div className="flex items-center gap-4">
        {isDirty ? (
          <button
            onClick={onSave}
            className="flex items-center gap-2 px-1 -mx-1 rounded hover:bg-[var(--bg-secondary)] transition-colors text-[var(--accent-yellow)]"
            title="Save changes"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-yellow)]" />
            <span>Unsaved · ⌘S</span>
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
            <span>Saved</span>
          </span>
        )}
        <span className="text-[var(--text-muted)]">Python 3.11</span>
        <button
          onClick={onToggleDeps}
          className="px-1 -mx-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
          title="Toggle dependencies"
        >
          deps: {depsCount}
        </button>
      </div>

      {/* Right group */}
      <div className="flex items-center gap-4 text-[var(--text-muted)]">
        <span>
          Ln {cursorLine}, Col {cursorCol}
        </span>
        <span>Spaces: 4</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
};

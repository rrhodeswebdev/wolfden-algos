import { useCallback, useState } from "react";
import Editor from "@monaco-editor/react";

type AlgoEditorProps = {
  code: string;
  dependencies: string;
  onChange: (value: string) => void;
  onDepsChange: (value: string) => void;
  onSave: () => void;
};

const DEFAULT_ALGO = `from wolf_types import AlgoResult, market_buy, market_sell


def create_algo():
    """Return a dict of handler functions."""

    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        prices = (*state['prices'], tick.price)[-20:]
        new_state = {**state, 'prices': prices}
        return AlgoResult(new_state, ())

    return {'init': init, 'on_tick': on_tick}
`;

export { DEFAULT_ALGO };

export const AlgoEditor = ({ code, dependencies, onChange, onDepsChange, onSave }: AlgoEditorProps) => {
  const [showDeps, setShowDeps] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown as unknown as React.KeyboardEventHandler}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Algo Editor
          </span>
          <button
            onClick={() => setShowDeps(!showDeps)}
            className={`text-[10px] px-2 py-0.5 rounded-md font-medium transition-colors ${
              showDeps
                ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : dependencies
                  ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                  : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {dependencies ? `deps: ${dependencies.split(/\s+/).filter(Boolean).length}` : "deps"}
          </button>
        </div>
        <button
          onClick={onSave}
          className="px-4 py-1.5 text-xs bg-[var(--accent-blue)] text-white rounded-md hover:opacity-90 transition-opacity"
        >
          Save
        </button>
      </div>
      {showDeps && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold block mb-1.5">
            Pip Dependencies
          </label>
          <input
            type="text"
            value={dependencies}
            onChange={(e) => onDepsChange(e.target.value)}
            placeholder="e.g. tensorflow pandas scikit-learn"
            className="w-full px-3 py-2 text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-[var(--accent-blue)]/50"
          />
          <p className="text-[10px] text-[var(--text-secondary)] mt-1.5">
            Space-separated pip packages. Installed automatically when the algo starts.
          </p>
        </div>
      )}
      <div className="flex-1 p-0.5">
        <Editor
          height="100%"
          defaultLanguage="python"
          theme="vs-dark"
          value={code}
          onChange={(value) => onChange(value ?? "")}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: "off",
            lineNumbers: "on",
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
          }}
        />
      </div>
    </div>
  );
};

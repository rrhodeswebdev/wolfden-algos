import { useCallback } from "react";
import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import { defineWolfDenTheme, WOLF_DEN_THEME } from "../lib/monacoTheme";

type AlgoEditorProps = {
  code: string;
  deps: string;
  showDeps: boolean;
  onChange: (value: string) => void;
  onDepsChange: (value: string) => void;
  onSave: () => void;
  onCursorChange: (line: number, col: number) => void;
};

export const DEFAULT_ALGO = `from wolf_types import AlgoResult, market_buy, market_sell


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

export const AlgoEditor = ({
  code,
  deps,
  showDeps,
  onChange,
  onDepsChange,
  onSave,
  onCursorChange,
}: AlgoEditorProps) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  const beforeMount = useCallback((monaco: Monaco) => {
    defineWolfDenTheme(monaco);
  }, []);

  const onMount = useCallback(
    (editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0]) => {
      editor.onDidChangeCursorPosition((e) => {
        onCursorChange(e.position.lineNumber, e.position.column);
      });
      const pos = editor.getPosition();
      if (pos) onCursorChange(pos.lineNumber, pos.column);
    },
    [onCursorChange],
  );

  return (
    <div
      className="flex flex-col h-full"
      onKeyDown={handleKeyDown as unknown as React.KeyboardEventHandler}
    >
      {showDeps && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold block mb-1.5">
            Pip Dependencies
          </label>
          <input
            type="text"
            value={deps}
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
          theme={WOLF_DEN_THEME}
          beforeMount={beforeMount}
          onMount={onMount}
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

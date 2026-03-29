import { useCallback } from "react";
import Editor from "@monaco-editor/react";

type AlgoEditorProps = {
  code: string;
  onChange: (value: string) => void;
  onSave: () => void;
};

const DEFAULT_ALGO = `from typing import NamedTuple

Tick = NamedTuple('Tick', [('symbol', str), ('price', float), ('size', int), ('timestamp', int)])
Bar = NamedTuple('Bar', [('symbol', str), ('o', float), ('h', float), ('l', float), ('c', float), ('v', int), ('timestamp', int)])
Fill = NamedTuple('Fill', [('symbol', str), ('side', str), ('qty', int), ('price', float)])
Order = NamedTuple('Order', [('side', str), ('symbol', str), ('qty', int), ('order_type', str), ('limit_price', float), ('stop_price', float)])
AlgoResult = NamedTuple('AlgoResult', [('state', dict), ('orders', tuple)])


def create_algo():
    """Return a dict of pure handler functions."""

    def init():
        return {'prices': (), 'position': 0}

    def on_tick(state, tick: Tick) -> AlgoResult:
        return AlgoResult(state, ())

    def on_bar(state, bar: Bar) -> AlgoResult:
        return AlgoResult(state, ())

    def on_fill(state, fill: Fill) -> AlgoResult:
        return AlgoResult(state, ())

    return {'init': init, 'on_tick': on_tick, 'on_bar': on_bar, 'on_fill': on_fill}
`;

export { DEFAULT_ALGO };

export const AlgoEditor = ({ code, onChange, onSave }: AlgoEditorProps) => {
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
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Algo Editor
        </span>
        <button
          onClick={onSave}
          className="px-4 py-1.5 text-xs bg-[var(--accent-blue)] text-white rounded-md hover:opacity-90 transition-opacity"
        >
          Save
        </button>
      </div>
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

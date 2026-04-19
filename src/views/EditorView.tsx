import { useState } from "react";
import { AlgoEditor } from "../components/AlgoEditor";
import { AlgoManager } from "../components/AlgoManager";
import { EditorTabs, type EditorTab } from "../components/EditorTabs";
import { EditorStatusBar } from "../components/EditorStatusBar";
import type { UseEditorTabs } from "../hooks/useEditorTabs";
import type { Algo } from "../types";

type EditorViewProps = {
  algos: Algo[];
  tabs: UseEditorTabs;
  aiTerminalAlgoIds: Set<number>;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onOpenAiTerminal: (algoId: number) => void;
  onRequestCloseTab: (id: number) => void;
  onRequestCloseMany: (ids: number[]) => void;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
  onSaveAlgo: () => void;
  onRenameActiveAlgo: () => void;
};

export const EditorView = ({
  algos,
  tabs,
  aiTerminalAlgoIds,
  onSelectAlgo,
  onCreateAlgo,
  onOpenAiTerminal,
  onRequestCloseTab,
  onRequestCloseMany,
  onDeleteAlgo,
  onRenameAlgo,
  onSaveAlgo,
  onRenameActiveAlgo,
}: EditorViewProps) => {
  const [showDeps, setShowDeps] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const activeTabId = tabs.activeTabId;
  const dirtyAlgoIds = new Set(tabs.openTabIds.filter((id) => tabs.isDirty(id)));

  const tabItems: EditorTab[] = tabs.openTabIds.map((id) => {
    const algo = algos.find((a) => a.id === id);
    return {
      id,
      name: algo?.name ?? `algo_${id}`,
      isDirty: tabs.isDirty(id),
      hasAiTerminal: aiTerminalAlgoIds.has(id),
    };
  });

  const depsCount = tabs.activeDeps.split(/\s+/).filter(Boolean).length;
  const isActiveDirty = activeTabId !== null ? tabs.isDirty(activeTabId) : false;

  const handleCloseOthers = (keepId: number) => {
    const ids = tabs.openTabIds.filter((id) => id !== keepId);
    if (ids.length === 0) return;
    onRequestCloseMany(ids);
  };

  const handleCloseAll = () => {
    if (tabs.openTabIds.length === 0) return;
    onRequestCloseMany([...tabs.openTabIds]);
  };

  const handleDeleteActive = () => {
    if (activeTabId !== null) onDeleteAlgo(activeTabId);
  };

  return (
    <div className="flex-1 flex gap-3 p-4 overflow-hidden">
      {/* Left: Algo List */}
      <div className="w-72 flex-shrink-0 bg-[var(--bg-panel)] rounded-lg overflow-hidden">
        <AlgoManager
          algos={algos}
          selectedAlgoId={activeTabId}
          dirtyAlgoIds={dirtyAlgoIds}
          onSelectAlgo={onSelectAlgo}
          onCreateAlgo={onCreateAlgo}
          onOpenAiTerminal={onOpenAiTerminal}
          aiTerminalAlgoIds={aiTerminalAlgoIds}
          onDeleteAlgo={onDeleteAlgo}
          onRenameAlgo={onRenameAlgo}
        />
      </div>

      {/* Right: Editor column */}
      <div className="flex-1 bg-[var(--bg-panel)] rounded-lg overflow-hidden flex flex-col">
        <EditorTabs
          tabs={tabItems}
          activeTabId={activeTabId}
          onSelect={(id) => tabs.switchTab(id)}
          onClose={onRequestCloseTab}
          onOpenAiTerminalForActive={() => {
            if (activeTabId !== null) onOpenAiTerminal(activeTabId);
          }}
          onRenameActive={onRenameActiveAlgo}
          onDeleteActive={handleDeleteActive}
          onCloseOthers={handleCloseOthers}
          onCloseAll={handleCloseAll}
        />

        {activeTabId !== null ? (
          <>
            <div className="flex-1 min-h-0">
              <AlgoEditor
                code={tabs.activeCode}
                deps={tabs.activeDeps}
                showDeps={showDeps}
                onChange={tabs.updateCode}
                onDepsChange={tabs.updateDeps}
                onSave={onSaveAlgo}
                onCursorChange={(line, col) => setCursor({ line, col })}
              />
            </div>
            <EditorStatusBar
              isDirty={isActiveDirty}
              depsCount={depsCount}
              cursorLine={cursor.line}
              cursorCol={cursor.col}
              onSave={onSaveAlgo}
              onToggleDeps={() => setShowDeps((v) => !v)}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
            {algos.length === 0
              ? "Create an algo to get started"
              : "Select an algo to edit"}
          </div>
        )}
      </div>
    </div>
  );
};

import { AlgoEditor } from "../components/AlgoEditor";
import { AlgoManager } from "../components/AlgoManager";

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

type EditorViewProps = {
  algos: Algo[];
  selectedAlgoId: number | null;
  editorCode: string;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
  onEditorChange: (code: string) => void;
  onSaveAlgo: () => void;
};

export const EditorView = ({
  algos,
  selectedAlgoId,
  editorCode,
  onSelectAlgo,
  onCreateAlgo,
  onDeleteAlgo,
  onRenameAlgo,
  onEditorChange,
  onSaveAlgo,
}: EditorViewProps) => {
  return (
    <div className="flex-1 flex gap-3 p-4 overflow-hidden">
      {/* Left: Algo List */}
      <div className="w-72 flex-shrink-0 bg-[var(--bg-panel)] rounded-lg overflow-hidden">
        <AlgoManager
          algos={algos}
          selectedAlgoId={selectedAlgoId}
          onSelectAlgo={onSelectAlgo}
          onCreateAlgo={onCreateAlgo}
          onDeleteAlgo={onDeleteAlgo}
          onRenameAlgo={onRenameAlgo}
        />
      </div>

      {/* Right: Editor */}
      <div className="flex-1 bg-[var(--bg-panel)] rounded-lg overflow-hidden">
        {selectedAlgoId !== null ? (
          <AlgoEditor
            code={editorCode}
            onChange={onEditorChange}
            onSave={onSaveAlgo}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-[var(--text-secondary)]">
            {algos.length === 0
              ? "Create an algo to get started"
              : "Select an algo to edit"}
          </div>
        )}
      </div>
    </div>
  );
};

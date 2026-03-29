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

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
};

type AlgosViewProps = {
  algos: Algo[];
  activeRuns: AlgoRun[];
  selectedAlgoId: number | null;
  editorCode: string;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
  onStartAlgo: (id: number, mode: "live" | "shadow") => void;
  onStopAlgo: (id: number) => void;
  onEditorChange: (code: string) => void;
  onSaveAlgo: () => void;
};

export const AlgosView = ({
  algos,
  activeRuns,
  selectedAlgoId,
  editorCode,
  onSelectAlgo,
  onCreateAlgo,
  onDeleteAlgo,
  onRenameAlgo,
  onStartAlgo,
  onStopAlgo,
  onEditorChange,
  onSaveAlgo,
}: AlgosViewProps) => {
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
        <AlgoEditor
          code={editorCode}
          onChange={onEditorChange}
          onSave={onSaveAlgo}
        />
      </div>
    </div>
  );
};

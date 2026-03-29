import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_ALGO } from "./components/AlgoEditor";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./views/HomeView";
import { AlgosView } from "./views/AlgosView";
import { TradingView } from "./views/TradingView";

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

type View = "home" | "algos" | "trading";

export const App = () => {
  const [activeView, setActiveView] = useState<View>("home");
  // TODO: update via WebSocket events from Rust backend
  const [connectionStatus, _setConnectionStatus] = useState<"waiting" | "connected" | "error">("waiting");
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [selectedAlgoId, setSelectedAlgoId] = useState<number | null>(null);
  const [editorCode, setEditorCode] = useState(DEFAULT_ALGO);
  const [activeRuns, setActiveRuns] = useState<AlgoRun[]>([]);

  const selectedAlgo = algos.find((a) => a.id === selectedAlgoId) ?? null;

  const loadAlgos = useCallback(async () => {
    try {
      const result = await invoke<Algo[]>("get_algos");
      setAlgos(result);
    } catch (e) {
      console.error("Failed to load algos:", e);
    }
  }, []);

  useEffect(() => {
    loadAlgos();
  }, [loadAlgos]);

  useEffect(() => {
    if (selectedAlgo) {
      setEditorCode(selectedAlgo.code);
    }
  }, [selectedAlgo?.id]);

  const handleCreateAlgo = async () => {
    try {
      const name = `algo_${Date.now()}`;
      const algo = await invoke<Algo>("create_algo", {
        name,
        code: DEFAULT_ALGO,
        dependencies: "",
      });
      setAlgos((prev) => [algo, ...prev]);
      setSelectedAlgoId(algo.id);
      setEditorCode(algo.code);
    } catch (e) {
      console.error("Failed to create algo:", e);
    }
  };

  const handleSaveAlgo = async () => {
    if (!selectedAlgo) return;
    try {
      await invoke("update_algo", {
        id: selectedAlgo.id,
        name: selectedAlgo.name,
        code: editorCode,
        dependencies: selectedAlgo.dependencies,
      });
      await loadAlgos();
    } catch (e) {
      console.error("Failed to save algo:", e);
    }
  };

  const handleDeleteAlgo = async (id: number) => {
    try {
      await invoke("delete_algo", { id });
      if (selectedAlgoId === id) {
        setSelectedAlgoId(null);
        setEditorCode(DEFAULT_ALGO);
      }
      await loadAlgos();
    } catch (e) {
      console.error("Failed to delete algo:", e);
    }
  };

  const handleStartAlgo = async (id: number, mode: "live" | "shadow") => {
    try {
      await invoke("start_algo", { algoId: id, mode });
      setActiveRuns((prev) => [...prev, { algo_id: id, status: "running", mode }]);
    } catch (e) {
      console.error("Failed to start algo:", e);
    }
  };

  const handleStopAlgo = async (id: number) => {
    try {
      await invoke("stop_algo", { algoId: id });
      setActiveRuns((prev) => prev.filter((r) => r.algo_id !== id));
    } catch (e) {
      console.error("Failed to stop algo:", e);
    }
  };

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      {/* Sidebar Navigation */}
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        connectionStatus={connectionStatus}
      />

      {/* View Content */}
      {activeView === "home" && (
        <HomeView
          connectionStatus={connectionStatus}
          algos={algos}
          activeRuns={activeRuns}
          onNavigate={setActiveView}
        />
      )}

      {activeView === "algos" && (
        <AlgosView
          algos={algos}
          activeRuns={activeRuns}
          selectedAlgoId={selectedAlgoId}
          editorCode={editorCode}
          onSelectAlgo={setSelectedAlgoId}
          onCreateAlgo={handleCreateAlgo}
          onDeleteAlgo={handleDeleteAlgo}
          onStartAlgo={handleStartAlgo}
          onStopAlgo={handleStopAlgo}
          onEditorChange={setEditorCode}
          onSaveAlgo={handleSaveAlgo}
        />
      )}

      {activeView === "trading" && (
        <TradingView connectionStatus={connectionStatus} />
      )}
    </div>
  );
};

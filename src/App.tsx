import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_ALGO } from "./components/AlgoEditor";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./views/HomeView";
import { EditorView } from "./views/EditorView";
import { AlgosView } from "./views/AlgosView";
import { TradingView } from "./views/TradingView";
import { TitleBar } from "./components/TitleBar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useTradingSimulation } from "./hooks/useTradingSimulation";
import type { DataSource } from "./hooks/useTradingSimulation";

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
  account: string;
  data_source_id: string;
  instance_id: string;
};

type View = "home" | "editor" | "algos" | "trading";

export const App = () => {
  const [activeView, setActiveView] = useState<View>("home");
  const [connectionStatus, setConnectionStatus] = useState<"waiting" | "connected" | "error">("waiting");
  const [accounts, setAccounts] = useState<Record<string, { buying_power: number; cash: number; realized_pnl: number }>>({});
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [selectedAlgoId, setSelectedAlgoId] = useState<number | null>(null);
  const [editorCode, setEditorCode] = useState(DEFAULT_ALGO);
  const [activeRuns, setActiveRuns] = useState<AlgoRun[]>([]);

  const simulation = useTradingSimulation(algos, activeRuns, dataSources);
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
    const u1 = listen<number>("nt-connection-count", (event) => {
      setConnectionStatus(event.payload > 0 ? "connected" : "waiting");
    });
    const u2 = listen<{ name: string; buying_power: number; cash: number; realized_pnl: number }>("nt-account", (event) => {
      const { name, ...data } = event.payload;
      setAccounts((prev) => ({ ...prev, [name]: data }));
    });
    const u3 = listen<string>("nt-account-removed", (event) => {
      setAccounts((prev) => {
        const next = { ...prev };
        delete next[event.payload];
        return next;
      });
    });
    const u4 = listen<DataSource>("nt-chart", (event) => {
      setDataSources((prev) => {
        const exists = prev.some((ds) => ds.id === event.payload.id);
        if (exists) return prev.map((ds) => ds.id === event.payload.id ? event.payload : ds);
        return [...prev, event.payload];
      });
    });
    const u5 = listen<string>("nt-chart-removed", (event) => {
      setDataSources((prev) => prev.filter((ds) => ds.id !== event.payload));
    });
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
      u3.then((f) => f());
      u4.then((f) => f());
      u5.then((f) => f());
    };
  }, []);

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

  const handleRenameAlgo = async (id: number, newName: string) => {
    const algo = algos.find((a) => a.id === id);
    if (!algo) return;
    try {
      await invoke("update_algo", {
        id,
        name: newName,
        code: algo.code,
        dependencies: algo.dependencies,
      });
      await loadAlgos();
    } catch (e) {
      console.error("Failed to rename algo:", e);
    }
  };

  const hasUnsavedChanges = selectedAlgo ? editorCode !== selectedAlgo.code : false;
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  const handleNavigate = (view: View) => {
    if (view === activeView) return;
    if (activeView === "editor" && hasUnsavedChanges) {
      setConfirmDialog({
        message: "You have unsaved changes. Leave without saving?",
        confirmLabel: "Leave",
        onConfirm: () => {
          if (selectedAlgo) setEditorCode(selectedAlgo.code);
          setActiveView(view);
          setConfirmDialog(null);
        },
      });
      return;
    }
    setActiveView(view);
  };

  const handleSelectAlgo = (id: number) => {
    if (id === selectedAlgoId) return;
    if (hasUnsavedChanges) {
      setConfirmDialog({
        message: "You have unsaved changes. Leave without saving?",
        confirmLabel: "Leave",
        onConfirm: () => {
          setSelectedAlgoId(id);
          setConfirmDialog(null);
        },
      });
      return;
    }
    setSelectedAlgoId(id);
  };

  const handleDeleteAlgo = (id: number) => {
    setConfirmDialog({
      message: "Are you sure you want to delete this algo?",
      confirmLabel: "Delete",
      onConfirm: async () => {
        setConfirmDialog(null);
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
      },
    });
  };

  const handleStartAlgo = async (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => {
    try {
      const instanceId = crypto.randomUUID();
      await invoke("start_algo_instance", { instanceId });
      setActiveRuns((prev) => [...prev, {
        algo_id: id, status: "running", mode, account,
        data_source_id: dataSourceId, instance_id: instanceId,
      }]);
    } catch (e) {
      console.error("Failed to start algo:", e);
    }
  };

  const handleStopAlgo = async (instanceId: string) => {
    try {
      await invoke("stop_algo_instance", { instanceId });
      setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
    } catch (e) {
      console.error("Failed to stop algo:", e);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <TitleBar title="Wolf Den" />
      <div className="flex flex-1 min-h-0">
      {/* Sidebar Navigation */}
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        connectionStatus={connectionStatus}
      />

      {/* View Content */}
      {activeView === "home" && (
        <HomeView
          connectionStatus={connectionStatus}
          accounts={accounts}
          algos={algos}
          activeRuns={activeRuns}
          stats={simulation.stats}
          positions={simulation.positions}
        />
      )}

      {activeView === "editor" && (
        <EditorView
          algos={algos}
          selectedAlgoId={selectedAlgoId}
          editorCode={editorCode}
          onSelectAlgo={handleSelectAlgo}
          onCreateAlgo={handleCreateAlgo}
          onDeleteAlgo={handleDeleteAlgo}
          onRenameAlgo={handleRenameAlgo}
          onEditorChange={setEditorCode}
          onSaveAlgo={handleSaveAlgo}
        />
      )}

      {activeView === "algos" && (
        <AlgosView
          algos={algos}
          dataSources={dataSources}
          activeRuns={activeRuns}
          algoStats={simulation.algoStats}
          onStartAlgo={handleStartAlgo}
          onStopAlgo={handleStopAlgo}
        />
      )}

      {activeView === "trading" && (
        <TradingView simulation={simulation} algos={algos} activeRuns={activeRuns} />
      )}
      </div>

      {confirmDialog !== null && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
};

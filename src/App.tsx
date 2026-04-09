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
import { AiTerminalPanel } from "./components/AiTerminalPanel";
import { ToastContainer, toast } from "./components/Toast";
import { useTradingSimulation } from "./hooks/useTradingSimulation";
import { useAlgoErrors } from "./hooks/useAlgoErrors";
import type { DataSource } from "./hooks/useTradingSimulation";
import { VenvSetupModal } from "./components/VenvSetupModal";

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

  const [aiTerminalAlgoIds, setAiTerminalAlgoIds] = useState<Set<number>>(new Set());
  const [venvReady, setVenvReady] = useState<boolean | null>(null);

  const simulation = useTradingSimulation(algos, activeRuns, dataSources);

  const handleAutoStop = useCallback(async (instanceId: string) => {
    toast.error(`Algo instance ${instanceId.slice(0, 8)}... halted due to repeated errors`);
    try {
      await invoke("stop_algo_instance", { instanceId });
    } catch (e) {
      console.error("Failed to auto-stop algo:", e);
    }
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
  }, []);

  const { errorsByInstance, clearErrors } = useAlgoErrors(handleAutoStop);

  const selectedAlgo = algos.find((a) => a.id === selectedAlgoId) ?? null;
  const aiTerminalAlgos = algos.filter((a) => aiTerminalAlgoIds.has(a.id));

  const loadAlgos = useCallback(async () => {
    try {
      const result = await invoke<Algo[]>("get_algos");
      setAlgos(result);
    } catch (e) {
      console.error("Failed to load algos:", e);
    }
  }, []);

  // Load algos and running instances on startup
  const loadRunningInstances = useCallback(async () => {
    try {
      type Instance = { id: string; algo_id: number; data_source_id: string; account: string; mode: string; status: string };
      const instances = await invoke<Instance[]>("get_algo_instances", { dataSourceId: null });
      const running = instances
        .filter((i) => i.status === "running")
        .map((i) => ({
          algo_id: i.algo_id,
          status: i.status,
          mode: i.mode,
          account: i.account,
          data_source_id: i.data_source_id,
          instance_id: i.id,
        }));
      setActiveRuns(running);
    } catch (e) {
      console.error("Failed to load running instances:", e);
    }
  }, []);

  useEffect(() => {
    loadAlgos();
    loadRunningInstances();
  }, [loadAlgos, loadRunningInstances]);

  useEffect(() => {
    const checkVenv = async () => {
      try {
        const status = await invoke<{ healthy: boolean }>("check_venv_status");
        if (status.healthy) {
          setVenvReady(true);
        } else {
          setVenvReady(false);
        }
      } catch {
        setVenvReady(false);
      }
    };
    checkVenv();
  }, []);

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
      const removedId = event.payload;
      setDataSources((prev) => prev.filter((ds) => ds.id !== removedId));

      // Stop any algos running on the disconnected chart
      setActiveRuns((prev) => {
        const toStop = prev.filter((r) => r.data_source_id === removedId);
        for (const run of toStop) {
          invoke("stop_algo_instance", { instanceId: run.instance_id }).catch((e) =>
            console.error("Failed to stop algo on chart disconnect:", e)
          );
        }
        return prev.filter((r) => r.data_source_id !== removedId);
      });
    });
    const u6 = listen<{ algo_id: number; code: string }>("algo-code-updated", (event) => {
      const { algo_id, code } = event.payload;
      setAlgos((prev) =>
        prev.map((a) => (a.id === algo_id ? { ...a, code, updated_at: new Date().toISOString() } : a))
      );
      // If the updated algo is currently selected in the editor, update editorCode
      setSelectedAlgoId((currentId) => {
        if (currentId === algo_id) {
          setEditorCode(code);
        }
        return currentId;
      });
    });
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
      u3.then((f) => f());
      u4.then((f) => f());
      u5.then((f) => f());
      u6.then((f) => f());
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

  const handleCreateAlgoWithAi = useCallback(async () => {
    try {
      const name = `algo_${Date.now()}`;
      const algo = await invoke<Algo>("create_algo", {
        name,
        code: DEFAULT_ALGO,
        dependencies: "",
      });
      setAlgos((prev) => [algo, ...prev]);
      setSelectedAlgoId(algo.id);
      setAiTerminalAlgoIds((prev) => new Set(prev).add(algo.id));
    } catch (e) {
      console.error("Failed to create algo:", e);
      toast.error("Failed to create algo: " + e);
    }
  }, []);

  const handleOpenAiTerminal = useCallback((algoId: number) => {
    if (aiTerminalAlgoIds.has(algoId)) {
      // Terminal already running — just show the panel
      return;
    }
    setAiTerminalAlgoIds((prev) => new Set(prev).add(algoId));
  }, [aiTerminalAlgoIds]);

  const handleCloseAiTerminal = useCallback((algoId: number) => {
    setAiTerminalAlgoIds((prev) => {
      const next = new Set(prev);
      next.delete(algoId);
      return next;
    });
  }, []);

  const handleStartAlgo = async (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => {
    console.log("[handleStartAlgo] called:", { id, mode, account, dataSourceId });
    let instanceId: string | null = null;
    try {
      // Create the instance in the DB first
      const instance = await invoke<{ id: string }>("create_algo_instance", {
        algoId: id,
        dataSourceId: dataSourceId,
        account,
        mode,
      });
      instanceId = instance.id;
      console.log("[handleStartAlgo] instance created:", instanceId);

      // Show "installing" status while deps install + process starts
      setActiveRuns((prev) => [...prev, {
        algo_id: id, status: "installing", mode, account,
        data_source_id: dataSourceId, instance_id: instanceId!,
      }]);

      // start_algo_instance now handles dep installation before spawning
      await invoke("start_algo_instance", { instanceId });
      console.log("[handleStartAlgo] process started, updating to running");

      // Update status to running
      setActiveRuns((prev) => prev.map((r) =>
        r.instance_id === instanceId ? { ...r, status: "running" } : r
      ));
    } catch (e) {
      console.error("Failed to start algo:", e);
      // Remove the "installing" entry on failure (if instance was created)
      if (instanceId) {
        setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
      }
      toast.error("Failed to start algo: " + e);
    }
  };

  const handleStopAlgo = async (instanceId: string) => {
    try {
      await invoke("stop_algo_instance", { instanceId });
    } catch (e) {
      console.error("Failed to stop algo:", e);
    }
    // Always remove from UI even if backend call fails
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
    clearErrors(instanceId);
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
          onCreateAlgoWithAi={handleCreateAlgoWithAi}
          onOpenAiTerminal={handleOpenAiTerminal}
          aiTerminalAlgoIds={aiTerminalAlgoIds}
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
          errorsByInstance={errorsByInstance}
          onStartAlgo={handleStartAlgo}
          onStopAlgo={handleStopAlgo}
          onClearErrors={clearErrors}
          onOpenAiTerminal={handleOpenAiTerminal}
          aiTerminalAlgoIds={aiTerminalAlgoIds}
        />
      )}

      {activeView === "trading" && (
        <TradingView simulation={simulation} algos={algos} activeRuns={activeRuns} />
      )}

      {aiTerminalAlgos.length > 0 && (
        <AiTerminalPanel
          tabs={aiTerminalAlgos.map((a) => ({ algoId: a.id, algoName: a.name }))}
          selectedAlgoId={selectedAlgoId}
          onSelectAlgo={setSelectedAlgoId}
          onClose={handleCloseAiTerminal}
          onSpawnError={(algoId, error) => {
            handleCloseAiTerminal(algoId);
            if (error.includes("not found")) {
              toast.error("Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code");
            } else {
              toast.error("Failed to start AI terminal: " + error);
            }
          }}
        />
      )}
      </div>

      {venvReady === false && (
        <VenvSetupModal onComplete={() => setVenvReady(true)} />
      )}

      {confirmDialog !== null && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      <ToastContainer />
    </div>
  );
};

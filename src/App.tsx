import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { RenameDialog } from "./components/RenameDialog";
import { AiTerminalPanel } from "./components/AiTerminalPanel";
import { ToastContainer, toast } from "./components/Toast";
import { useTradingSimulation } from "./hooks/useTradingSimulation";
import { useTradeHistory } from "./hooks/useTradeHistory";
import { useRollingMetrics } from "./hooks/useRollingMetrics";
import { useAlgoErrors } from "./hooks/useAlgoErrors";
import { useAlgoLogs } from "./hooks/useAlgoLogs";
import { useAlgoHealth } from "./hooks/useAlgoHealth";
import { useEditorTabs } from "./hooks/useEditorTabs";
import type { DataSource } from "./hooks/useTradingSimulation";
import { VenvSetupModal } from "./components/VenvSetupModal";
import type { Algo, AlgoRun, View, NavOptions, NavContext } from "./types";

export const App = () => {
  const [activeView, setActiveView] = useState<View>("home");
  const [pendingNavContext, setPendingNavContext] = useState<NavContext | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"waiting" | "connected" | "error">("waiting");
  const [accounts, setAccounts] = useState<Record<string, { buying_power: number; cash: number; realized_pnl: number }>>({});
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [activeRuns, setActiveRuns] = useState<AlgoRun[]>([]);

  const tabs = useEditorTabs();
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const algosRef = useRef(algos);
  useEffect(() => {
    algosRef.current = algos;
  }, [algos]);

  const activeRunsRef = useRef(activeRuns);
  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);

  const [aiTerminalAlgoIds, setAiTerminalAlgoIds] = useState<Set<number>>(new Set());
  const [venvReady, setVenvReady] = useState<boolean | null>(null);

  const simulation = useTradingSimulation(algos, activeRuns, dataSources);
  const tradeHistory = useTradeHistory(algos, activeRuns);
  const rolling = useRollingMetrics(tradeHistory.roundtrips);

  // Merge backtest stats (from useTradingSimulation) with live roundtrip-derived stats
  // (from useTradeHistory). Live overrides backtest once the instance has closed trades.
  // runPnlHistories likewise comes from live roundtrips; the simulation hook returns {}.
  const mergedAlgoStats = useMemo(
    () => ({ ...simulation.algoStats, ...tradeHistory.statsByInstance }),
    [simulation.algoStats, tradeHistory.statsByInstance],
  );
  const mergedRunPnlHistories = tradeHistory.pnlHistoryByInstance;

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
  const { logsByInstance, clearLogs } = useAlgoLogs();
  const { healthByInstance } = useAlgoHealth();

  const aiTerminalAlgos = algos.filter((a) => aiTerminalAlgoIds.has(a.id));

  const loadAlgos = useCallback(async () => {
    try {
      const result = await invoke<Algo[]>("get_algos");
      setAlgos(result);
    } catch (e) {
      console.error("Failed to load algos:", e);
    }
  }, []);

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
      const toStop = activeRunsRef.current.filter((r) => r.data_source_id === removedId);
      for (const run of toStop) {
        invoke("stop_algo_instance", { instanceId: run.instance_id }).catch((e) =>
          console.error("Failed to stop algo on chart disconnect:", e)
        );
      }
      setActiveRuns((prev) => prev.filter((r) => r.data_source_id !== removedId));
    });
    const u6 = listen<{ algo_id: number; code: string }>("algo-code-updated", (event) => {
      const { algo_id, code } = event.payload;
      const algo = algosRef.current.find((a) => a.id === algo_id);
      const deps = algo?.dependencies ?? "";
      setAlgos((prev) =>
        prev.map((a) => (a.id === algo_id ? { ...a, code, updated_at: new Date().toISOString() } : a))
      );
      const result = tabsRef.current.onAlgoExternallyUpdated(algo_id, code, deps);
      if (result.conflicted) {
        const name = algosRef.current.find((a) => a.id === algo_id)?.name ?? `algo ${algo_id}`;
        toast.error(`External update to ${name}. Your unsaved edits will overwrite it on save.`);
      }
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

  const [confirmDialog, setConfirmDialog] = useState<{ message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ algoId: number; currentName: string } | null>(null);

  const handleNavigate = (view: View, options?: NavOptions) => {
    if (view === activeView && !options) return;
    setPendingNavContext(options ? { ...options, targetView: view } : null);
    setActiveView(view);
  };

  const clearPendingNavContext = useCallback(() => {
    setPendingNavContext(null);
  }, []);

  const handleSelectAlgo = (id: number) => {
    const algo = algos.find((a) => a.id === id);
    if (!algo) return;
    tabs.openTab(algo);
  };

  const handleRequestCloseTab = (id: number) => {
    const { dirty } = tabs.closeTab(id);
    if (!dirty) return;
    const name = algos.find((a) => a.id === id)?.name ?? `algo ${id}`;
    setConfirmDialog({
      message: `Close ${name}? Unsaved changes will be lost.`,
      confirmLabel: "Close",
      onConfirm: () => {
        tabs.forceCloseTab(id);
        setConfirmDialog(null);
      },
    });
  };

  const handleRequestCloseMany = (ids: number[]) => {
    const dirtyIds = ids.filter((id) => tabs.isDirty(id));
    if (dirtyIds.length === 0) {
      for (const id of ids) tabs.forceCloseTab(id);
      return;
    }
    const noun = dirtyIds.length === 1 ? "tab" : "tabs";
    setConfirmDialog({
      message: `Close ${dirtyIds.length} ${noun} with unsaved changes?`,
      confirmLabel: "Close All",
      onConfirm: () => {
        for (const id of ids) tabs.forceCloseTab(id);
        setConfirmDialog(null);
      },
    });
  };

  const handleCreateAlgo = async () => {
    try {
      const name = `algo_${Date.now()}`;
      const algo = await invoke<Algo>("create_algo", {
        name,
        code: DEFAULT_ALGO,
        dependencies: "",
      });
      setAlgos((prev) => [algo, ...prev]);
      tabs.openTab(algo);
      setAiTerminalAlgoIds((prev) => new Set(prev).add(algo.id));
    } catch (e) {
      console.error("Failed to create algo:", e);
      toast.error("Failed to create algo: " + e);
    }
  };

  const handleSaveAlgo = async () => {
    const activeId = tabs.activeTabId;
    if (activeId === null) return;
    const algo = algos.find((a) => a.id === activeId);
    if (!algo) return;
    try {
      await invoke("update_algo", {
        id: algo.id,
        name: algo.name,
        code: tabs.activeCode,
        dependencies: tabs.activeDeps,
      });
      tabs.markActiveSaved();
      await loadAlgos();
    } catch (e) {
      console.error("Failed to save algo:", e);
      toast.error("Failed to save: " + e);
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

  const handleRenameActiveAlgo = () => {
    const activeId = tabs.activeTabId;
    if (activeId === null) return;
    const algo = algos.find((a) => a.id === activeId);
    if (!algo) return;
    setRenameDialog({ algoId: activeId, currentName: algo.name });
  };

  const handleDeleteAlgo = (id: number) => {
    setConfirmDialog({
      message: "Are you sure you want to delete this algo?",
      confirmLabel: "Delete",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await invoke("delete_algo", { id });
          tabs.onAlgoDeleted(id);
          await loadAlgos();
        } catch (e) {
          console.error("Failed to delete algo:", e);
        }
      },
    });
  };

  const handleOpenAiTerminal = useCallback((algoId: number) => {
    if (aiTerminalAlgoIds.has(algoId)) return;
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
    let instanceId: string | null = null;
    try {
      const instance = await invoke<{ id: string }>("create_algo_instance", {
        algoId: id,
        dataSourceId: dataSourceId,
        account,
        mode,
      });
      instanceId = instance.id;
      setActiveRuns((prev) => [...prev, {
        algo_id: id, status: "installing", mode, account,
        data_source_id: dataSourceId, instance_id: instanceId!,
      }]);
      await invoke("start_algo_instance", { instanceId });
      setActiveRuns((prev) => prev.map((r) =>
        r.instance_id === instanceId ? { ...r, status: "running" } : r
      ));
    } catch (e) {
      console.error("Failed to start algo:", e);
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
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
    clearErrors(instanceId);
    clearLogs(instanceId);
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <TitleBar title="Wolf Den" />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          connectionStatus={connectionStatus}
        />

        {activeView === "home" && (
          <HomeView
            connectionStatus={connectionStatus}
            accounts={accounts}
            algos={algos}
            activeRuns={activeRuns}
            stats={simulation.stats}
            positions={simulation.positions}
            pnlHistory={simulation.pnlHistory}
            runPnlHistories={mergedRunPnlHistories}
            algoStats={mergedAlgoStats}
            onNavigate={handleNavigate}
            onStopAlgo={handleStopAlgo}
          />
        )}

        {activeView === "editor" && (
          <EditorView
            algos={algos}
            tabs={tabs}
            aiTerminalAlgoIds={aiTerminalAlgoIds}
            onSelectAlgo={handleSelectAlgo}
            onCreateAlgo={handleCreateAlgo}
            onOpenAiTerminal={handleOpenAiTerminal}
            onRequestCloseTab={handleRequestCloseTab}
            onRequestCloseMany={handleRequestCloseMany}
            onDeleteAlgo={handleDeleteAlgo}
            onRenameAlgo={handleRenameAlgo}
            onSaveAlgo={handleSaveAlgo}
            onRenameActiveAlgo={handleRenameActiveAlgo}
          />
        )}

        {activeView === "algos" && (
          <AlgosView
            algos={algos}
            dataSources={dataSources}
            activeRuns={activeRuns}
            algoStats={mergedAlgoStats}
            runPnlHistories={mergedRunPnlHistories}
            errorsByInstance={errorsByInstance}
            logsByInstance={logsByInstance}
            healthByInstance={healthByInstance}
            onStartAlgo={handleStartAlgo}
            onStopAlgo={handleStopAlgo}
            onClearLogs={clearLogs}
            onOpenAiTerminal={handleOpenAiTerminal}
            aiTerminalAlgoIds={aiTerminalAlgoIds}
            initialInstanceId={pendingNavContext?.targetView === "algos" ? pendingNavContext.instanceId : null}
            onInstanceFocused={clearPendingNavContext}
            onNavigate={handleNavigate}
          />
        )}

        {activeView === "trading" && (
          <TradingView
            simulation={simulation}
            tradeHistory={tradeHistory}
            rolling={rolling}
            algos={algos}
            activeRuns={activeRuns}
            dataSources={dataSources}
            accounts={accounts}
            initialContext={pendingNavContext}
            onContextConsumed={clearPendingNavContext}
            onNavigate={handleNavigate}
          />
        )}

        {aiTerminalAlgos.length > 0 && (
          <AiTerminalPanel
            tabs={aiTerminalAlgos.map((a) => ({ algoId: a.id, algoName: a.name }))}
            selectedAlgoId={tabs.activeTabId}
            onSelectAlgo={(id) => {
              const algo = algos.find((a) => a.id === id);
              if (algo) tabs.openTab(algo);
            }}
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

      {renameDialog !== null && (
        <RenameDialog
          currentName={renameDialog.currentName}
          onRename={(newName) => {
            handleRenameAlgo(renameDialog.algoId, newName);
            setRenameDialog(null);
          }}
          onCancel={() => setRenameDialog(null)}
        />
      )}

      <ToastContainer />
    </div>
  );
};

import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

export type AlgoErrorSeverity = "critical" | "error" | "warning";
export type AlgoErrorCategory = "runtime" | "risk" | "infrastructure" | "logic";

export type AlgoError = {
  id: number;
  instanceId: string;
  algoId: string;
  severity: AlgoErrorSeverity;
  category: AlgoErrorCategory;
  message: string;
  handler: string;
  traceback: string;
  timestamp: number;
};

export type InstanceErrors = {
  errors: AlgoError[];
  errorCount: number;
  warningCount: number;
  autoStopped: boolean;
};

type AlgoErrorEvent = {
  instance_id: string;
  algo_id: string;
  severity: string;
  category: string;
  message: string;
  handler: string;
  traceback: string;
  timestamp: number;
};

const MAX_ERRORS_PER_INSTANCE = 100;
const AUTO_STOP_THRESHOLD = 10;
const AUTO_STOP_WINDOW_MS = 5000;

export const useAlgoErrors = (
  onAutoStop: (instanceId: string) => void,
) => {
  const [errorsByInstance, setErrorsByInstance] = useState<Record<string, InstanceErrors>>({});
  const nextId = useRef(1);
  const recentErrors = useRef<Record<string, number[]>>({});
  const autoStoppedInstances = useRef<Set<string>>(new Set());

  const clearErrors = useCallback((instanceId: string) => {
    setErrorsByInstance((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
    delete recentErrors.current[instanceId];
    autoStoppedInstances.current.delete(instanceId);
  }, []);

  useEffect(() => {
    const unlisten = listen<AlgoErrorEvent>("algo-error", (event) => {
      const e = event.payload;
      const now = Date.now();

      const newError: AlgoError = {
        id: nextId.current++,
        instanceId: e.instance_id,
        algoId: e.algo_id,
        severity: e.severity as AlgoErrorSeverity,
        category: e.category as AlgoErrorCategory,
        message: e.message,
        handler: e.handler,
        traceback: e.traceback,
        timestamp: e.timestamp || now,
      };

      // Auto-stop check for runtime exceptions
      let shouldAutoStop = false;
      if (e.category === "runtime" && e.severity !== "warning") {
        if (!recentErrors.current[e.instance_id]) {
          recentErrors.current[e.instance_id] = [];
        }
        const recent = recentErrors.current[e.instance_id];
        recent.push(now);
        const cutoff = now - AUTO_STOP_WINDOW_MS;
        recentErrors.current[e.instance_id] = recent.filter((t) => t > cutoff);
        if (recentErrors.current[e.instance_id].length >= AUTO_STOP_THRESHOLD) {
          shouldAutoStop = true;
        }
      }

      // Infrastructure errors (process death) auto-stop immediately
      if (e.category === "infrastructure" && e.severity === "critical") {
        shouldAutoStop = true;
      }

      setErrorsByInstance((prev) => {
        const existing = prev[e.instance_id] ?? {
          errors: [],
          errorCount: 0,
          warningCount: 0,
          autoStopped: false,
        };

        let errors = [newError, ...existing.errors];
        if (errors.length > MAX_ERRORS_PER_INSTANCE) {
          errors = errors.slice(0, MAX_ERRORS_PER_INSTANCE);
        }

        let errorCount = 0;
        let warningCount = 0;
        for (const err of errors) {
          if (err.severity === "warning") warningCount++;
          else errorCount++;
        }

        return {
          ...prev,
          [e.instance_id]: {
            errors,
            errorCount,
            warningCount,
            autoStopped: existing.autoStopped || shouldAutoStop,
          },
        };
      });

      if (shouldAutoStop && !autoStoppedInstances.current.has(e.instance_id)) {
        autoStoppedInstances.current.add(e.instance_id);
        delete recentErrors.current[e.instance_id];
        onAutoStop(e.instance_id);
      }
    });

    return () => { unlisten.then((f) => f()); };
  }, [onAutoStop]);

  return { errorsByInstance, clearErrors };
};

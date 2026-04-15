import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

export type LogEventType =
  | "BAR"
  | "ORDER"
  | "FILL"
  | "SIGNAL"
  | "ERROR"
  | "POSITION"
  | "TRADE"
  | "HEARTBEAT"
  | "LOG";

export type LogEntry = {
  id: number;
  instanceId: string;
  algoId: string;
  eventType: LogEventType;
  message: string;
  timestamp: number;
};

type AlgoLogEvent = {
  instance_id: string;
  algo_id: string;
  event_type: string;
  message: string;
  timestamp: number;
};

const MAX_LOGS_PER_INSTANCE = 500;

export const useAlgoLogs = () => {
  const [logsByInstance, setLogsByInstance] = useState<
    Record<string, LogEntry[]>
  >({});
  const nextId = useRef(1);

  const clearLogs = useCallback((instanceId: string) => {
    setLogsByInstance((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<AlgoLogEvent>("algo-log", (event) => {
      const e = event.payload;

      const entry: LogEntry = {
        id: nextId.current++,
        instanceId: e.instance_id,
        algoId: e.algo_id,
        eventType: (e.event_type || "LOG") as LogEventType,
        message: e.message,
        timestamp: e.timestamp || Date.now(),
      };

      setLogsByInstance((prev) => {
        const existing = prev[e.instance_id] ?? [];
        let logs = [...existing, entry];
        if (logs.length > MAX_LOGS_PER_INSTANCE) {
          logs = logs.slice(logs.length - MAX_LOGS_PER_INSTANCE);
        }
        return { ...prev, [e.instance_id]: logs };
      });
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return { logsByInstance, clearLogs };
};

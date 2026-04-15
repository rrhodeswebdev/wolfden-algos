import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export type AlgoHealth = {
  instanceId: string;
  wsConnected: boolean;
  zmqActive: boolean;
  processAlive: boolean;
  barsPerSec: number;
  lastHeartbeatSecsAgo: number;
};

type AlgoHealthEvent = {
  instance_id: string;
  ws_connected: boolean;
  zmq_active: boolean;
  process_alive: boolean;
  bars_per_sec: number;
  last_heartbeat_secs_ago: number;
};

export const useAlgoHealth = () => {
  const [healthByInstance, setHealthByInstance] = useState<
    Record<string, AlgoHealth>
  >({});

  useEffect(() => {
    const unlisten = listen<AlgoHealthEvent>("algo-health", (event) => {
      const e = event.payload;
      setHealthByInstance((prev) => ({
        ...prev,
        [e.instance_id]: {
          instanceId: e.instance_id,
          wsConnected: e.ws_connected,
          zmqActive: e.zmq_active,
          processAlive: e.process_alive,
          barsPerSec: e.bars_per_sec,
          lastHeartbeatSecsAgo: e.last_heartbeat_secs_ago,
        },
      }));
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return { healthByInstance };
};

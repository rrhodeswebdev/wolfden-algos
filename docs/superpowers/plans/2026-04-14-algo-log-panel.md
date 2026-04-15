# Algo Log Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time log panel with health indicators to AlgosView so users can verify algos and NinjaTrader connections are working.

**Architecture:** Backend emits `algo-log` events from existing message processing points (ZMQ hub, WebSocket server, process manager stdout). Frontend consumes via two new hooks (`useAlgoLogs`, `useAlgoHealth`) and renders a collapsible `LogPanel` component below the existing instance list. AlgosView auto-selects the first running algo on mount.

**Tech Stack:** Rust/Tauri (backend events), React/TypeScript (frontend), Python (algo `log()` function)

---

### Task 1: Add `log()` function to Python wolf_types

**Files:**
- Modify: `algo_runtime/wolf_types.py:144` (append after last function)

- [ ] **Step 1: Add the `log()` function**

Append to the end of `algo_runtime/wolf_types.py`:

```python


def log(message: str) -> None:
    """Print a structured log message visible in the Wolf Den log panel.

    Usage in algos: log("entry triggered, z-score: -2.14")
    """
    print(f"[SIGNAL] {message}", flush=True)
```

- [ ] **Step 2: Verify the file is valid Python**

Run: `python3 -c "import ast; ast.parse(open('algo_runtime/wolf_types.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add algo_runtime/wolf_types.py
git commit -m "feat: add log() function to wolf_types for algo log panel"
```

---

### Task 2: Capture stdout from algo processes (Rust backend)

**Files:**
- Modify: `src-tauri/src/process_manager.rs:12-16` (ProcessHandles struct)
- Modify: `src-tauri/src/process_manager.rs:113-114` (Stdio piping)
- Modify: `src-tauri/src/process_manager.rs:118-142` (stdout capture + return)
- Modify: `src-tauri/src/commands.rs:159-190` (add stdout monitoring thread)

- [ ] **Step 1: Add stdout to ProcessHandles**

In `src-tauri/src/process_manager.rs`, change the `ProcessHandles` struct from:

```rust
pub struct ProcessHandles {
    pub stderr: std::process::ChildStderr,
    pub instance_id: String,
    pub algo_id: String,
}
```

to:

```rust
pub struct ProcessHandles {
    pub stderr: std::process::ChildStderr,
    pub stdout: std::process::ChildStdout,
    pub instance_id: String,
    pub algo_id: String,
}
```

- [ ] **Step 2: Pipe stdout instead of discarding it**

In `src-tauri/src/process_manager.rs`, change line 114 from:

```rust
            .stdout(Stdio::null())
```

to:

```rust
            .stdout(Stdio::piped())
```

- [ ] **Step 3: Capture stdout in start_instance**

In `src-tauri/src/process_manager.rs`, after the stderr capture (line 119-120), add stdout capture. Change from:

```rust
        let stderr = child.stderr.take()
            .ok_or("Failed to capture stderr from algo process")?;
```

to:

```rust
        let stderr = child.stderr.take()
            .ok_or("Failed to capture stderr from algo process")?;
        let stdout = child.stdout.take()
            .ok_or("Failed to capture stdout from algo process")?;
```

- [ ] **Step 4: Include stdout in ProcessHandles return**

In `src-tauri/src/process_manager.rs`, change from:

```rust
        Ok((pid, ProcessHandles {
            stderr,
            instance_id: instance_id.to_string(),
            algo_id: algo_id_str,
        }))
```

to:

```rust
        Ok((pid, ProcessHandles {
            stderr,
            stdout,
            instance_id: instance_id.to_string(),
            algo_id: algo_id_str,
        }))
```

- [ ] **Step 5: Add stdout monitoring thread in commands.rs**

In `src-tauri/src/commands.rs`, after the existing stderr monitoring thread (after line 190), add a stdout monitoring thread. The instance_id and algo_id need to be cloned before the stderr thread takes ownership. Change the section starting at line 159 from:

```rust
    // Monitor stderr in a background thread
    let app = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(handles.stderr);
        let mut last_line = String::new();
        for line in reader.lines() {
            match line {
                Ok(text) if !text.is_empty() => {
                    log::info!("Algo stderr [{}]: {}", handles.instance_id, text);
                    last_line = text;
                }
                Err(_) => break,
                _ => {}
            }
        }
        if !last_line.is_empty() {
            let _ = app.emit("algo-error", serde_json::json!({
                "instance_id": handles.instance_id,
                "algo_id": handles.algo_id,
                "severity": "critical",
                "category": "infrastructure",
                "message": format!("Process exited: {}", last_line),
                "handler": "",
                "traceback": "",
                "timestamp": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64,
            }));
        }
    });
```

to:

```rust
    // Clone IDs before moving into threads
    let stderr_instance_id = handles.instance_id.clone();
    let stderr_algo_id = handles.algo_id.clone();
    let stdout_instance_id = handles.instance_id.clone();
    let stdout_algo_id = handles.algo_id.clone();

    // Monitor stderr in a background thread
    let app = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(handles.stderr);
        let mut last_line = String::new();
        for line in reader.lines() {
            match line {
                Ok(text) if !text.is_empty() => {
                    log::info!("Algo stderr [{}]: {}", stderr_instance_id, text);
                    last_line = text;
                }
                Err(_) => break,
                _ => {}
            }
        }
        if !last_line.is_empty() {
            let _ = app.emit("algo-error", serde_json::json!({
                "instance_id": stderr_instance_id,
                "algo_id": stderr_algo_id,
                "severity": "critical",
                "category": "infrastructure",
                "message": format!("Process exited: {}", last_line),
                "handler": "",
                "traceback": "",
                "timestamp": std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64,
            }));
        }
    });

    // Monitor stdout in a background thread — emit algo-log events
    let app_stdout = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(handles.stdout);
        for line in reader.lines() {
            match line {
                Ok(text) if !text.is_empty() => {
                    let (event_type, message) = if let Some(msg) = text.strip_prefix("[SIGNAL] ") {
                        ("SIGNAL", msg.to_string())
                    } else if let Some(msg) = text.strip_prefix("[LOG] ") {
                        ("LOG", msg.to_string())
                    } else if text.starts_with("[runner]") || text.starts_with("[risk]") || text.starts_with("[shadow]") {
                        ("LOG", text.clone())
                    } else {
                        ("LOG", text.clone())
                    };
                    let _ = app_stdout.emit("algo-log", serde_json::json!({
                        "instance_id": stdout_instance_id,
                        "algo_id": stdout_algo_id,
                        "event_type": event_type,
                        "message": message,
                        "timestamp": std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64,
                    }));
                }
                Err(_) => break,
                _ => {}
            }
        }
    });
```

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/process_manager.rs src-tauri/src/commands.rs
git commit -m "feat: capture algo stdout and emit algo-log events"
```

---

### Task 3: Emit algo-log events from ZMQ hub (ORDER, FILL, HEARTBEAT)

**Files:**
- Modify: `src-tauri/src/zmq_hub.rs:262-326` (order routing — emit ORDER log)
- Modify: `src-tauri/src/zmq_hub.rs:386-436` (shadow_fill �� emit FILL log)
- Modify: `src-tauri/src/zmq_hub.rs:469-473` (heartbeat — emit HEARTBEAT log)

- [ ] **Step 1: Emit ORDER log when routing an order to NinjaTrader**

In `src-tauri/src/zmq_hub.rs`, inside the `"order"` match arm, after the line:

```rust
                log::info!("Routed order {} from instance {} to NinjaTrader", order_id, instance_id);
```

Add:

```rust
                // Emit algo-log for the order
                let _ = app_handle.emit("algo-log", serde_json::json!({
                    "instance_id": instance_id,
                    "algo_id": algo_id,
                    "event_type": "ORDER",
                    "message": format!("{} {} {} @ {} → NinjaTrader", side, qty, symbol, order_type),
                    "timestamp": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64,
                }));
```

- [ ] **Step 2: Emit FILL log for shadow fills**

In `src-tauri/src/zmq_hub.rs`, inside the `"shadow_fill"` match arm, after the line:

```rust
            log::info!("Shadow fill: instance={} algo={} order={}", instance_id, algo_id, order_id);
```

Add:

```rust
            // Emit algo-log for the fill
            let _ = app_handle.emit("algo-log", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "event_type": "FILL",
                "message": format!("{} {} {} @ {:.2} filled", side, qty, symbol, price),
                "timestamp": timestamp.unwrap_or_else(|| {
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as i64
                }),
            }));
```

- [ ] **Step 3: Emit HEARTBEAT log**

In `src-tauri/src/zmq_hub.rs`, inside the `"heartbeat"` match arm, change from:

```rust
        "heartbeat" => {
            // Algo heartbeat — log for now
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("?");
            let status = val.get("status").and_then(|v| v.as_str()).unwrap_or("?");
            log::debug!("Algo heartbeat: instance={} status={}", instance_id, status);
        }
```

to:

```rust
        "heartbeat" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("?").to_string();
            let algo_id = val.get("algo_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let status = val.get("status").and_then(|v| v.as_str()).unwrap_or("?");
            let timestamp = val.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
            log::debug!("Algo heartbeat: instance={} status={}", instance_id, status);

            let _ = app_handle.emit("algo-log", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "event_type": "HEARTBEAT",
                "message": format!("Algo heartbeat: {}", status),
                "timestamp": timestamp,
            }));
        }
```

- [ ] **Step 4: Emit ERROR log alongside existing algo-error**

In `src-tauri/src/zmq_hub.rs`, inside the `"algo_error"` match arm, after the existing `app_handle.emit("algo-error", ...)` block (after line 496), add:

```rust
            // Also emit as algo-log for the log panel
            let _ = app_handle.emit("algo-log", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "event_type": "ERROR",
                "message": message,
                "timestamp": timestamp,
            }));
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/zmq_hub.rs
git commit -m "feat: emit algo-log events from ZMQ hub for orders, fills, heartbeats, errors"
```

---

### Task 4: Emit algo-log events from WebSocket server (FILL from NinjaTrader, HEARTBEAT)

**Files:**
- Modify: `src-tauri/src/websocket_server.rs:256-286` (OrderUpdate handling — emit FILL log for live fills)

- [ ] **Step 1: Emit FILL log for live order fills from NinjaTrader**

In `src-tauri/src/websocket_server.rs`, inside the `NtInbound::OrderUpdate` block, after the `app_handle.emit("nt-order-update", ...)` call (after line 284), add:

```rust
                                        // Emit algo-log for live fills
                                        if state == "filled" || state == "Filled" {
                                            let _ = app_handle.emit("algo-log", serde_json::json!({
                                                "instance_id": instance_id,
                                                "algo_id": "",
                                                "event_type": "FILL",
                                                "message": format!("{} {} @ {:.2} filled",
                                                    side.as_deref().unwrap_or("?"),
                                                    filled_qty.unwrap_or(0),
                                                    fill_price.unwrap_or(0.0)),
                                                "timestamp": timestamp.unwrap_or_else(|| {
                                                    std::time::SystemTime::now()
                                                        .duration_since(std::time::UNIX_EPOCH)
                                                        .unwrap_or_default()
                                                        .as_millis() as i64
                                                }),
                                            }));
                                        }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/websocket_server.rs
git commit -m "feat: emit algo-log FILL events from WebSocket server for live fills"
```

---

### Task 5: Create useAlgoLogs hook

**Files:**
- Create: `src/hooks/useAlgoLogs.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useAlgoLogs.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/hypawolf/code/wolf-den && npx tsc --noEmit src/hooks/useAlgoLogs.ts 2>&1 | tail -5`
Expected: No errors (or only unrelated errors)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAlgoLogs.ts
git commit -m "feat: add useAlgoLogs hook for real-time log event consumption"
```

---

### Task 6: Create useAlgoHealth hook

**Files:**
- Create: `src/hooks/useAlgoHealth.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useAlgoHealth.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAlgoHealth.ts
git commit -m "feat: add useAlgoHealth hook for connection health monitoring"
```

---

### Task 7: Create LogPanel component

**Files:**
- Create: `src/components/LogPanel.tsx`

- [ ] **Step 1: Create the LogPanel component**

Create `src/components/LogPanel.tsx`:

```typescript
import { useState, useEffect, useRef } from "react";
import type { LogEntry, LogEventType } from "../hooks/useAlgoLogs";
import type { AlgoHealth } from "../hooks/useAlgoHealth";

const EVENT_TYPE_COLORS: Record<LogEventType, string> = {
  BAR: "#60a5fa",
  ORDER: "#fbbf24",
  FILL: "#4ade80",
  SIGNAL: "#c084fc",
  ERROR: "#f87171",
  POSITION: "#60a5fa",
  TRADE: "#4ade80",
  HEARTBEAT: "#334155",
  LOG: "#888888",
};

const DEFAULT_FILTERS: Record<LogEventType, boolean> = {
  BAR: true,
  ORDER: true,
  FILL: true,
  SIGNAL: true,
  ERROR: true,
  POSITION: true,
  TRADE: true,
  HEARTBEAT: false,
  LOG: true,
};

const formatTimestamp = (ts: number) => {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
};

const HealthDot = ({ label, ok }: { label: string; ok: boolean }) => (
  <div className="flex items-center gap-1">
    <div
      className="w-1.5 h-1.5 rounded-full"
      style={{ background: ok ? "#4ade80" : "#f87171" }}
    />
    <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
  </div>
);

type LogPanelProps = {
  logs: LogEntry[];
  health: AlgoHealth | undefined;
  onClear: () => void;
};

export const LogPanel = ({ logs, health, onClear }: LogPanelProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [filters, setFilters] = useState<Record<LogEventType, boolean>>(DEFAULT_FILTERS);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((l) => filters[l.eventType] !== false);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (autoScroll && !atBottom) setAutoScroll(false);
    if (!autoScroll && atBottom) setAutoScroll(true);
  };

  const toggleFilter = (type: LogEventType) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="border-t border-[var(--border)] flex flex-col">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-secondary)]">
            {collapsed ? "▶" : "▼"}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Logs
          </span>
          <span className="text-[10px] text-[var(--text-secondary)]">
            {filteredLogs.length}
          </span>
        </div>
        {health && (
          <div className="flex items-center gap-3">
            <HealthDot label="WS" ok={health.wsConnected} />
            <HealthDot label="ZMQ" ok={health.zmqActive} />
            <HealthDot label="Process" ok={health.processAlive} />
            {health.barsPerSec > 0 && (
              <span className="text-[10px] text-[var(--text-secondary)]">
                {health.barsPerSec.toFixed(0)} bars/s
              </span>
            )}
            {health.lastHeartbeatSecsAgo >= 0 && (
              <span className="text-[10px] text-[var(--text-secondary)]">
                HB {health.lastHeartbeatSecsAgo}s ago
              </span>
            )}
          </div>
        )}
      </button>

      {!collapsed && (
        <>
          {/* Log Stream */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed max-h-64 min-h-32 bg-[var(--bg-primary)]"
          >
            {filteredLogs.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[var(--text-secondary)]">
                No log events yet
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <div key={entry.id} className="flex gap-2 px-3 py-0.5 hover:bg-[var(--bg-secondary)]/50">
                  <span className="text-[var(--text-secondary)] shrink-0">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span
                    className="shrink-0 font-medium uppercase text-[10px] min-w-[60px]"
                    style={{ color: EVENT_TYPE_COLORS[entry.eventType] }}
                  >
                    {entry.eventType}
                  </span>
                  <span className="text-[var(--text-secondary)] truncate">
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
            {(Object.keys(EVENT_TYPE_COLORS) as LogEventType[]).map((type) => (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                className="text-[10px] px-1.5 py-0.5 rounded transition-opacity"
                style={{
                  color: EVENT_TYPE_COLORS[type],
                  background: `${EVENT_TYPE_COLORS[type]}15`,
                  opacity: filters[type] !== false ? 1 : 0.3,
                }}
              >
                {type}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={onClear}
              className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Clear
            </button>
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`text-[10px] ${autoScroll ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
            >
              ↓ Auto
            </button>
          </div>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/LogPanel.tsx
git commit -m "feat: add LogPanel component with event stream, filters, and health indicators"
```

---

### Task 8: Wire hooks into App.tsx and pass to AlgosView

**Files:**
- Modify: `src/App.tsx:15` (add import)
- Modify: `src/App.tsx:67` (add hook usage)
- Modify: `src/App.tsx:420-432` (pass new props to AlgosView)

- [ ] **Step 1: Add imports**

In `src/App.tsx`, after line 15:

```typescript
import { useAlgoErrors } from "./hooks/useAlgoErrors";
```

Add:

```typescript
import { useAlgoLogs } from "./hooks/useAlgoLogs";
import { useAlgoHealth } from "./hooks/useAlgoHealth";
```

- [ ] **Step 2: Add hook calls**

In `src/App.tsx`, after line 67:

```typescript
  const { errorsByInstance, clearErrors } = useAlgoErrors(handleAutoStop);
```

Add:

```typescript
  const { logsByInstance, clearLogs } = useAlgoLogs();
  const { healthByInstance } = useAlgoHealth();
```

- [ ] **Step 3: Pass new props to AlgosView**

In `src/App.tsx`, change the AlgosView rendering from:

```typescript
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
```

to:

```typescript
      {activeView === "algos" && (
        <AlgosView
          algos={algos}
          dataSources={dataSources}
          activeRuns={activeRuns}
          algoStats={simulation.algoStats}
          errorsByInstance={errorsByInstance}
          logsByInstance={logsByInstance}
          healthByInstance={healthByInstance}
          onStartAlgo={handleStartAlgo}
          onStopAlgo={handleStopAlgo}
          onClearErrors={clearErrors}
          onClearLogs={clearLogs}
          onOpenAiTerminal={handleOpenAiTerminal}
          aiTerminalAlgoIds={aiTerminalAlgoIds}
        />
      )}
```

- [ ] **Step 4: Also clear logs when stopping an algo**

In `src/App.tsx`, in the `handleStopAlgo` function (find the line that calls `clearErrors(instanceId)`), add `clearLogs(instanceId)` right after it. If `clearErrors` is called inside `handleStopAlgo`, add `clearLogs` there too. The function should look like:

Find the `handleStopAlgo` callback and after `clearErrors(instanceId)` add `clearLogs(instanceId)`. This requires reading the exact function — look for `setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId))` and ensure `clearLogs(instanceId)` is called nearby.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire useAlgoLogs and useAlgoHealth hooks into App and pass to AlgosView"
```

---

### Task 9: Integrate LogPanel into AlgosView with auto-selection

**Files:**
- Modify: `src/views/AlgosView.tsx`

This is the largest frontend change. We need to:
1. Add new props for logs/health
2. Add auto-selection of first running algo
3. Track selected instance for the log panel
4. Render LogPanel below the instances list

- [ ] **Step 1: Update imports and props type**

In `src/views/AlgosView.tsx`, change the imports from:

```typescript
import { useState } from "react";
import { type AlgoStats, type DataSource } from "../hooks/useTradingSimulation";
import { type InstanceErrors, type AlgoError } from "../hooks/useAlgoErrors";
```

to:

```typescript
import { useState, useEffect } from "react";
import { type AlgoStats, type DataSource } from "../hooks/useTradingSimulation";
import { type InstanceErrors, type AlgoError } from "../hooks/useAlgoErrors";
import { type LogEntry } from "../hooks/useAlgoLogs";
import { type AlgoHealth } from "../hooks/useAlgoHealth";
import { LogPanel } from "../components/LogPanel";
```

- [ ] **Step 2: Update AlgosViewProps type**

Change the `AlgosViewProps` type from:

```typescript
type AlgosViewProps = {
  algos: Algo[];
  dataSources: DataSource[];
  activeRuns: AlgoRun[];
  algoStats: Record<string, AlgoStats>;
  errorsByInstance: Record<string, InstanceErrors>;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
  onStopAlgo: (instanceId: string) => void;
  onClearErrors: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
};
```

to:

```typescript
type AlgosViewProps = {
  algos: Algo[];
  dataSources: DataSource[];
  activeRuns: AlgoRun[];
  algoStats: Record<string, AlgoStats>;
  errorsByInstance: Record<string, InstanceErrors>;
  logsByInstance: Record<string, LogEntry[]>;
  healthByInstance: Record<string, AlgoHealth>;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => void;
  onStopAlgo: (instanceId: string) => void;
  onClearErrors: (instanceId: string) => void;
  onClearLogs: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
};
```

- [ ] **Step 3: Update the AlgosView component signature and add auto-selection**

Change the AlgosView component from:

```typescript
export const AlgosView = ({
  algos,
  dataSources,
  activeRuns,
  algoStats,
  errorsByInstance,
  onStartAlgo,
  onStopAlgo,
  onClearErrors: _onClearErrors,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
}: AlgosViewProps) => {
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
```

to:

```typescript
export const AlgosView = ({
  algos,
  dataSources,
  activeRuns,
  algoStats,
  errorsByInstance,
  logsByInstance,
  healthByInstance,
  onStartAlgo,
  onStopAlgo,
  onClearErrors: _onClearErrors,
  onClearLogs,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
}: AlgosViewProps) => {
  const [selectedChartId, setSelectedChartId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [hasAutoSelected, setHasAutoSelected] = useState(false);

  // Auto-select first running algo on mount
  useEffect(() => {
    if (hasAutoSelected) return;
    const firstRunning = activeRuns.find((r) => r.status === "running");
    if (firstRunning) {
      setSelectedChartId(firstRunning.data_source_id);
      setSelectedInstanceId(firstRunning.instance_id);
      setHasAutoSelected(true);
    }
  }, [activeRuns, hasAutoSelected]);
```

- [ ] **Step 4: Make instance rows clickable to select for logs**

Change the `RunningInstanceRow` component to accept an `isSelectedForLogs` prop and an `onSelectForLogs` callback. In the `RunningInstanceRow` definition (around line 281), change from:

```typescript
const RunningInstanceRow = ({
  algo,
  run,
  stats,
  instanceErrors,
  onStopAlgo,
  onOpenAiTerminal,
  hasActiveTerminal,
}: {
  algo: Algo;
  run: AlgoRun;
  stats: AlgoStats | undefined;
  instanceErrors: InstanceErrors | undefined;
  onStopAlgo: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  hasActiveTerminal: boolean;
}) => {
  const [showErrors, setShowErrors] = useState(false);
  const hasErrors = instanceErrors && (instanceErrors.errorCount > 0 || instanceErrors.warningCount > 0);

  return (
    <div>
      <div className="flex items-center justify-between px-6 py-4">
```

to:

```typescript
const RunningInstanceRow = ({
  algo,
  run,
  stats,
  instanceErrors,
  isSelectedForLogs,
  onSelectForLogs,
  onStopAlgo,
  onOpenAiTerminal,
  hasActiveTerminal,
}: {
  algo: Algo;
  run: AlgoRun;
  stats: AlgoStats | undefined;
  instanceErrors: InstanceErrors | undefined;
  isSelectedForLogs: boolean;
  onSelectForLogs: () => void;
  onStopAlgo: (instanceId: string) => void;
  onOpenAiTerminal?: (algoId: number) => void;
  hasActiveTerminal: boolean;
}) => {
  const [showErrors, setShowErrors] = useState(false);
  const hasErrors = instanceErrors && (instanceErrors.errorCount > 0 || instanceErrors.warningCount > 0);

  return (
    <div className={isSelectedForLogs ? "bg-[var(--accent-blue)]/5" : ""}>
      <div className="flex items-center justify-between px-6 py-4 cursor-pointer" onClick={onSelectForLogs}>
```

- [ ] **Step 5: Pass the new props to RunningInstanceRow and add LogPanel**

In the AlgosView component's render, where `RunningInstanceRow` is mapped (around line 464-480), change from:

```typescript
                  chartRuns.map((run) => {
                    const algo = algos.find((a) => a.id === run.algo_id);
                    if (!algo) return null;
                    return (
                      <RunningInstanceRow
                        key={run.instance_id}
                        algo={algo}
                        run={run}
                        stats={algoStats[run.instance_id]}
                        instanceErrors={errorsByInstance[run.instance_id]}
                        onStopAlgo={onStopAlgo}
                        onOpenAiTerminal={onOpenAiTerminal}
                        hasActiveTerminal={aiTerminalAlgoIds?.has(algo.id) ?? false}
                      />
                    );
                  })
```

to:

```typescript
                  chartRuns.map((run) => {
                    const algo = algos.find((a) => a.id === run.algo_id);
                    if (!algo) return null;
                    return (
                      <RunningInstanceRow
                        key={run.instance_id}
                        algo={algo}
                        run={run}
                        stats={algoStats[run.instance_id]}
                        instanceErrors={errorsByInstance[run.instance_id]}
                        isSelectedForLogs={selectedInstanceId === run.instance_id}
                        onSelectForLogs={() => setSelectedInstanceId(run.instance_id)}
                        onStopAlgo={onStopAlgo}
                        onOpenAiTerminal={onOpenAiTerminal}
                        hasActiveTerminal={aiTerminalAlgoIds?.has(algo.id) ?? false}
                      />
                    );
                  })
```

- [ ] **Step 6: Add LogPanel rendering**

After the `AddAlgoPanel` component (after line 491), but still inside the wrapping `<div className="flex-1 bg-[var(--bg-panel)] ...">`, add the LogPanel. Change from:

```typescript
              {/* Add algo to this chart */}
              <AddAlgoPanel
                  algos={algos}
                  chartRuns={chartRuns}
                  ds={selectedDs}
                  onStartAlgo={onStartAlgo}
                  onOpenAiTerminal={onOpenAiTerminal}
                  aiTerminalAlgoIds={aiTerminalAlgoIds}
                />
            </div>
```

to:

```typescript
              {/* Add algo to this chart */}
              <AddAlgoPanel
                  algos={algos}
                  chartRuns={chartRuns}
                  ds={selectedDs}
                  onStartAlgo={onStartAlgo}
                  onOpenAiTerminal={onOpenAiTerminal}
                  aiTerminalAlgoIds={aiTerminalAlgoIds}
                />

              {/* Log Panel */}
              {selectedInstanceId && logsByInstance[selectedInstanceId] && (
                <LogPanel
                  logs={logsByInstance[selectedInstanceId]}
                  health={healthByInstance[selectedInstanceId]}
                  onClear={() => onClearLogs(selectedInstanceId)}
                />
              )}
            </div>
```

- [ ] **Step 7: Verify the frontend compiles**

Run: `cd /Users/hypawolf/code/wolf-den && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 8: Commit**

```bash
git add src/views/AlgosView.tsx
git commit -m "feat: integrate LogPanel into AlgosView with auto-selection of first running algo"
```

---

### Task 10: Emit algo-health events from Rust backend

**Files:**
- Modify: `src-tauri/src/lib.rs` (add a periodic health emitter task)

This task adds a periodic task in `lib.rs` that checks connection state and emits `algo-health` events every 2 seconds for each running instance.

- [ ] **Step 1: Read lib.rs to find the right insertion point**

Read `src-tauri/src/lib.rs` to understand where async tasks are spawned. The health emitter needs access to `app_handle`, `ProcState`, `WsState`, and `DbState`.

- [ ] **Step 2: Add the health emitter task**

In `src-tauri/src/lib.rs`, after the existing async task spawns (around the area where ZMQ publisher and order receiver are spawned), add a new task. This requires finding the exact insertion point by reading the file. The task should:

```rust
// Health emitter — periodic algo-health events for running instances
{
    let app_for_health = app_handle.clone();
    let db_for_health = db_state.clone();
    let registry_for_health = ws_state_registry.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            interval.tick().await;
            // Get running instances from DB
            let instances = {
                let conn = match db_for_health.0.lock() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                match crate::db::get_algo_instances(&conn, None) {
                    Ok(list) => list.into_iter().filter(|i| i.status == "running").collect::<Vec<_>>(),
                    Err(_) => continue,
                }
            };

            let reg = registry_for_health.read().await;
            for inst in &instances {
                let ws_connected = reg.get_sender(&inst.data_source_id).is_some();
                let _ = app_for_health.emit("algo-health", serde_json::json!({
                    "instance_id": inst.id,
                    "ws_connected": ws_connected,
                    "zmq_active": true,
                    "process_alive": inst.pid.is_some(),
                    "bars_per_sec": 0,
                    "last_heartbeat_secs_ago": 0,
                }));
            }
        }
    });
}
```

Note: `zmq_active`, `bars_per_sec`, and `last_heartbeat_secs_ago` are simplified for the initial implementation — they report basic values. These can be enhanced later with actual ZMQ activity tracking if needed.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add periodic algo-health event emitter for connection monitoring"
```

---

### Task 11: Full integration verification

- [ ] **Step 1: Verify the full Rust backend compiles**

Run: `cd src-tauri && cargo build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 2: Verify the full frontend compiles**

Run: `cd /Users/hypawolf/code/wolf-den && npx tsc --noEmit 2>&1 | tail -10`
Expected: No type errors

- [ ] **Step 3: Verify the app starts**

Run: `cd /Users/hypawolf/code/wolf-den && npx tauri dev 2>&1 | head -20`
Expected: App starts without crashes

- [ ] **Step 4: Manual verification checklist**

1. Open the Algos view
2. Connect a NinjaTrader chart
3. Start an algo (shadow mode is fine)
4. Verify the log panel appears below the instances
5. Verify log entries appear (at minimum: HEARTBEAT, LOG from runner startup)
6. Verify health indicators show in the log header
7. Verify filter toggles work
8. Verify auto-scroll works
9. Verify clicking a different instance switches the log view

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: integration fixes for algo log panel"
```

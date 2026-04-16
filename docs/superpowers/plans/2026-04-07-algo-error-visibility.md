# Algo Error Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface all algo errors (runtime exceptions, risk violations, infrastructure failures, logic warnings) inline on algo instance cards with expandable detail views and auto-stop safety.

**Architecture:** Python runner wraps handler calls in try/except and sends structured `algo_error` messages via ZMQ PUSH. Rust backend captures these (plus stderr from crashed processes) and emits `algo-error` Tauri events. React frontend stores errors in-memory per instance, displays badge counts on instance cards, and provides expandable error detail with stack traces. Auto-stop triggers after 10 runtime exceptions in 5 seconds.

**Tech Stack:** Python (runner.py), Rust/Tauri (process_manager, zmq_hub, commands), React/TypeScript (AlgosView, useTradingSimulation)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `algo_runtime/runner.py` | Modify | Wrap handler calls in try/except, send `algo_error` ZMQ messages |
| `src-tauri/src/zmq_hub.rs` | Modify | Route `algo_error` messages as Tauri events |
| `src-tauri/src/process_manager.rs` | Modify | Capture stderr from child processes, emit errors on process death |
| `src-tauri/src/lib.rs` | Modify | Wire stderr monitoring task |
| `src/hooks/useAlgoErrors.ts` | Create | React hook for error state management, auto-stop logic |
| `src/views/AlgosView.tsx` | Modify | Add error badges and expandable error list to instance cards |
| `src/App.tsx` | Modify | Wire useAlgoErrors hook and pass errors to AlgosView |

---

### Task 1: Python Runner — Wrap Handlers in Try/Except and Send Error Messages

**Files:**
- Modify: `algo_runtime/runner.py:660-749` (live phase loop)

- [ ] **Step 1: Add error message sender helper**

Add this function after `serialize_orders` (after line 316):

```python
def send_error(push_socket, instance_id: str, algo_id: str, severity: str, category: str, message: str, handler: str = "", traceback_str: str = ""):
    """Send a structured error message to the Rust backend via ZMQ PUSH."""
    push_socket.send(msgpack.packb({
        "type": "algo_error",
        "instance_id": instance_id,
        "algo_id": algo_id,
        "severity": severity,       # "critical", "error", "warning"
        "category": category,       # "runtime", "risk", "infrastructure", "logic"
        "message": message,
        "handler": handler,          # "on_tick", "on_bar", "on_fill", "on_order_accepted", ""
        "traceback": traceback_str,
        "timestamp": int(time.time() * 1000),
    }, use_bin_type=True))
```

- [ ] **Step 2: Add `import traceback` to the imports**

Add at top of file (line 27, after existing imports):

```python
import traceback
```

- [ ] **Step 3: Wrap live-phase handler calls in try/except**

Replace the live phase try/while block (lines 661-749) with handler-level error catching. The key change is wrapping each handler call individually:

```python
    # --- Live Phase ---
    try:
        while True:
            topic = sub.recv_string()
            data = sub.recv()
            msg_type, msg = deserialize_message(data)

            # Skip history messages in live phase
            if msg_type == "history":
                continue

            result: AlgoResult | None = None
            ctx = pos_tracker.build_context(symbol, last_price)
            handler_name = ""

            try:
                if msg_type == "tick":
                    tick = make_tick(msg)
                    last_price = tick.price

                    # In shadow mode, check if any working orders are triggered by this tick
                    if is_shadow:
                        triggered = shadow_sim.check_working(tick.price)
                        if triggered:
                            state = _process_shadow_fills(triggered, state)

                        # Emit throttled position update for live P&L tracking
                        now = time.monotonic()
                        if pos_tracker.position != 0 and (now - last_shadow_pos_emit) >= 0.25:
                            last_shadow_pos_emit = now
                            ctx_snap = pos_tracker.build_context(symbol, last_price)
                            push.send(msgpack.packb({
                                "type": "shadow_position",
                                "instance_id": args.instance_id,
                                "algo_id": args.algo_id,
                                "symbol": symbol,
                                "position": pos_tracker.position,
                                "entry_price": pos_tracker.entry_price,
                                "unrealized_pnl": ctx_snap.unrealized_pnl,
                                "timestamp": int(time.time() * 1000),
                            }, use_bin_type=True))

                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_tick"
                    result = handlers["on_tick"](state, tick, ctx)
                elif msg_type == "bar":
                    bar = make_bar(msg)

                    # Timestamp dedup: skip bars already processed in backtest
                    if bar.timestamp <= last_history_ts:
                        continue

                    last_price = bar.c
                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_bar"
                    result = handlers["on_bar"](state, bar, ctx)
                elif msg_type == "fill":
                    if is_shadow:
                        # In shadow mode, ignore real fills from NinjaTrader
                        continue
                    fill = make_fill(msg)
                    risk.on_fill(fill)
                    pos_tracker.on_fill(fill)
                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_fill"
                    result = handlers["on_fill"](state, fill, ctx)
                elif msg_type == "order_accepted":
                    if is_shadow:
                        # In shadow mode, order_accepted is handled inline
                        continue
                    oa = OrderAccepted(
                        order_id=msg.get("order_id", ""),
                        timestamp=msg.get("timestamp", 0),
                    )
                    ctx = pos_tracker.build_context(symbol, last_price)
                    handler_name = "on_order_accepted"
                    result = handlers["on_order_accepted"](state, oa, ctx)
                else:
                    continue
            except Exception as exc:
                tb = traceback.format_exc()
                print(f"[error] Exception in {handler_name}: {exc}")
                sys.stdout.flush()
                send_error(push, args.instance_id, args.algo_id,
                           severity="error", category="runtime",
                           message=str(exc), handler=handler_name,
                           traceback_str=tb)
                continue

            if result is not None:
                state = result.state
                if result.orders:
                    if is_shadow:
                        state = _submit_shadow_orders(result.orders, state)
                    else:
                        filled = tuple(_fill_symbol(o, symbol) for o in result.orders)
                        # ModifyOrder/CancelOrder skip risk checks (they don't change position)
                        approved = tuple(
                            o for o in filled
                            if isinstance(o, (ModifyOrder, CancelOrder)) or risk.check_order(o)
                        )
                        if approved:
                            for packed in serialize_orders(args.instance_id, args.algo_id, approved):
                                push.send(packed)
    except KeyboardInterrupt:
        print(f"[runner] Instance {args.instance_id} shutting down")
    finally:
        push.send(msgpack.packb({
            "type": "heartbeat",
            "instance_id": args.instance_id,
            "algo_id": args.algo_id,
            "status": "stopped",
            "timestamp": int(time.time() * 1000),
        }, use_bin_type=True))
        sub.close()
        push.close()
        zmq_ctx.term()
```

- [ ] **Step 4: Add risk violation error reporting to RiskManager.check_order**

Replace the `check_order` method (lines 46-62) to send errors via a callback:

```python
    def check_order(self, order, error_callback=None) -> bool:
        """Returns False if order would violate risk limits."""
        if self.halted:
            return False
        if self.daily_trades >= self.max_daily_trades:
            self.halted = True
            msg = f"Max daily trades ({self.max_daily_trades}) reached — halting"
            print(f"[risk] {msg}")
            if error_callback:
                error_callback(severity="warning", category="risk", message=msg)
            return False
        if self.daily_pnl <= -abs(self.max_daily_loss):
            self.halted = True
            msg = f"Max daily loss (${self.max_daily_loss}) reached — halting"
            print(f"[risk] {msg}")
            if error_callback:
                error_callback(severity="warning", category="risk", message=msg)
            return False
        new_pos = self.position + (order.qty if order.side == "BUY" else -order.qty)
        if abs(new_pos) > self.max_position:
            msg = f"Order would exceed max position ({self.max_position}) — rejected"
            print(f"[risk] {msg}")
            if error_callback:
                error_callback(severity="warning", category="risk", message=msg)
            return False
        return True
```

Then in the live phase, create the callback and pass it to `risk.check_order`:

```python
def _risk_error(severity, category, message):
    send_error(push, args.instance_id, args.algo_id,
               severity=severity, category=category, message=message)
```

And update the risk check call in the live phase (the `approved = tuple(...)` line) to:

```python
approved = tuple(
    o for o in filled
    if isinstance(o, (ModifyOrder, CancelOrder)) or risk.check_order(o, error_callback=_risk_error)
)
```

- [ ] **Step 5: Wrap the module load in try/except**

In the `run` function, wrap `load_algo_module` and `handlers["init"]()` (lines 408-409) to catch import/init errors. These happen before the live loop, so send the error and exit:

```python
    try:
        handlers = load_algo_module(args.algo_path)
        state = handlers["init"]()
    except Exception as exc:
        tb = traceback.format_exc()
        print(f"[runner] Failed to load algo: {exc}", file=sys.stderr)
        sys.stderr.flush()
        # Try to send error via ZMQ if push socket is available
        try:
            push.send(msgpack.packb({
                "type": "algo_error",
                "instance_id": args.instance_id,
                "algo_id": args.algo_id,
                "severity": "critical",
                "category": "runtime",
                "message": f"Failed to load algo: {exc}",
                "handler": "init",
                "traceback": tb,
                "timestamp": int(time.time() * 1000),
            }, use_bin_type=True))
        except Exception:
            pass
        sub.close()
        push.close()
        zmq_ctx.term()
        return
```

- [ ] **Step 6: Commit**

```bash
git add algo_runtime/runner.py
git commit -m "feat: add structured error reporting to algo runner via ZMQ"
```

---

### Task 2: Rust ZMQ Hub — Route `algo_error` Messages to Frontend

**Files:**
- Modify: `src-tauri/src/zmq_hub.rs:260-478` (route_trade_signal function)

- [ ] **Step 1: Add `algo_error` match arm to `route_trade_signal`**

Add a new match arm in `route_trade_signal` (after the `"heartbeat"` arm at line 469, before the `_` default arm):

```rust
        "algo_error" => {
            let instance_id = val.get("instance_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let algo_id = val.get("algo_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let severity = val.get("severity").and_then(|v| v.as_str()).unwrap_or("error").to_string();
            let category = val.get("category").and_then(|v| v.as_str()).unwrap_or("runtime").to_string();
            let message = val.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let handler = val.get("handler").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let traceback = val.get("traceback").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let timestamp = val.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);

            log::warn!("Algo error: instance={} severity={} category={} message={}", instance_id, severity, category, message);

            let _ = app_handle.emit("algo-error", serde_json::json!({
                "instance_id": instance_id,
                "algo_id": algo_id,
                "severity": severity,
                "category": category,
                "message": message,
                "handler": handler,
                "traceback": traceback,
                "timestamp": timestamp,
            }));
        }
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/zmq_hub.rs
git commit -m "feat: route algo_error ZMQ messages to frontend via Tauri events"
```

---

### Task 3: Rust Process Manager — Capture Stderr and Detect Process Death

**Files:**
- Modify: `src-tauri/src/process_manager.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `Stdio` imports and capture stderr/stdout from spawned process**

In `process_manager.rs`, add `Stdio` to the import (line 5):

```rust
use std::process::{Child, Command, Stdio};
```

Then modify the `Command::new("python3")` spawn chain in `start_instance` (line 81-106) to capture stderr and stdout:

```rust
        let child = Command::new("python3")
            .arg(self.runner_path.to_str().unwrap_or("algo_runtime/runner.py"))
            .arg("--algo-path")
            .arg(algo_file.to_str().unwrap_or(""))
            .arg("--market-data-addr")
            .arg(zmq_hub::market_data_addr())
            .arg("--trade-signal-addr")
            .arg(zmq_hub::trade_signal_addr())
            .arg("--instance-id")
            .arg(instance_id)
            .arg("--algo-id")
            .arg(instance.algo_id.to_string())
            .arg("--source-id")
            .arg(&instance.data_source_id)
            .arg("--account")
            .arg(&instance.account)
            .arg("--mode")
            .arg(&instance.mode)
            .arg("--max-position-size")
            .arg(instance.max_position_size.to_string())
            .arg("--max-daily-loss")
            .arg(instance.max_daily_loss.to_string())
            .arg("--max-daily-trades")
            .arg(instance.max_daily_trades.to_string())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn runner.py: {}", e))?;
```

- [ ] **Step 2: Extract stderr/stdout handles before storing child, return them from start_instance**

Change `start_instance` return type to return the child's stderr and stdout handles along with the PID. Add a new struct and modify the return:

Add this struct before `ProcessManager`:

```rust
/// Handles from a spawned algo process for output monitoring.
pub struct ProcessHandles {
    pub stderr: std::process::ChildStderr,
    pub stdout: std::process::ChildStdout,
    pub instance_id: String,
    pub algo_id: String,
}
```

Modify `start_instance` to return `Result<(u32, ProcessHandles), String>`:

```rust
    pub fn start_instance(
        &self,
        db_state: &DbState,
        instance_id: &str,
    ) -> Result<(u32, ProcessHandles), String> {
```

After spawning, extract the handles:

```rust
        let pid = child.id();
        let stderr = child.stderr.take()
            .ok_or("Failed to capture stderr from algo process")?;
        let stdout = child.stdout.take()
            .ok_or("Failed to capture stdout from algo process")?;
        let algo_id_str = instance.algo_id.to_string();

        // ... existing logging and DB update code ...

        self.processes
            .lock()
            .map_err(|e| e.to_string())?
            .insert(instance_id.to_string(), child);

        Ok((pid, ProcessHandles {
            stderr,
            stdout,
            instance_id: instance_id.to_string(),
            algo_id: algo_id_str,
        }))
    }
```

- [ ] **Step 3: Update commands.rs to handle new return type and spawn stderr monitor**

In `commands.rs`, modify `start_algo_instance` (lines 117-126) to spawn an async task that monitors stderr:

```rust
#[tauri::command]
pub fn start_algo_instance(
    db_state: tauri::State<DbState>,
    proc_state: tauri::State<ProcState>,
    app_handle: tauri::AppHandle,
    instance_id: String,
) -> Result<(), String> {
    log::info!("start_algo_instance: received request for instance_id={}", instance_id);
    let (pid, handles) = proc_state.0.start_instance(&db_state, &instance_id)?;
    log::info!("start_algo_instance: spawned instance_id={} pid={}", instance_id, pid);

    // Monitor stderr in a background thread
    let app = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(handles.stderr);
        for line in reader.lines() {
            match line {
                Ok(text) if !text.is_empty() => {
                    log::warn!("Algo stderr [{}]: {}", handles.instance_id, text);
                    let _ = app.emit("algo-error", serde_json::json!({
                        "instance_id": handles.instance_id,
                        "algo_id": handles.algo_id,
                        "severity": "error",
                        "category": "infrastructure",
                        "message": text,
                        "handler": "",
                        "traceback": "",
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

    Ok(())
}
```

Add the necessary import at the top of `commands.rs`:

```rust
use tauri::Emitter;
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/process_manager.rs src-tauri/src/zmq_hub.rs src-tauri/src/commands.rs
git commit -m "feat: capture algo stderr and emit process errors to frontend"
```

---

### Task 4: React — Error State Hook with Auto-Stop

**Files:**
- Create: `src/hooks/useAlgoErrors.ts`

- [ ] **Step 1: Create the useAlgoErrors hook**

```typescript
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
  // Track recent runtime errors per instance for auto-stop detection
  const recentErrors = useRef<Record<string, number[]>>({});

  const clearErrors = useCallback((instanceId: string) => {
    setErrorsByInstance((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
    delete recentErrors.current[instanceId];
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
        // Prune old entries outside the window
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

        const isWarning = e.severity === "warning";
        let errors = [newError, ...existing.errors];
        if (errors.length > MAX_ERRORS_PER_INSTANCE) {
          errors = errors.slice(0, MAX_ERRORS_PER_INSTANCE);
        }

        // Recount from the current list
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

      if (shouldAutoStop) {
        onAutoStop(e.instance_id);
      }
    });

    return () => { unlisten.then((f) => f()); };
  }, [onAutoStop]);

  return { errorsByInstance, clearErrors };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAlgoErrors.ts
git commit -m "feat: add useAlgoErrors hook with auto-stop logic"
```

---

### Task 5: React — Wire Hook into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import and wire useAlgoErrors in App.tsx**

Add import at the top of `App.tsx` (after line 14):

```typescript
import { useAlgoErrors } from "./hooks/useAlgoErrors";
```

Inside the `App` component, after the `simulation` line (after line 51), add:

```typescript
  const handleAutoStop = useCallback(async (instanceId: string) => {
    try {
      await invoke("stop_algo_instance", { instanceId });
    } catch (e) {
      console.error("Failed to auto-stop algo:", e);
    }
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
  }, []);

  const { errorsByInstance, clearErrors } = useAlgoErrors(handleAutoStop);
```

- [ ] **Step 2: Pass errors to AlgosView**

Update the `AlgosView` render (around line 367) to pass error props:

```tsx
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

- [ ] **Step 3: Clear errors when an instance is stopped manually**

In `handleStopAlgo` (line 316-324), add `clearErrors` call:

```typescript
  const handleStopAlgo = async (instanceId: string) => {
    try {
      await invoke("stop_algo_instance", { instanceId });
    } catch (e) {
      console.error("Failed to stop algo:", e);
    }
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
    clearErrors(instanceId);
  };
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire algo error state into App and pass to AlgosView"
```

---

### Task 6: React — Error Badges and Expandable Error List on Instance Cards

**Files:**
- Modify: `src/views/AlgosView.tsx`

- [ ] **Step 1: Update AlgosViewProps to accept error data**

Add imports and update the props type at the top of the file:

```typescript
import { useState } from "react";
import { type AlgoStats, type DataSource } from "../hooks/useTradingSimulation";
import { type InstanceErrors, type AlgoError } from "../hooks/useAlgoErrors";
```

Update `AlgosViewProps`:

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

- [ ] **Step 2: Add ErrorBadge component**

Add after `PerformanceStats` component (after line 71):

```typescript
const ErrorBadge = ({ errors }: { errors: InstanceErrors }) => {
  if (errors.errorCount === 0 && errors.warningCount === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {errors.errorCount > 0 && (
        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-[var(--accent-red)]/15 text-[var(--accent-red)]">
          {errors.errorCount} error{errors.errorCount !== 1 ? "s" : ""}
        </span>
      )}
      {errors.warningCount > 0 && (
        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
          {errors.warningCount} warning{errors.warningCount !== 1 ? "s" : ""}
        </span>
      )}
      {errors.autoStopped && (
        <span className="text-[10px] px-2 py-0.5 rounded-md font-medium bg-[var(--accent-red)]/15 text-[var(--accent-red)]">
          halted
        </span>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Add ErrorRow and ErrorList components**

Add after `ErrorBadge`:

```typescript
const formatErrorTime = (ts: number) => {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const ErrorRow = ({ error }: { error: AlgoError }) => {
  const [expanded, setExpanded] = useState(false);
  const severityColor = error.severity === "warning"
    ? "text-[var(--accent-yellow)]"
    : "text-[var(--accent-red)]";

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--text-secondary)] font-mono shrink-0">
            {formatErrorTime(error.timestamp)}
          </span>
          <span className={`text-[10px] uppercase font-medium shrink-0 ${severityColor}`}>
            {error.severity}
          </span>
          <span className="text-xs text-[var(--text-primary)] truncate">{error.message}</span>
          {error.handler && (
            <span className="text-[10px] text-[var(--text-secondary)] shrink-0 font-mono">
              {error.handler}
            </span>
          )}
        </div>
      </button>
      {expanded && error.traceback && (
        <div className="px-4 pb-3">
          <pre className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-md p-3 overflow-x-auto font-mono whitespace-pre-wrap">
            {error.traceback}
          </pre>
        </div>
      )}
    </div>
  );
};

const ErrorList = ({ errors }: { errors: InstanceErrors }) => {
  if (errors.errors.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] max-h-48 overflow-auto">
      {errors.autoStopped && (
        <div className="px-4 py-2 bg-[var(--accent-red)]/10 text-[var(--accent-red)] text-xs font-medium">
          Algo halted due to repeated errors
        </div>
      )}
      {errors.errors.map((error) => (
        <ErrorRow key={error.id} error={error} />
      ))}
    </div>
  );
};
```

- [ ] **Step 4: Update RunningInstanceRow to include error badge and expandable list**

Replace the `RunningInstanceRow` component (lines 194-253):

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
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">{algo.name}</div>
              <span className={`text-[10px] uppercase px-2 py-0.5 rounded-md font-medium ${
                run.mode === "live"
                  ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                  : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
              }`}>
                {run.mode}
              </span>
              {hasActiveTerminal && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse" title="AI terminal active" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-[var(--text-secondary)]">{run.account}</span>
              {hasErrors && (
                <button onClick={() => setShowErrors(!showErrors)}>
                  <ErrorBadge errors={instanceErrors} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenAiTerminal && (
            <button
              onClick={() => onOpenAiTerminal(algo.id)}
              disabled={hasActiveTerminal}
              className={`px-3 py-1.5 text-[11px] rounded-md font-medium transition-colors ${
                hasActiveTerminal
                  ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]/50 cursor-not-allowed"
                  : "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/25"
              }`}
            >
              AI
            </button>
          )}
          <button
            onClick={() => onStopAlgo(run.instance_id)}
            className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Stop
          </button>
        </div>
      </div>
      {stats && <PerformanceStats stats={stats} />}
      {showErrors && hasErrors && <ErrorList errors={instanceErrors} />}
    </div>
  );
};
```

- [ ] **Step 5: Update AlgosView to pass errors to RunningInstanceRow**

In the `AlgosView` component, destructure the new props and pass them through. Update the component destructuring (around line 255):

```typescript
export const AlgosView = ({
  algos,
  dataSources,
  activeRuns,
  algoStats,
  errorsByInstance,
  onStartAlgo,
  onStopAlgo,
  onClearErrors,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
}: AlgosViewProps) => {
```

Then update the `RunningInstanceRow` render (around line 348-363) to pass errors:

```tsx
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

- [ ] **Step 6: Commit**

```bash
git add src/views/AlgosView.tsx
git commit -m "feat: add error badges and expandable error list to algo instance cards"
```

---

### Task 7: Integration Test — Verify End-to-End Error Flow

**Files:**
- No new files — manual verification

- [ ] **Step 1: Create a test algo with a deliberate bug**

Create a temporary algo via the UI with a bug in `on_tick`:

```python
def create_algo():
    def init():
        return {}

    def on_tick(state, tick, ctx):
        # This will crash: accessing a key that doesn't exist
        value = state["nonexistent_key"]
        return None

    return {"init": init, "on_tick": on_tick}
```

- [ ] **Step 2: Verify error display**

1. Start the algo in shadow mode on a connected chart
2. Verify: Red error badge appears on the instance card within seconds
3. Verify: Badge shows error count incrementing
4. Verify: After 10 errors in 5 seconds, algo auto-stops and shows "halted" badge
5. Click the error badge to expand the error list
6. Verify: Each error shows timestamp, severity, message, and handler name
7. Click an error row to expand it
8. Verify: Full Python traceback is visible

- [ ] **Step 3: Test risk violation warnings**

Create an algo that tries to exceed position limits:

```python
from wolf_types import Order

def create_algo():
    def init():
        return {"fired": False}

    def on_tick(state, tick, ctx):
        if not state["fired"]:
            from wolf_types import AlgoResult
            orders = tuple(Order("BUY", tick.symbol, 100, "MARKET", 0.0, 0.0) for _ in range(3))
            return AlgoResult({"fired": True}, orders)
        return None

    return {"init": init, "on_tick": on_tick}
```

Verify: Yellow warning badges appear for risk violations.

- [ ] **Step 4: Test process crash detection**

Create an algo with a syntax error that prevents loading:

```python
def create_algo(
    # Missing closing paren — SyntaxError
```

Start it and verify: Critical error appears with "Failed to load algo" message captured from stderr.

- [ ] **Step 5: Commit (if any test-driven fixes were needed)**

```bash
git add -u
git commit -m "fix: address issues found during error visibility integration testing"
```

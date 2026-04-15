# Algo Log Panel — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

Add a collapsible log panel to the AlgosView that shows real-time event logs and health indicators for running algo instances. The panel displays per-algo events (bars, orders, fills, signals, errors, heartbeats) and connection health (WebSocket, ZMQ, process status). The view auto-selects the first running algo on load.

## Goals

- Verify that the full pipeline (NinjaTrader → Tauri → Algo) is working at a glance
- Inspect per-algo event streams for debugging and monitoring
- See connection health without leaving the algos view

## Backend: Event Capture & Emission

### New Tauri Event: `algo-log`

Emitted for all log-worthy events. Shape:

```typescript
{
  instance_id: string,
  algo_id: number,
  event_type: "BAR" | "ORDER" | "FILL" | "SIGNAL" | "ERROR" | "POSITION" | "TRADE" | "HEARTBEAT" | "LOG",
  message: string,
  timestamp: string  // ISO 8601
}
```

### Event Sources

| Event type | Source | Capture location |
|---|---|---|
| BAR | ZMQ hub receives bar from NinjaTrader | `zmq_hub.rs` |
| ORDER | Algo sends order via ZMQ | `zmq_hub.rs` |
| FILL | NinjaTrader confirms fill via WebSocket | `websocket_server.rs` |
| POSITION | NinjaTrader sends position update | `websocket_server.rs` |
| SIGNAL / LOG | Algo stdout | `process_manager.rs` (new stdout capture) |
| ERROR | Algo stderr / ZMQ error report | existing `algo-error` path |
| TRADE | Computed from fill + position flat | `zmq_hub.rs` |
| HEARTBEAT | NinjaTrader heartbeat received | `websocket_server.rs` |

### Stdout Capture

`process_manager.rs` already captures stderr for error events. Add stdout capture on the same spawned process:

- Lines prefixed with `[SIGNAL]` → event_type `SIGNAL`
- Lines prefixed with `[LOG]` → event_type `LOG`
- Unprefixed lines → event_type `LOG`
- Parsed into `algo-log` Tauri events with the instance_id and algo_id

### `self.log()` in Algo Base Class

Add a `log(message)` method to the algo base class in `runner.py` that prints `[SIGNAL] <message>` to stdout. Algos can optionally call `self.log("entry triggered, z-score: -2.14")` to surface decision-making logic in the log panel.

### New Tauri Event: `algo-health`

Emitted every 2 seconds per running instance. Shape:

```typescript
{
  instance_id: string,
  ws_connected: boolean,
  zmq_active: boolean,
  process_alive: boolean,
  bars_per_sec: number,
  last_heartbeat_secs_ago: number
}
```

Derived from existing state:
- `ws_connected`: `ConnectionRegistry` knows if the data source's WebSocket is alive
- `zmq_active`: Track last ZMQ message timestamp per instance in `zmq_hub.rs`
- `process_alive`: `ProcessManager` knows if the child process is running
- `bars_per_sec`: Count bars routed per instance in `zmq_hub.rs`, compute rate
- `last_heartbeat_secs_ago`: Track last heartbeat per data source in `websocket_server.rs`

## Frontend: Components & State

### New Hook: `useAlgoLogs`

Mirrors the pattern of `useAlgoErrors.ts`:

- Listens to `algo-log` Tauri events
- Stores logs per `instance_id` in `Record<string, LogEntry[]>`
- Ring buffer of 500 entries per instance (drops oldest)
- Exposes `logsByInstance` and `clearLogs(instanceId)`

### New Hook: `useAlgoHealth`

- Listens to `algo-health` Tauri events
- Stores latest health snapshot per `instance_id`
- Exposes `healthByInstance`

### New Component: `LogPanel`

Placed in AlgosView below the PerformanceStats / ErrorList section.

**Props:** `instanceId`, `logs`, `health`, `onClear`

**Structure:**
1. **Header bar** (clickable to collapse/expand):
   - Chevron indicator (▼/▶), "Logs" label, selected algo name
   - Health indicator dots: WS, ZMQ, Process (green/yellow/red)
   - Throughput: bars/sec, last heartbeat age
2. **Log stream** (scrollable):
   - Virtualized list for performance with high-frequency events
   - Each line: timestamp, color-coded event type badge, message text
   - Auto-scrolls to bottom; pauses auto-scroll when user scrolls up
3. **Filter bar** (bottom):
   - Toggleable pills per event type
   - HEARTBEAT off by default
   - Clear button, auto-scroll toggle

**Event type colors:**

| Type | Color | Hex |
|---|---|---|
| BAR | Blue | `#60a5fa` |
| ORDER | Amber | `#fbbf24` |
| FILL | Green | `#4ade80` |
| SIGNAL | Purple | `#c084fc` |
| ERROR | Red | `#f87171` |
| POSITION | Blue | `#60a5fa` |
| TRADE | Green | `#4ade80` |
| HEARTBEAT | Dim gray | `#334155` |
| LOG | Gray | `#888888` |

### AlgosView Changes

- Render `LogPanel` below existing PerformanceStats / ErrorList
- Instance rows become clickable to switch which algo's logs are displayed
- Collapsed/expanded state managed via `useState`, defaults to expanded

## Default Selection Behavior

On AlgosView mount:

1. Check `activeRuns` for instances with status `"running"`
2. If running instances exist, auto-select the first one's `dataSourceId` as the active chart
3. Auto-select that first running instance → LogPanel shows its logs
4. If no algos are running, behavior unchanged (no chart selected, no log panel)
5. Manual user selection overrides auto-selection

## Non-Goals

- Persisting logs to disk or database (in-memory ring buffer only)
- Log search/grep functionality (filter by type is sufficient for now)
- Multi-instance log comparison (one instance at a time)

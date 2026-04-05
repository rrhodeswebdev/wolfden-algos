# Plan: AI Terminal in Algos View

> Source PRD: docs/prd-ai-terminal.md

## Architectural decisions

Durable decisions that apply across all phases:

- **Algo file location**: `algo_runtime/algos/{slug}.py` — gitignored, DB is source of truth, files written on terminal open
- **Skill location**: `algo_runtime/.claude/skills/wolfden-algo.md` — available to any Claude Code session started from the project root
- **PTY state**: Managed in a Tauri state map (`algo_id -> pty_handle`), same pattern as `ProcState` wrapping `ProcessManager`
- **Tauri commands**: `spawn_ai_terminal(algo_id)`, `write_ai_terminal(algo_id, input)`, `close_ai_terminal(algo_id)`
- **Tauri events**: PTY output emitted as `ai-terminal-output-{algo_id}`, file changes emitted as `algo-code-updated`
- **Terminal component**: xterm.js in a resizable bottom panel, lives in App.tsx (outside view routing) for persistence
- **One terminal per algo**: Enforced at the Tauri layer; frontend disables button when session exists

---

## Phase 1: Claude Code Skill

**User stories**: 3, 13

### What to build

Create a Claude Code skill file that serves as the single source of truth for the Wolf Den algo API contract. The skill documents the `create_algo()` factory pattern, all handler signatures, all types from `wolf_types.py`, all convenience constructors, the `AlgoResult` return contract, import requirements, and common pitfalls. It references the example algo at `algo_runtime/examples/prev_candle_breakout.py` so Claude Code can use it as a pattern. The skill also instructs Claude Code to only modify the target algo file passed to it.

### Acceptance criteria

- [ ] Skill file exists at `algo_runtime/.claude/skills/wolfden-algo.md`
- [ ] Documents all types exported by `wolf_types.py` (`Tick`, `Bar`, `Fill`, `Context`, `AlgoResult`, `Order`, `BracketOrder`, `ModifyOrder`, `CancelOrder`, `OrderAccepted`)
- [ ] Documents all convenience constructors (`market_buy`, `market_sell`, `limit_buy`, `limit_sell`, `stop_buy`, `stop_sell`, `modify_order`, `cancel_order`, `bracket`)
- [ ] Documents the `create_algo()` factory pattern and all handler signatures (`init`, `on_tick`, `on_bar`, `on_fill`, `on_order_accepted`)
- [ ] References the example algo at `algo_runtime/examples/prev_candle_breakout.py`
- [ ] Instructs Claude Code to only modify the specific algo file it was opened for

---

## Phase 2: PTY Backend — Spawn & Close

**User stories**: 1, 2, 4, 8, 10, 11

### What to build

Add Tauri commands and managed state for spawning Claude Code as a PTY process. When `spawn_ai_terminal` is called with an algo ID, the backend writes the algo's current code from the DB to `algo_runtime/algos/{slug}.py`, then attempts to spawn `claude` as a PTY process from the project root directory. PTY stdout is emitted as Tauri events scoped to the algo ID. `write_ai_terminal` forwards keystrokes to the PTY stdin. `close_ai_terminal` kills the process and removes it from the state map. The state map enforces one terminal per algo — spawning a second returns an error. If `claude` is not found in PATH, the spawn command returns a descriptive error.

### Acceptance criteria

- [ ] `spawn_ai_terminal` writes algo code to `algo_runtime/algos/{slug}.py` and spawns a PTY process
- [ ] PTY output is emitted as Tauri events (`ai-terminal-output-{algo_id}`)
- [ ] `write_ai_terminal` sends input to the PTY stdin
- [ ] `close_ai_terminal` kills the PTY process and removes it from state
- [ ] Attempting to spawn a second terminal for the same algo returns an error
- [ ] Missing `claude` binary returns a descriptive error (not a crash)
- [ ] PTY sessions are tracked in managed state (similar pattern to `ProcState`)

---

## Phase 3: Terminal Panel — Render & Interact

**User stories**: 6, 12

### What to build

An xterm.js-based terminal component rendered in a resizable bottom panel. The panel has a drag handle on its top edge for resizing. The terminal is themed to match the app's dark theme using existing CSS variables (`--bg-panel`, `--text-primary`, `--border`, etc.). It subscribes to PTY output events for the active algo and renders them in the terminal. Keystrokes are forwarded to the backend via `write_ai_terminal`. The xterm.js fit addon is used so the terminal resizes responsively.

### Acceptance criteria

- [ ] xterm.js renders in a bottom panel with PTY output displayed
- [ ] User keystrokes are sent to the backend and echoed correctly
- [ ] Panel is resizable via drag handle on the top edge
- [ ] Terminal theme matches the app's dark theme (background, text, cursor colors from CSS variables)
- [ ] Terminal resizes responsively when panel is resized (fit addon)
- [ ] Panel has a close button that calls `close_ai_terminal`

---

## Phase 4: AlgosView Integration

**User stories**: 1, 2, 7, 8, 11

### What to build

Integration points in the AlgosView for opening and creating AI terminal sessions. An "Open AI" button appears on each algo card/row — clicking it calls `spawn_ai_terminal` for that algo and opens the terminal panel. A "Create with AI" button creates a new algo entry in the DB (with skeleton code), then immediately opens a terminal for it. Algo cards show a visual indicator (icon/badge) when a terminal session is active. The button is disabled if a terminal is already running for that algo. Toast notifications appear when Claude Code is not found or the spawn fails.

### Acceptance criteria

- [ ] "Open AI" button on algo cards calls `spawn_ai_terminal` and opens the terminal panel
- [ ] "Create with AI" button creates a new algo in the DB then opens a terminal for it
- [ ] Active terminal indicator (badge/icon) visible on algo cards with running sessions
- [ ] Button is disabled when a terminal is already active for that algo
- [ ] Toast error shown when `claude` is not found in PATH
- [ ] Toast error shown on other spawn failures

---

## Phase 5: File Watcher & DB Sync

**User stories**: 5

### What to build

A file watcher that monitors the algo's Python file on disk while a terminal session is active. When `spawn_ai_terminal` starts a session, a watcher is registered for `algo_runtime/algos/{slug}.py`. On file change, the backend reads the updated file contents, updates the `code` column in the `algos` table, and emits an `algo-code-updated` event to the frontend so the Editor View stays in sync. The watcher is stopped and cleaned up when the terminal is closed.

### Acceptance criteria

- [ ] File watcher starts when a terminal session spawns
- [ ] Changes to the algo file on disk update the `code` column in the `algos` DB table
- [ ] `algo-code-updated` event is emitted to the frontend with the new code
- [ ] File watcher stops when the terminal session is closed
- [ ] Editor View reflects file changes without manual refresh

---

## Phase 6: Terminal Persistence Across Views

**User stories**: 9

### What to build

Move the terminal panel component to live outside of the view routing (in App.tsx or a persistent wrapper) so that it survives navigation between views. The bottom panel remains visible on any view while a session is active. The "open" buttons remain only in AlgosView, but once a terminal is open, switching to Home, Editor, or Trading view does not destroy the xterm.js instance or kill the PTY process.

### Acceptance criteria

- [ ] Terminal panel persists when navigating away from AlgosView and back
- [ ] xterm.js instance and PTY process are not destroyed on view change
- [ ] Terminal panel is visible on all views while a session is active
- [ ] Closing the terminal from any view kills the PTY immediately

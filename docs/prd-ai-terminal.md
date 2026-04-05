# PRD: AI Terminal in Algos View

## Problem Statement

Creating new trading algos requires switching between tools — writing code in an external editor or AI chat, then manually copying it into the Wolf Den editor. There is no integrated AI-assisted workflow for generating or iterating on algo strategies. Users want to leverage Claude Code (or similar terminal-based AI tools) to rapidly create and refine algos without leaving the app, while ensuring generated code always conforms to the Wolf Den algo runtime API.

## Solution

Add a resizable bottom terminal panel to the Algos View that launches Claude Code directly within the app. Each algo definition gets a dedicated "Open AI" button that spawns a Claude Code session pre-loaded with context about that specific algo file and the Wolf Den algo API (via a Claude Code skill). A "Create with AI" button creates a new algo entry and immediately opens a terminal for it. File changes made by Claude Code are auto-synced back to the database so the Editor View stays in sync. If Claude Code is not installed on the user's machine, a toast error is shown.

## User Stories

1. As a trader, I want to click "Create with AI" to start a new algo with Claude Code so that I can describe my strategy in natural language and get working code
2. As a trader, I want to click "Open AI" on an existing algo to iterate on it with Claude Code so that I can refine my strategy without leaving the app
3. As a trader, I want Claude Code to automatically know the Wolf Den algo API structure so that generated algos always run without errors
4. As a trader, I want Claude Code to only modify the specific algo file I opened it for so that other algos are not accidentally changed
5. As a trader, I want the Editor View to automatically reflect changes Claude Code makes so that I always see the latest version of my algo
6. As a trader, I want the terminal panel to be resizable so that I can adjust how much screen space it takes
7. As a trader, I want to see a visual indicator on algo cards when a Claude Code terminal is active so that I know which algos have an open AI session
8. As a trader, I want only one terminal per algo at a time so that I don't get confused by multiple sessions editing the same file
9. As a trader, I want the terminal to persist when I navigate away from Algos View and back so that I don't lose my Claude Code session mid-conversation
10. As a trader, I want the terminal session to be killed immediately when I close it so that resources are freed
11. As a trader, I want a toast notification if Claude Code fails to start so that I know what went wrong and how to fix it
12. As a trader, I want the terminal to match the app's dark theme so that the experience feels cohesive
13. As a trader, I want Claude Code to have the example algo available as a reference so that it can generate strategies following proven patterns
14. As a trader, I want to be able to describe a strategy like "enter long on previous candle breakout with a trailing stop" and get a working algo so that I can rapidly prototype ideas

## Implementation Decisions

### Modules

**1. Claude Code Skill (`algo_runtime/.claude/skills/wolfden-algo.md`)**
- Single source of truth for the Wolf Den algo API contract
- Lives in the project root so it is available to any Claude Code session started from the project directory
- Documents: `create_algo()` factory pattern, all handler signatures (`init`, `on_tick`, `on_bar`, `on_fill`, `on_order_accepted`), all types (`Tick`, `Bar`, `Fill`, `Context`, `AlgoResult`, `OrderAccepted`, `Order`, `BracketOrder`, `ModifyOrder`, `CancelOrder`), all convenience constructors (`market_buy`, `market_sell`, `limit_buy`, `limit_sell`, `stop_buy`, `stop_sell`, `modify_order`, `cancel_order`, `bracket`), the `AlgoResult` return contract, import requirements, and common pitfalls
- References the example algo at `algo_runtime/examples/prev_candle_breakout.py`

**2. PTY Backend (Tauri commands + state)**
- New Tauri commands: `spawn_ai_terminal`, `write_ai_terminal`, `close_ai_terminal`
- `spawn_ai_terminal(algo_id)`: writes the algo's code to `algo_runtime/algos/{algo_name}.py`, attempts to spawn `claude` as a PTY process from the project root, emits PTY output via Tauri events scoped to the algo ID. If `claude` is not found in PATH, returns an error
- `write_ai_terminal(algo_id, input)`: sends keystrokes to the PTY stdin
- `close_ai_terminal(algo_id)`: kills the PTY process and cleans up
- Tracks active PTY sessions in a managed state map (algo_id -> pty handle)
- Enforces one terminal per algo at the Tauri layer

**3. File Watcher (Tauri)**
- When a terminal spawns for an algo, starts watching `algo_runtime/algos/{algo_name}.py` for changes
- On file change: reads the updated file, updates the `code` column in the `algos` SQLite table, emits a `algo-code-updated` event to the frontend
- Watcher is stopped when the terminal is closed

**4. Terminal Panel Component (Frontend)**
- xterm.js-based terminal rendered in a bottom panel of the Algos View
- Resizable via drag handle on the top edge
- Themed to match the app's CSS variables (`--bg-panel`, `--text-primary`, `--border`, etc.)
- Receives PTY output via Tauri event listener, sends input via `write_ai_terminal` command
- Mounts/unmounts based on which algo terminal is active
- Persists terminal state across view navigation (terminal component lives in App.tsx or a persistent wrapper, not inside AlgosView)

**5. AlgosView Integration**
- "Create with AI" button in the algo management area: creates a new algo entry in the DB (with empty/skeleton code), writes the file to disk, then opens the terminal
- Per-algo "AI" button on algo cards/rows: opens the terminal for that algo
- Active terminal indicator (small icon/badge) on the algo card when a session is running
- Button is disabled if a terminal is already active for that algo
- Toast notifications for errors (Claude Code not found, spawn failure)

### Algo File Location

- Algo files are written to `algo_runtime/algos/{slug}.py` where slug is derived from the algo name
- This directory is gitignored since algo source of truth is the database
- The file watcher syncs disk changes back to the DB
- On terminal open, the current DB code is written to disk (overwriting any stale file)

### Claude Code Invocation

- Claude Code is started from the project root directory so it has access to the skill
- The initial prompt or flags should direct Claude to the specific algo file path
- The skill constrains Claude to only modify the target algo file and to follow the API contract

### Terminal Persistence

- The terminal component and its xterm.js instance live outside of the view routing so they survive view changes
- The bottom panel is visible on any view while a session is active, but the "open" buttons are only in AlgosView
- Closing the terminal kills the PTY immediately with no confirmation prompt

## Testing Decisions

A good test validates external behavior through the public interface without coupling to implementation details. Tests should verify what the system does, not how it does it internally.

### Modules to test

- **File Watcher**: Test that writing to the watched file triggers a DB update with the correct content. Test that the watcher stops cleanly on terminal close.
- **PTY Lifecycle**: Test that spawning a terminal for an algo creates the file on disk, and closing it cleans up. Test the one-terminal-per-algo constraint.
- **Skill Completeness**: Validate that the skill document references all types and functions exported by `wolf_types.py` (can be a simple script that parses both files).

### Prior art

- The existing process manager (`process_manager.rs`) spawns and kills child processes with similar lifecycle patterns — tests for the PTY backend can follow the same structure.

## Out of Scope

- Support for AI tools other than Claude Code (future work — the terminal is generic enough to support them later)
- Terminal multiplexing (multiple tabs/splits within the panel)
- Algo version history or undo for AI-generated changes
- Running or testing algos directly from the terminal
- Streaming algo logs (stdout capture) into the terminal — this is a separate feature
- Auto-installing Claude Code if it's not present

## Further Notes

- The `@tauri-apps/plugin-shell` dependency is already present and may be useful for spawning the PTY, though a dedicated PTY crate (like `portable-pty` or `pty-process`) will likely be needed for full terminal emulation
- xterm.js will need to be added as a frontend dependency along with its fit addon for responsive sizing
- The skill should be kept in sync with `wolf_types.py` — if the types change, the skill must be updated. A CI check or test can enforce this
- The resizable panel pattern is common in developer tools; a simple mouse-drag handler on the top border of the panel is sufficient

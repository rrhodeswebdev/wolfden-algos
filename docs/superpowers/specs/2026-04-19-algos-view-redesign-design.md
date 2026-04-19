# Algos View Redesign — Design

**Date:** 2026-04-19
**Direction:** Group-by toggle — single grouped list, slide-over launcher, always-visible detail panel
**Brainstorm artifacts:** `.superpowers/brainstorm/` (mockups generated during brainstorming; not committed)

## Summary

Replace the current chart-scoped AlgosView (charts left → chart detail right, stacked chart header + running rows + add-algo panel + logs) with a single grouped instance list and an always-visible detail panel. A segmented control toggles the list's grouping between **Chart (default)**, **Algo**, and **None**, letting the view serve both the "per-chart dashboard" and "per-strategy rollup" mental models without mode-switching the layout. A new top command bar surfaces session aggregate P&L and a prominent `+ Run new algo` action; the launcher is a right-side slide-over. Deep-links from group headers and the detail panel make it easy to jump to Editor, Trading, and the AI terminal without leaving context.

## Goals

- One layout, two pivots — Group-by (Chart / Algo / None) swaps list groupings without swapping the page.
- Scanable roster — health, mode, P&L, and trend visible at a glance per instance; aggregate P&L and status at each group.
- Detail alongside the list — stats, logs, errors, and config live in a right-side panel so you never lose the list context when drilling in.
- Fast "start a run" — slide-over launcher replaces the inline add-algo panel; default mode choice is one click away.
- Outbound navigation — every meaningful row or group exposes a deep-link to the relevant Editor / Trading / AI terminal view.
- Surgical refactor — no backend / Tauri-command / schema changes; PRable as one unit.

## Non-Goals

- Bulk actions across instances (multi-select stop, multi-select AI) — deferred.
- Keyboard shortcuts / command palette — deferred to an app-wide project.
- Persisting group-by / filter selections across app restarts — in-memory only.
- Redesigning the logs panel itself — keep current `LogPanel` behavior; only its placement changes (now inside the detail panel's Logs tab).
- Redesigning `AiTerminalPanel` — keep current right-side behavior.
- Mobile / narrow-viewport responsiveness — this is a Tauri desktop app; assume ≥1100px width.
- Changing the existing `NavOptions` contract or cross-view navigation mechanics — reuse `onNavigate` with the existing options surface.

## Scope

### In scope

- Full rewrite of `src/views/AlgosView.tsx` into a composed layout.
- New components:
  - `AlgosCommandBar.tsx` — title, aggregate meta, session P&L, `+ Run new algo` trigger.
  - `AlgosFilterBar.tsx` — group-by segmented, mode segmented, status select, search input.
  - `AlgosInstanceList.tsx` — the grouped list itself.
  - `AlgoInstanceRow.tsx` — a single row (health dot, name, account/duration, mode pill, sparkline, P&L, trades).
  - `AlgoGroupHeader.tsx` — a group row (title, meta, aggregate P&L, deep-link icon).
  - `AlgoDetailPanel.tsx` — right-side panel (header, actions, stats grid, tabs for Logs / Errors / Config).
  - `RunAlgoSlideOver.tsx` — the launcher.
- Small utility:
  - `src/lib/algoInstanceView.ts` — pure helpers (grouping, filtering, aggregate P&L per group, sparkline point derivation).
- Deletion (or repurposing) of inline `ChartCard`, `AddAlgoPanel`, `RunningInstanceRow`, `PerformanceStats`, `ErrorBadge`, `ErrorRow`, `ErrorList` sub-components inside the current `AlgosView.tsx` — their responsibilities fold into the new components above (nothing reused as-is; a clean rewrite).
- Reuse of `LogPanel` inside `AlgoDetailPanel`'s Logs tab (no changes to `LogPanel` itself).

### Out of scope

- Other views (Home, Editor, Trading, Guide) — untouched.
- `AiTerminalPanel`, `LogPanel`, and all hooks (`useTradingSimulation`, `useAlgoErrors`, `useAlgoLogs`, `useAlgoHealth`) — no changes.
- `Sidebar.tsx`, `TitleBar.tsx` — no changes.
- The NinjaTrader bridge / Rust side / Tauri commands — no changes.

## Architecture

### File layout

```
src/
  lib/
    algoInstanceView.ts         [new]   — pure grouping/filtering/aggregate helpers
  components/
    AlgosCommandBar.tsx         [new]
    AlgosFilterBar.tsx          [new]
    AlgosInstanceList.tsx       [new]
    AlgoInstanceRow.tsx         [new]
    AlgoGroupHeader.tsx         [new]
    AlgoDetailPanel.tsx         [new]
    RunAlgoSlideOver.tsx        [new]
  views/
    AlgosView.tsx               [rewrite] — layout-only orchestrator + local UI state
```

`AlgosView.tsx` keeps its existing props contract (`AlgosViewProps`) — no changes to how `App.tsx` mounts or hands it data.

### State (inside `AlgosView`)

Local `useState`:

- `groupBy: "chart" | "algo" | "none"` — default `"chart"`.
- `modeFilter: "all" | "live" | "shadow"` — default `"all"`.
- `statusFilter: "all" | "running" | "halted" | "warning"` — default `"all"`.
- `searchQuery: string` — default `""`.
- `selectedInstanceId: string | null` — drives the detail panel. Auto-select logic preserved from today's implementation (honor `initialInstanceId`, else first running instance).
- `launcherOpen: boolean` — controls the slide-over.
- `launcherPrefill: { algoId?: number; chartId?: string } | null` — optional prefill when opened from a group header "+ add" action. Chart-pivot group headers prefill `chartId`; Algo-pivot group headers prefill `algoId`.
- `dismissedInstanceIds: Set<string>` — local-only set of halted instance ids the user has cleared from the list.

Group-by / filter / search state is in-memory only; it does not persist across sessions (non-goal).

### Data derivation (pure, in `algoInstanceView.ts`)

- `buildGroups(activeRuns, dataSources, algos, groupBy, filters, searchQuery)` → `{ groupKey, groupLabel, groupMeta, aggregatePnl, instances }[]`.
  - Chart grouping: key = `data_source_id`; label = `<instrument> <timeframe>`; meta = account + count.
  - Algo grouping: key = `algo_id`; label = `<algo.name>`; meta = instance count.
  - None: single implicit group, no header rendered.
- `aggregatePnl(instances, algoStats)` → sum of per-instance `stats.pnl` (0 when missing).
- `sparklinePoints(history, width, height)` → `string` of polyline points; derived from `runPnlHistories` (reuse the same shape HomeView uses).
- `passesFilters(run, errors, modeFilter, statusFilter, searchQuery, algoName)` → `boolean`.
  - `status = "halted"` when `errors.autoStopped` is true.
  - `status = "warning"` when `errors.warningCount > 0 && !errors.autoStopped`.
  - `status = "running"` otherwise.
  - Search matches algo name, instrument, or account (case-insensitive substring).

All helpers are pure and independently testable.

### Detail panel data

- Selected run, algo, `algoStats[instanceId]`, `errorsByInstance[instanceId]`, `logsByInstance[instanceId]`, `healthByInstance[instanceId]` — all passed down from `AlgosView` (already received as props).
- Tabs (`Logs` | `Errors` | `Config`) are local state inside `AlgoDetailPanel`. Default when a selection changes: `Errors` if the newly-selected instance has `errorCount > 0`, otherwise `Logs`. Switching tabs manually overrides until the next selection change.
- The `Config` tab renders the algo's static `config` string in a read-only code block (today's `Algo` type already carries this). Non-goal: editing config here — that's the Editor's job.

### Deep-link contract (reuses existing `NavOptions`)

| Source | Action | `onNavigate(view, options)` |
|---|---|---|
| Group header (Chart pivot) → `→ chart` icon | View trading for that chart's account | `onNavigate("trading", { accountFilter: run.account })` |
| Group header (Algo pivot) → `→ editor` icon | Open that algo in the editor | `onNavigate("editor", { algoFilter: algo.id })` |
| Detail panel → `Open in Editor` | Same as above for the selected instance | `onNavigate("editor", { algoFilter: algo.id })` |
| Detail panel → `View trades` | Trading view filtered to this account and scrolled to positions | `onNavigate("trading", { accountFilter: run.account, scrollTo: "positions" })` (instance-level filtering is not promised — matches what the `NavOptions` contract reliably supports today) |
| Detail panel → `AI terminal` | Existing AI terminal handler | `onOpenAiTerminal?.(algo.id)` |

No changes to `NavOptions` or `App.tsx` routing — these cases are already supported by the existing contract.

### Run-new-algo slide-over

- Overlay layer: fixed-position panel, 380px wide, slides from the right of the main content area (inside `AlgosView`'s frame — does not cover the app sidebar).
- Backdrop: faint scrim (10% black) over the detail panel and list; clicking the scrim dismisses.
- Close: Esc, scrim click, Cancel button, or successful Start.
- Fields:
  - **Algo** — select, populated from `algos`.
  - **Chart** — select, populated from `dataSources`. Prefills from `launcherPrefill.chartId` if present. The algo select likewise prefills from `launcherPrefill.algoId` when set.
  - **Mode** — two large chips: `◐ Shadow` (yellow tone), `● Live` (green tone). Mutually exclusive; defaults to `Shadow`.
  - **Account override** — optional. Defaults to `"use chart's account"` which resolves to `ds.account`. A free-text override matches today's data shape (account strings are not constrained in `AlgoRun`).
- Footer: `Cancel`, `Start`. `Start` calls `onStartAlgo(algo.id, mode, account, chart.id)` — the same signature used today.
- Submit disabled until all required fields are chosen.

### Halted & stopped instance handling

- Halted instances (`errors.autoStopped === true`) remain in the list, sorted to the bottom of their group with muted styling and a "stopped Xm ago" label derived from the most recent error timestamp.
- No automatic dismissal — the row stays until the user dismisses via a row-level `Clear` affordance or stops the instance.
- `Clear` is visible on hover. It adds the instance id to a local `dismissedInstanceIds` Set in `AlgosView` state, which the list-rendering layer uses to hide the row. It does not call any handler or touch backend state. The set is in-memory; revisiting the view re-shows any halted rows still present in `activeRuns`.
- If `activeRuns` no longer includes a halted instance (already gone from the hook), nothing to render — normal behavior.

### Empty states

- **No charts connected**: centered message in the list area — "No charts connected. Add the WolfDenBridge indicator to a NinjaTrader chart to get started." (same copy as today.) Detail panel shows an inert "Select an instance…" message.
- **No running algos, charts present**: list area renders chart group headers with "No algos on this chart · + Run new algo" link; the detail panel shows a "Run your first algo" CTA that opens the slide-over prefilled with no chart selection.
- **Filters exclude everything**: inline message "No instances match these filters · Clear filters".
- **No selection**: detail panel shows "Select an instance to see details" with a subtle illustration placeholder (text-only for now).

### Visual language

- Colors pull from existing CSS variables (`--bg-primary`, `--bg-panel`, `--bg-secondary`, `--border`, `--text-primary`, `--text-secondary`, `--accent-blue`, `--accent-green`, `--accent-yellow`, `--accent-red`).
- Row heights are compact: list rows ~48px; group headers ~36px; detail panel header ~64px.
- Pills (Live/Shadow/Halted) follow the color conventions already used in `RunningInstanceRow` today.
- Sparklines mirror the HomeView sparkline style (same stroke width, same green/red-based-on-pnl coloring).

## User Flows

### Monitor running algos

1. Open Algos view → see grouped list defaulting to Chart pivot.
2. Scan aggregate P&L per group in the headers; scan per-instance P&L and sparklines in rows.
3. Click an instance → detail panel updates with stats, logs, errors.
4. Repeat for adjacent instances without losing list context.

### Triage a halted instance

1. Halted instance is visually pushed down in its group with red dot and "halted · N errors" label.
2. Click it → detail panel opens on Errors tab by default (when `errors.errorCount > 0`).
3. Drill into individual error rows (traceback expand) inside the tab.
4. Decide: open in editor to fix, or clear the stopped row.

### Start a new algo

1. Click `+ Run new algo` (top-right) → slide-over opens.
2. Pick algo, chart, mode. Start.
3. New instance appears in the list, auto-selected.

### Start an algo from a chart group

1. On a chart group header, click `+ add`.
2. Slide-over opens with chart prefilled.
3. Pick algo and mode. Start.

### Compare a strategy across markets

1. Switch group-by to Algo.
2. Each algo header shows instance count + aggregate P&L across all its instances.
3. Click any instance → detail panel isolates that run's numbers.

### Jump to another view

- From a chart group header, `→ chart` deep-links to Trading for that account.
- From an algo header, `→ editor` opens the algo in Editor.
- From the detail panel, use the three action buttons for Editor / Trading / AI terminal.

## Testing Strategy

The project has no test runner configured. Verification follows the convention used by the Home and Editor redesigns:

- **Type-check**: `npx tsc --noEmit` must pass after each task.
- **Manual smoke** against a running `npm run dev`, covering:
  - Selecting a row updates the detail panel (stats, logs, errors, config tabs).
  - Group-by toggle reshapes groups correctly for Chart / Algo / None.
  - Mode, status, and search filters combine correctly; "No results" message appears when they exclude everything.
  - Slide-over launcher: Run new algo (top bar) opens empty; group-header `+ add` prefills; Cancel / Esc / scrim dismiss; Start fires `onStartAlgo` and the new instance appears.
  - Deep-link buttons invoke `onNavigate` with the expected view and options (verifiable by navigating and observing target-view state).
  - Halted instances sort to bottom of group; `Clear` hides row locally.
  - Empty states render for: no charts, no runs, no matches, no selection.
  - Auto-select on mount continues to honor `initialInstanceId`.

The pure helpers in `src/lib/algoInstanceView.ts` are designed to be verifiable by inspection and through the manual smoke cases above. If unit tests are added later, they slot into these helpers cleanly.

## Implementation Notes

- Do not change `AlgosViewProps` or the hook surface — all inputs come in as props.
- Keep the same `useEffect`-driven auto-select behavior from today (honor `initialInstanceId`, mark consumed, fall back to first running).
- Do not regress the error-drilldown UX — the `Errors` tab must support per-error expansion with traceback, matching today's `ErrorRow`.
- The slide-over must not cover the app's left `Sidebar` — it's scoped to the Algos view's frame.
- All new components keep props explicit (no shared context) so each is independently testable and easy to reason about.

## Risks & Open Questions

- **Group-header "+ add" affordance** could feel noisy if repeated on every chart group. Mitigation: show only on hover.
- **Config tab** adds surface area. If `algo.config` is typically unused, the tab can be hidden when empty — flagged for the implementation plan to decide.
- **Slide-over vs. existing VenvSetupModal**: those are separate overlays and should not collide. Venv modal is global (from `App.tsx`); the slide-over is view-scoped. Safe to coexist.

## References

- Current implementation: `src/views/AlgosView.tsx`
- Navigation contract: `src/types.ts` (`View`, `NavOptions`)
- Shared hooks providing the data the view renders: `src/hooks/useTradingSimulation.ts`, `src/hooks/useAlgoErrors.ts`, `src/hooks/useAlgoLogs.ts`, `src/hooks/useAlgoHealth.ts`
- Prior redesigns for style cues: `docs/superpowers/specs/2026-04-18-home-view-redesign-design.md`, `docs/superpowers/specs/2026-04-19-editor-view-redesign-design.md`

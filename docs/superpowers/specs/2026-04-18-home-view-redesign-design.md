# Home View Redesign — Design Spec

**Date:** 2026-04-18
**Status:** Implemented

## Overview

Redesign the Wolf Den home view with a modern, data-forward layout that makes key trading signals easy to scan and provides deep-links into the Trading and Algos views. The current three-column layout (Accounts | long flat stat list | Active Algos) is replaced with a top-down hierarchy: account strip → KPI row → hero P&L chart → algo tape + grouped performance stats. Interactive regions route the user to the relevant existing view with filters pre-applied.

## Goals

- Establish a clear visual hierarchy: **who** (accounts) → **what** (KPIs) → **when** (chart over time) → **which** (algos running) + **how well** (performance stats).
- Keep the modern, calm aesthetic of a SaaS dashboard while retaining the information density a trader expects.
- Make the home view a true "command center": clicking any card or row navigates to the deep-dive view (Trading or Algos) with the appropriate filter already applied.
- Consolidate the long flat stat list into a prioritized KPI row + a grouped secondary panel.
- Support multi-algo P&L comparison via overlaid lines with a toggleable legend.
- Preserve the current empty-state behavior (no accounts / no runs still renders cleanly).

## Non-Goals

- Adding new data sources, new stats, or new metrics beyond what `useTradingSimulation` already exposes.
- Restructuring the `useTradingSimulation` hook or any other backend/data layer.
- Redesigning the Sidebar, TitleBar, or other global chrome.
- Redesigning the Trading, Algos, or Editor views.
- Introducing theming, settings, or dashboard customization.

## Layout Structure

The view is a single vertically-scrolling column with four stacked sections. The existing page-level header (title + connection status) is preserved as section zero and compacted into one row.

### Section 0 — Page header (compact)

One row at the top:

- Left: **"Wolf Den"** (title, 18px) with a one-line subtitle showing connection status + counts. Example: "Connected to NinjaTrader · 3 accounts · 2 algos running".
- The colored status dot (green/yellow/red) sits inline in the subtitle.

Replaces the current hero header (title + subtitle + status row) — same information, tighter.

### Section 1 — Account strip

Horizontal grid of account cards: `grid-template-columns: repeat(N, 1fr)` where N is the account count, capped at 4. If N > 4, the row scrolls horizontally on overflow.

Each account card shows:

- Top row: status dot (green if any running algo is on this account, neutral gray otherwise) + account name + "NinjaTrader" source label.
- Three-cell sub-grid: **Balance**, **Day P&L** (colored), **Positions**.

Card styling: rounded, subtle border, dark panel background, hover state highlights the border in accent blue and reveals a right-arrow cue.

**Empty state:** "No accounts connected" placeholder text (same as current).

### Section 2 — KPI row

Four equal-width cards in a single row. Each card has:

- 10px uppercase label (e.g. "TOTAL P&L")
- 22px large value (colored by sign when applicable)
- 11px secondary delta / detail line

The four KPIs:

| Card | Value | Delta / detail |
|---|---|---|
| Total P&L | `stats.totalPnl`, colored | "Realized +$X · Unrealized +$Y" |
| Win Rate | `stats.winRate%` (or `—` when no trades) | "W wins · L losses" |
| Active Algos | count running (optionally "X / Y" where Y is total algos) | "L live · S shadow" |
| Open Positions | `stats.openPositions` | Comma-separated symbol list (truncated) |

The Total P&L card includes a small decorative sparkline in the bottom-right derived from `pnlHistory`.

**Empty state:** When there's no trading activity, KPIs render `$0.00` / `—` / `0` values. Secondary detail lines hide or say "—".

### Section 3 — Hero P&L chart

One large panel containing a multi-line area chart.

- **Header row:** left side shows the panel title "Session P&L" (clickable link to Trading view); right side shows a segmented control for time range: **1h / Today / Week / MTD**, defaulting to "Today".
- **Legend row:** one entry per line. "Total" is always present. Each running algo gets a colored entry. Clicking a legend item toggles that line's visibility (strikethrough + muted color when hidden).
- **Chart body:** a stacked area for "Total" with a gradient fill; thin colored lines overlaid per algo. Uses uPlot (already a dependency).
- **Data source:** the chart reads from the simulation hook. For "Today", use `pnlHistory` for the total and `runPnlHistories[instance_id]` per running instance. Other time ranges are stubbed as non-functional for v1 (see "Out of Scope" below).

**Empty state:** When there's no P&L history, render a flat gray baseline and a centered "No session activity yet" hint.

### Section 4 — Bottom split

A 2/3 + 1/3 column split.

**Left (2/3) — Active Algos tape:** a table with columns: Algo, Mode, Account, P&L, Trades, Win %, Trend (20px sparkline from the instance's `runPnlHistories`). Each row is clickable (navigates to Algos view focused on that instance). Each row also has an inline stop button revealed on hover (kebab menu or direct "Stop" text button).

- **Mode column:** colored pill. Green "Live", amber "Shadow".
- **Empty state:** "No algos running — start one from the Algos view" (same copy as current).

**Right (1/3) — Performance panel:** compact stat rows grouped into three sections with thin divider lines between groups:

- **Quality:** Profit Factor, Sharpe, Max Drawdown
- **Trades:** Avg Win, Avg Loss, Avg Duration
- **Streaks:** Current (W/L), Best Today

Panel title "Performance" with a "Full stats →" link to the Trading view.

Stats that would be `—` when `totalTrades === 0` render as `—` (preserving the current empty-state rule).

## Interaction & Navigation (Click Map)

All navigation targets are existing views. Deep-linking requires extending the target views' prop API (see "Component Changes").

| Target | Action | Destination |
|---|---|---|
| Account card | click | Trading view, `initialAccountFilter = card.account` |
| KPI: Total P&L | click | Trading view, no filter |
| KPI: Win Rate | click | Trading view, scroll to orders/history region |
| KPI: Active Algos | click | Algos view, default |
| KPI: Open Positions | click | Trading view, scroll to Positions panel |
| Chart title "Session P&L →" | click | Trading view, no filter (P&L chart is top of Trading view) |
| Chart legend item | click | stays on home; toggles line visibility |
| Chart time range segment | click | stays on home; re-scopes chart (v1: only "Today" wired) |
| Algo row | click | Algos view, `initialInstanceId = row.instance_id` |
| Algo row — inline Stop button | click | calls `onStopAlgo(instanceId)`; row disappears; stays on home |
| Active Algos "View all →" | click | Algos view, default |
| Performance "Full stats →" | click | Trading view, scroll to stats section |

Hover affordance for all clickable regions:

- Border highlights to accent blue.
- A small "→" icon fades in at the top-right of cards; rows get a subtle bg tint.
- Cursor becomes pointer.

Scroll-into-view for "scroll to" destinations uses a `scrollToSection` prop on the target view, passed a known anchor id (e.g. `"positions"`, `"history"`, `"stats"`). The target view renders those anchors on the matching panels.

## Component Changes

### `src/views/HomeView.tsx` — rewrite

The existing file is rewritten from scratch. Current props expand to accept navigation and P&L history:

```typescript
type HomeViewProps = {
  connectionStatus: "waiting" | "connected" | "error";
  accounts: Record<string, AccountData>;
  algos: Algo[];
  activeRuns: AlgoRun[];
  stats: SessionStats;
  positions: Position[];
  pnlHistory: number[];                              // NEW
  runPnlHistories: Record<string, number[]>;         // NEW
  algoStats: Record<string, AlgoStats>;              // NEW — per-instance P&L, trades, win% for the tape (keyed by instance_id)
  onNavigate: (view: View, options?: NavOptions) => void;  // NEW
  onStopAlgo: (instanceId: string) => void;          // NEW
};

type NavOptions = {
  accountFilter?: string;
  instanceId?: string;
  algoFilter?: number;
  scrollTo?: "positions" | "orders" | "history" | "stats";
};
```

Internal structure: one top-level flex column; each section is its own local subcomponent in the same file for readability. Reusable presentation primitives (`KpiCard`, `AccountCard`, `AlgoTapeRow`, `StatRow`, etc.) stay local to the file — they're not general-purpose.

The existing `StatRow` and `SectionLabel` helpers are dropped; their logic moves into the new stat-group structure.

### `src/App.tsx` — wire up

`App` constructs a single `handleNavigate` callback matching the `NavOptions` shape and passes it to `HomeView`. It also passes `simulation.pnlHistory`, `simulation.runPnlHistories`, and `simulation.algoStats` through. The existing `handleStopAlgo` is passed as `onStopAlgo`.

`App` stores a small `pendingNavContext` state to communicate the filter/scroll intent into the target view after `activeView` changes. The context is consumed once and cleared (e.g. an effect inside the target view reads it on mount and calls the local setters that set the filter state).

### `src/views/TradingView.tsx` — accept initial context

- Accept an optional `initialContext?: { accountFilter?; algoFilter?; scrollTo? }` prop.
- On first render when `initialContext` is present, call the matching `setSelectedAccount`, `setSelectedAlgoId`, and scroll to the anchor (if `scrollTo` is set).
- Render anchor divs with ids `positions`, `orders`, `history`, `stats` on the existing panels.
- Clear the context after consumption (managed by `App` — the prop is nulled after the first effect runs).

### `src/views/AlgosView.tsx` — accept initial instance

- Accept an optional `initialInstanceId?: string` prop.
- Replace the "auto-select first running algo" behavior with: if `initialInstanceId` is provided, select that instance + its chart. Otherwise preserve current auto-select.
- No layout change.

### `src/hooks/useTradingSimulation.ts` — no changes expected

The hook already exposes everything the home view needs: `stats`, `positions`, `pnlHistory`, `runPnlHistories` (keyed by `instance_id`), and `algoStats` (keyed by `instance_id`, with `totalPnl`, `winRate`, `totalTrades`, etc.). The home view reads these as-is. No hook changes are expected; if the implementation phase finds a gap, it is scoped to a single derived field and not a structural change.

### Styling

All styling uses existing Tailwind + CSS variables from `src/styles.css` (`--bg-primary`, `--bg-panel`, `--border`, `--text-secondary`, `--accent-green`, `--accent-red`, `--accent-yellow`). One new accent: a subtle blue highlight for hover/click affordance on interactive cards. Added as a new CSS variable `--accent-blue` (if not already present) to keep the design system consistent.

The hero KPI value uses a slightly tighter letter-spacing (`-0.01em`) for a more modern feel. No new fonts.

### Charting

Uses the existing `uplot` + `uplot-react` dependencies. The chart reuses the same data shape as the Trading view's P&L chart, wrapped in a local component `<SessionPnlChart>` inside `HomeView.tsx`. The component takes `pnlHistory`, `runPnlHistories`, `activeRuns`, and `visibleInstanceIds` (local state for legend toggling).

## Data Flow

```
useTradingSimulation ──► { stats, positions, pnlHistory, runPnlHistories, algoStats }
                         │
                         ▼
                       App ──► HomeView (read)
                         │         │
                         │         └─ user clicks ──► onNavigate(view, options)
                         │
                         └─ handleNavigate:
                              setPendingNavContext(options)
                              setActiveView(view)
                                   │
                                   ▼
                             TradingView / AlgosView
                             reads pendingNavContext on mount,
                             applies filter + scrolls, then clears it
```

No new backend events, no new Tauri invokes, no new DB work.

## Empty States & Edge Cases

| Condition | Behavior |
|---|---|
| No accounts | Account strip shows "No accounts connected" placeholder instead of cards. |
| Accounts but no runs | KPI row shows `$0.00 / — / 0 / 0`. Chart shows flat baseline + "No session activity yet". Tape shows "No algos running" copy. Performance stats render `—`. |
| More than 4 accounts | Account strip scrolls horizontally rather than stacking. Visual: cards keep min width, overflow-x is auto. |
| More than ~10 running algos | Tape becomes vertically scrollable within its panel (fixed max-height). |
| Chart legend — all algos hidden | Only "Total" line remains. "Total" cannot be hidden. |
| Connection error | Page header status dot + text go red. Rest of the view continues to render whatever state it has. |
| Navigation into Trading with a filter that has no data | Trading view renders its existing empty state — no special-case needed. |

## Out of Scope (v1)

- Time-range switching beyond "Today" (segments render but only Today is wired in v1).
- Per-algo toggles affecting KPI values (KPIs always reflect all runs — legend toggles only affect the chart).
- Dashboard customization, reordering sections, saved layouts.
- Historical session P&L (Week / MTD require persistence beyond the current in-memory simulation).
- Mobile / narrow-viewport treatment (Tauri desktop app; assume ≥1024px width).
- New stats or metrics.

## Open Questions

None at spec time — all decisions resolved during brainstorming.

## Acceptance Criteria

- `HomeView` renders the four sections in order, preserves all empty states, and matches the layout shown in the approved mockup.
- Every clickable region described in the click map navigates to the correct view with the correct filter applied.
- Stopping an algo from the tape inline works without navigating away.
- The hero chart renders "Total" + one line per running algo, legend toggles lines, and defaults to "Today" range.
- No regressions in the Trading, Algos, or Editor views (they continue to work with no `initialContext` / `initialInstanceId`).
- KPI values match what the old stats section displayed for the same inputs (data parity).

# Trading View Redesign — Design

**Date:** 2026-04-19
**Direction:** Unified dashboard — pinned hero + filter bar, four scrollable tabs (Live / Performance / Analytics / Trades), drill-down panel for per-trade detail
**Brainstorm artifacts:** `.superpowers/brainstorm/` (wireframes generated during brainstorming; not committed)

## Summary

Replace today's single-surface TradingView (mode toggle + chart/account/algo filters, P&L hero, one equity chart, positions table, orders table) with a unified dashboard designed to serve both the "live monitor" and "performance analytics" mental models without a mode switch. A pinned hero (KPIs + equity curve with drawdown overlay) and a global Chart/Account/Algo filter bar remain visible at all times. Four tabs below group the rest: **Live** (open position cards, risk/exposure summary, order tape), **Performance** (per-algo, per-symbol, per-account breakdowns, live-vs-shadow delta), **Analytics** (trade P&L distribution, hour×day heatmap, rolling metrics), and **Trades** (roundtrips table with a right-side drill-down panel showing execution and MAE/MFE). The live/shadow mode toggle is removed; shadow data renders inline tagged with a `Shadow` pill, and the dedicated live-vs-shadow delta module in Performance makes the comparison direct.

The work extends the simulation layer additively. `useTradingSimulation` keeps its existing outputs intact (`HomeView` and `AlgosView` depend on them). Three new sibling hooks sit alongside it: `useTradeHistory` (roundtrip pairing + per-{algo,symbol,account} aggregates + distribution + heatmap buckets), `useEquityTimeline` (timestamped equity + drawdown derivation), and `useRollingMetrics` (windowed Sharpe / win% / expectancy). Only `TradingView` consumes the new hooks. MAE/MFE are derived by sampling `position.unrealized_pnl` while a position is open. All data flows from events today's hook already listens to — no backend, Rust, or Tauri-command changes.

## Goals

- One surface, two jobs — live monitoring and performance analytics coexist without a mode switch.
- Pinned hero — KPIs + equity + drawdown are always visible while the rest scrolls or switches tabs.
- Depth per module — each of 13 modules renders real per-trade data (not derived from a `{pnl}`-only stub).
- Drill-through — click any roundtrip for execution and excursion detail without leaving the tab.
- Consistent filters — Chart / Account / Algo apply globally; every panel agrees.
- Incremental composition — new sibling hooks follow the `useAlgoErrors` / `useAlgoLogs` / `useAlgoHealth` pattern; no new cross-cutting abstractions.
- Surgical refactor — no backend / Rust / Tauri-command / event-schema changes; PRable as one unit.

## Non-Goals

- Instrument price chart with execution overlay (module N from brainstorm) — deferred.
- Journal / annotations (module O) — deferred.
- Persisting tab, filters, or window selections across app restarts — in-memory only, matching Algos view precedent.
- Keyboard shortcuts / command palette — deferred to an app-wide project.
- Multi-select or bulk row actions — deferred.
- Mobile / narrow-viewport responsiveness — Tauri desktop app, assume ≥1100px width.
- Changes to `NavOptions` or cross-view navigation contract — reuse `onNavigate` as-is.
- Changes to the NinjaTrader bridge, Rust side, Tauri commands, or event payload shapes.
- Historical import of completed trades on app start — the new hooks build history from events received this session. Hot-reload during development is the only scenario that loses history; a cold start has none either way.

## Scope

### In scope

- Rewrite of `src/views/TradingView.tsx` into an orchestrator (filter bar + hero + tabs + detail panel).
- New view-layer components (listed below under Architecture).
- Hook additions (additive only — `useTradingSimulation` output contract is unchanged):
  - `src/hooks/useTradeHistory.ts` — new, owns roundtrip pairing and aggregate breakdowns.
  - `src/hooks/useEquityTimeline.ts` — new, owns timestamped equity series and drawdown derivation.
  - `src/hooks/useRollingMetrics.ts` — new, owns windowed metric series.
- New pure helpers:
  - `src/lib/tradingView.ts` — filter/aggregate/bucketing helpers.
  - `src/lib/roundtrips.ts` — fill-to-roundtrip pairing and MAE/MFE derivation.
- Replacement of the inline `PnlChart` canvas inside `TradingView.tsx` with an extracted `EquityChart` component that also draws the drawdown overlay.
- Deletion of the mode-toggle state, `tradingMode`, and all branches keyed on it.
- `App.tsx` wiring: compose the new hooks and hand their outputs into `TradingView` alongside the existing simulation surface.

### Out of scope

- Other views (Home, Editor, Algos, Guide) — untouched.
- `AiTerminalPanel`, `LogPanel`, `Sidebar`, `TitleBar` — untouched.
- `useAlgoErrors`, `useAlgoLogs`, `useAlgoHealth` — untouched.
- NinjaTrader bridge / Rust / Tauri commands — untouched.
- Event payload contracts (`nt-position`, `nt-order-update`, `nt-account`, `nt-chart`, `nt-chart-removed`) — untouched.

## Architecture

### File layout

```
src/
  hooks/
    useTradingSimulation.ts     [unchanged] — HomeView / AlgosView continue to consume it as-is
    useTradeHistory.ts          [new]     — roundtrips + per-{algo,symbol,account} aggregates + distribution + heatmap buckets
    useEquityTimeline.ts        [new]     — timestamped equity (live + shadow) + drawdown series
    useRollingMetrics.ts        [new]     — windowed Sharpe / win% / expectancy
  lib/
    tradingView.ts              [new]     — filter/aggregate helpers
    roundtrips.ts               [new]     — fill pairing + MAE/MFE derivation
  components/
    TradingFilterBar.tsx        [new]
    TradingHero.tsx             [new]     — KPIs + EquityChart
    TradingTabs.tsx             [new]     — tab bar
    EquityChart.tsx             [new]     — replaces inline PnlChart; adds DD overlay
    LiveTab.tsx                 [new]
    RiskSummary.tsx             [new]
    PositionCard.tsx            [new]
    OrderTape.tsx               [new]
    PerformanceTab.tsx          [new]
    BreakdownTable.tsx          [new]     — shared for by-algo / by-symbol / by-account
    LiveShadowDelta.tsx         [new]
    AnalyticsTab.tsx            [new]
    TradeDistribution.tsx       [new]
    SessionHeatmap.tsx          [new]
    RollingMetricsChart.tsx     [new]
    TradesTab.tsx               [new]
    RoundtripsTable.tsx         [new]
    TradeDetailPanel.tsx        [new]     — right-side drill-down
  views/
    TradingView.tsx             [rewrite] — orchestrator + local UI state
```

`App.tsx` composes the new hooks alongside `useTradingSimulation` and passes their outputs into `TradingView`. The view's props expand but remain explicit (no shared context).

### Hook responsibilities

| Hook | Subscribes to | Owns | Emits |
|---|---|---|---|
| `useTradingSimulation` | unchanged | Live positions, orders, untimestamped `pnlHistory` / `runPnlHistories`, `algoStats`, `stats`, `shadowStats` — as today | unchanged — consumed by HomeView / AlgosView as-is, and by TradingView for live positions / orders / accounts |
| `useTradeHistory` | `nt-position` (for pairing + unrealized-P&L sampling), `nt-order-update` (for fill prices / times), `nt-chart-removed` | `Roundtrip[]` (cap 1000), per-algo/symbol/account aggregates, distribution buckets, hour×day buckets | `roundtrips`, `byAlgo`, `bySymbol`, `byAccount`, `liveVsShadow`, `distribution`, `heatmap` |
| `useEquityTimeline` | `nt-account`, roundtrip closes from `useTradeHistory` | Timestamped equity per series (`live`, `shadow`), running peak + underwater series | `{ live: EquityPoint[], shadow: EquityPoint[], drawdown: DrawdownPoint[] }` |
| `useRollingMetrics` | `roundtrips` (from `useTradeHistory`) | Windowed derivation (default window = 20 trades) | `{ sharpe: number[], winRate: number[], expectancy: number[] }` + the roundtrip-close timestamps for x-axis labelling |

Both `useTradingSimulation` and `useTradeHistory` subscribe to the same `nt-position` / `nt-order-update` event stream; they maintain independent state, which is fine — React event listeners are cheap, and keeping state independent preserves the hook's focused responsibility.

`useTradeHistory` sources `algo` and `instanceId` by joining `algoId` / `instance_id` against the `algos` and `activeRuns` the view receives — the same join `useTradingSimulation` performs inside `computeStats` today.

### Raw data → enriched roundtrip

`useTradingSimulation` today tracks per-position unrealized P&L via `positionPnlRef` and records a `{ pnl }` entry into its internal `completedTrades` on position flat. `useTradeHistory` runs the same pattern independently with a richer record — the two do not share state:

- On the first `nt-position` for a `posKey` with a non-zero qty, record `openTimestamp` (now), `entryPrice` (`p.avg_price`), `side`, `qty`, `symbol`, `account`, `dataSourceId`, and the matching algo/instance from `activeRuns`.
- While the position is open, maintain `mae` (most-negative unrealized P&L seen) and `mfe` (most-positive). Sample via a ~250ms RAF tick bound to the position being open; reset on flat.
- On position flat, record `closeTimestamp`, `exitPrice` (last known `avg_price` before flat, or last fill from `nt-order-update`), `pnl` (the final `unrealized_pnl` observed just before the flat event), and close out the MAE/MFE sampling.
- Push a `Roundtrip` record into the history (cap 1000). Emit the same downstream aggregates the tab panels consume.

`Roundtrip` shape:

```ts
type Roundtrip = {
  id: string;                 // generated — "<posKey>-<openTs>"
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  openTimestamp: number;      // ms epoch
  closeTimestamp: number;     // ms epoch
  pnl: number;
  mae: number;                // worst unrealized P&L during hold
  mfe: number;                // best unrealized P&L during hold
  rMultiple: number | null;   // (pnl / |mae|) when mae !== 0, else null
  algo: string;
  algoId: number;
  account: string;
  dataSourceId: string;
  instanceId: string;
  isShadow: boolean;          // account === "shadow"
  maeMfeSamples: { t: number; pnl: number }[]; // for drill-down chart (capped per roundtrip to 200 samples)
};
```

### Pure helpers

**`src/lib/tradingView.ts`**

- `applyFilters(items, { chart, account, algo })` — narrows any keyed collection (`{ dataSourceId, account, algoId }`) to the active filters. Used by hero aggregates, tab panels, and the drill-down panel.
- `aggregateByKey<Key>(roundtrips, keyOf)` — groups and aggregates to `{ key, count, pnl, winRate, avgWin, avgLoss, sharpe, profitFactor, sparkline }`. Used by BreakdownTable for algo / symbol / account variants.
- `pairLiveShadow(byAlgo)` — pairs a live algo's aggregate with its matching shadow aggregate (same algo name across the live and shadow account); returns `{ live, shadow, delta, slippageEstimate }` per algo.
- `buildDistribution(roundtrips, bucketCount)` — histogram buckets keyed by P&L bins; fixed bucketCount default 12.
- `buildHeatmap(roundtrips)` — 7×24 grid of `{ trades, pnl, winRate }`, using close timestamp.
- `deriveHeroKpis(filteredRoundtrips, accounts, positions)` — Realized / Unrealized / Total / WinRate / Trades / Sharpe / MaxDD in one pass.

**`src/lib/roundtrips.ts`**

- `pairFillsToRoundtrip(fills, positionEvents)` — exported for use by `useTradeHistory` and unit-testable independently. Pairs fills between consecutive flat events.
- `deriveMaeMfe(samples)` — pure reducer over `{ t, pnl }` samples to produce `{ mae, mfe }`.

All helpers are pure, independently testable, and free of React.

### `TradingView.tsx` responsibilities

Local `useState`:

- `filters: { chart: string | null; account: string | null; algo: number | null }` — default all `null`.
- `activeTab: "live" | "performance" | "analytics" | "trades"` — default `"live"`.
- `selectedRoundtripId: string | null` — drives the drill-down panel.
- `rollingWindow: { size: number; metric: "sharpe" | "winRate" | "expectancy" }` — default `{ size: 20, metric: "sharpe" }`.

`useMemo`-backed derived state (keyed on filters + hook outputs):

- `filteredRoundtrips`, `filteredPositions`, `filteredOrders`, `filteredEquity`, `filteredDrawdown`.
- `heroKpis`.

The view orchestrates layout only; panels render their own data.

Existing inbound nav (`initialContext`) continues to work:
- `accountFilter` → sets `filters.account`.
- `algoFilter` → sets `filters.algo`.
- `scrollTo`:
  - `"positions"` → switch to Live tab, scroll to position cards.
  - `"orders"` / `"history"` → Live tab for live-session orders, Trades tab for completed roundtrips (if the nav was triggered from a historical context, tail to Trades; otherwise Live).
  - `"stats"` → scroll hero into view (noop when hero is pinned and already in view).

### Filter behavior

Filters are global to the view. Each filter is independent; combining narrows the set. With any filter active:

- Hero KPIs recompute from the narrowed roundtrip set (realized + current unrealized for currently-matching open positions).
- Equity chart plots the sum of matching run equity series; when no runs match, shows a flat zero line.
- Live tab: only matching cards / orders show; "No matching open positions" / "No matching orders" inline states render per panel.
- Performance tab: breakdowns narrow; rows that don't match are hidden.
- Analytics tab: distribution / heatmap / rolling metrics narrow.
- Trades tab: roundtrips narrow.

Clearing all filters returns every panel to the aggregate.

### Shadow handling (no mode toggle)

- Shadow positions, orders, and roundtrips render inline in every tab, tagged with a `Shadow` pill (yellow tone, matching today's visual language for shadow mode).
- Equity chart overlays two series:
  - Live — solid line, green/red below/above zero (matching today).
  - Shadow — dashed line, same coloring.
- Hero KPIs aggregate live + shadow by default when the `account` filter is `null`. When the filter is set to `"shadow"` or a live account, the hero narrows accordingly.
- `LiveShadowDelta` (Performance tab module G) explicitly pairs each algo's live aggregate with its shadow aggregate (when both exist) and shows the delta + a crude slippage estimate (`(liveAvgTrade - shadowAvgTrade)`).

### Drill-down panel (Trades tab)

- Right-side, 42% of the tab content width, overlays the roundtrips table (table stays scrollable on the left).
- Opens on row click; closes on Esc, close button, or clicking another row to replace.
- Contents: header (symbol, side, time range, algo, account, shadow pill if applicable), KPI row (P&L, R multiple, duration), Execution (entry + exit price / time), Excursion (MAE, MFE timestamps and values), per-tick unrealized P&L chart from the captured `maeMfeSamples`.
- Never covers the pinned hero / filter bar / tab bar.

### Visual language

- Colors use existing CSS variables (`--bg-primary`, `--bg-panel`, `--bg-secondary`, `--border`, `--text-primary`, `--text-secondary`, `--accent-blue`, `--accent-green`, `--accent-yellow`, `--accent-red`).
- Pills, chips, and dot indicators match today's conventions.
- Equity chart keeps today's step-line style; drawdown overlays as a muted-red band beneath the zero line using the underwater-curve technique.
- Sparklines in breakdown tables use the same style as HomeView / AlgosView sparklines.
- Row heights are compact: tables ~32px, cards ~72–96px.

## Empty states

| Situation | Rendering |
|---|---|
| No charts connected | Hero dims; filter bar collapses to label only; tab area shows "Connect a NinjaTrader chart to see trading activity." (matches the copy used elsewhere in the app.) |
| Charts but no runs / no trades yet | Hero KPIs zero; equity is flat; Live tab: "No open positions or orders yet"; Performance: "No completed trades yet — breakdowns appear after your first roundtrip"; Analytics: same; Trades: same. |
| Filters exclude everything in the active tab | Inline "No data matches these filters · Clear filters" inside the tab panel. |
| No roundtrip selected (Trades tab) | Drill panel shows a subtle "Click a roundtrip to see execution detail"; roundtrips table takes full width. |

## User flows

### Monitor while trading

1. Open Trading view → Live tab shows open positions as cards with running P&L, hold time, mini trend; order tape fills under them; risk strip sits above.
2. Equity + drawdown pinned at top update in real time.
3. Filters (Chart / Account / Algo) narrow every panel together.
4. Switch to Performance or Analytics tab mid-session to check which algo / symbol is carrying, without losing the hero band.

### Review a session

1. After market close, open Trading view → hero shows final KPIs + full equity + drawdown.
2. Performance tab: skim per-algo / per-symbol / per-account breakdowns; identify the problem algo.
3. Analytics tab: distribution histogram confirms fat-tail losers; heatmap shows which session hours were profitable; rolling Sharpe confirms trend.
4. Trades tab: click a bad roundtrip → drill-down shows entry/exit and how far the position drifted before closing.

### Compare live to shadow

1. Performance tab → Live vs. Shadow module: each algo with a shadow sibling is paired; Δ column shows live − shadow P&L.
2. Clicking a row applies `{ algo: algoId }` to the global filter so every other panel narrows to that algo's live + shadow data.

### Follow-through from another view

1. In Algos view, click "View trades" on an instance → `onNavigate("trading", { accountFilter: "Sim101", scrollTo: "positions" })`.
2. Trading view initializes with account filter applied, activates Live tab, scrolls to the position cards.

## Testing strategy

The project has no test runner configured. Verification follows the Home / Editor / Algos redesign convention:

- **Type-check:** `npx tsc --noEmit` clean after each task.
- **Manual smoke** against `npm run dev`:
  - Hero KPIs + equity + drawdown render from initial state (flat zero) and after first fills.
  - Start a live algo → Live tab: position card appears; order tape updates; hero KPIs update; equity chart appends points.
  - Start a shadow algo → second card with Shadow pill; equity gains dashed shadow series; roundtrip on close tagged shadow.
  - Close a live position → roundtrip appears in Trades tab; per-algo / per-symbol / per-account rows update in Performance; Analytics distribution + heatmap gain a point; rolling metrics update.
  - Click a roundtrip row → detail panel opens with execution, MAE/MFE, and per-tick unrealized P&L chart.
  - Filter bar: each filter reshapes every panel consistently; combining filters composes; "No data matches" appears at narrow settings; clearing returns to aggregate.
  - Tab switching does not reset filters or selection.
  - Rolling-metrics tab: Sharpe / Win% / Expectancy toggle re-renders in place.
  - Deep-link in from Algos view lands in the right tab and scrolls to the anchor.
  - Deep-link out (Performance row "open in editor" / "view algos") invokes `onNavigate` with the expected options.
  - Chart removal (NinjaTrader disconnect) prunes matching live state; completed roundtrips persist in history.

Pure helpers in `src/lib/tradingView.ts` and `src/lib/roundtrips.ts` are designed to be verifiable by inspection and via the manual cases above. Unit tests, when added, slot in cleanly.

## Implementation notes

- `App.tsx` composes the new hooks the same way it composes the existing ones and fans their outputs into `TradingView` as new props. The existing `simulation` prop to `TradingView`, `HomeView`, and `AlgosView` is unchanged.
- Reuse `useEquityTimeline` in the hero's `EquityChart` — the drawdown overlay reads from the same series; no secondary computation in the chart component.
- `useTradeHistory` and `useTradingSimulation` must not race: the roundtrip-close-triggered equity update and the `nt-account` realized-P&L update can arrive in either order. `useEquityTimeline` resolves by keying on timestamp and using the most-recent account snapshot when one arrives.
- MAE/MFE sampling uses a single shared `requestAnimationFrame` loop inside `useTradeHistory`, throttled by a ~250ms accumulator — only one RAF is alive regardless of how many positions are open.
- `useTradeHistory` caps `maeMfeSamples` per roundtrip at 200 points; samples are decimated by time, not count, so longer holds don't skip later ticks.
- Empty-state copy is explicit — no "--" fallbacks in places a user might mistake for a zero.
- All new components keep props explicit (no shared context) so each is independently testable.
- Props on `TradingView` expand (new hook outputs flow in) but do not break the existing `initialContext` / `onContextConsumed` surface.

## Risks & open questions

- **Partial fills and multi-leg positions.** Pairing must tolerate scale-in / scale-out (partial qty across multiple fills between flats). Pairing is anchored on flat events: every fill since the previous flat contributes to the current roundtrip. Average entry/exit prices are weighted by qty. Confirmed achievable from `nt-order-update` + `nt-position` alone; no new backend signal needed.
- **Event ordering on fast markets.** NinjaTrader may emit `nt-position` flat before the closing fill arrives on `nt-order-update`. Mitigation: buffer the most recent fills and resolve on the next flat event. Worst case is a one-tick-late close price on a roundtrip — acceptable.
- **Shadow slippage estimate.** `liveAvg − shadowAvg` is crude; anything more requires paired trade IDs the bridge does not expose. Ship the crude estimate and label it clearly ("est.").
- **Rolling metrics window with sparse trades.** Early in a session the window is smaller than the target size. Show partial-window values with an indicator ("n/20 trades") rather than hiding.
- **Drawdown overlay visual clarity.** Overlaid on the same axis as equity, the DD band can muddy the line at small scales. Implementation plan to validate this during layout and add a subtle separator / secondary axis if needed.
- **`useTradingSimulation` output contract is unchanged, by choice.** HomeView and AlgosView consume its `pnlHistory` / `runPnlHistories` / `algoStats` / `stats` today. Keeping the hook's outputs stable avoids cascading changes into those views. The tradeoff is two hooks subscribing to the same `nt-position` / `nt-order-update` streams (each maintaining independent state) — acceptable. A future cleanup pass can consolidate once `useEquityTimeline` is the preferred equity source across all views.
- **Duplicated event subscriptions.** `useTradingSimulation` and `useTradeHistory` both listen to `nt-position` / `nt-order-update`. Both must remain internally consistent with each other — e.g. when a position flips flat, both hooks should reach the same conclusion about the trade's final P&L. The risk is isolated to bugs in either hook; the event stream is the same.

## References

- Current implementation: `src/views/TradingView.tsx`, `src/hooks/useTradingSimulation.ts`
- Navigation contract: `src/types.ts` (`View`, `NavOptions`)
- Sibling-hook pattern: `src/hooks/useAlgoErrors.ts`, `src/hooks/useAlgoLogs.ts`, `src/hooks/useAlgoHealth.ts`
- Prior redesigns for style cues and format: `docs/superpowers/specs/2026-04-18-home-view-redesign-design.md`, `docs/superpowers/specs/2026-04-19-editor-view-redesign-design.md`, `docs/superpowers/specs/2026-04-19-algos-view-redesign-design.md`

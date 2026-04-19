# Home View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-column HomeView with a modern top-down layout (account strip → KPI row → hero P&L chart → active algos tape + grouped performance stats) and wire all clickable regions to deep-link into the Trading and Algos views with filters pre-applied.

**Architecture:** `HomeView.tsx` is rewritten in place. A new `NavOptions` type carries filter/scroll intent from clicks. `App.tsx` gains a `pendingNavContext` state plus a `handleNavigate(view, options?)` callback. `TradingView` and `AlgosView` accept optional `initialContext` / `initialInstanceId` props and apply them once on mount. The simulation hook is unchanged — it already exposes `pnlHistory`, `runPnlHistories`, `stats`, and `algoStats` (keyed by `instance_id`). All styling uses existing CSS variables in `src/styles.css` (no new design tokens).

**Tech Stack:** React 19, TypeScript, Tailwind 4, uPlot (for the hero chart), Tauri v2 (desktop shell — not touched in this plan).

**Spec reference:** `docs/superpowers/specs/2026-04-18-home-view-redesign-design.md`

**Reference mockup:** `.superpowers/brainstorm/47660-1776564034/content/blend-v2-clickmap.html`

---

## Verification conventions used in this plan

- Type check: `npx tsc --noEmit` (from repo root). Expected: no errors.
- Visual check: `npm run dev` starts Vite on http://localhost:5173 (or whatever Vite picks). Open the home view in a browser and verify the described visual state.
- Full integration (with real data from NinjaTrader) is only possible via `npm run tauri dev` with the NinjaTrader indicator running. Each task flags whether full integration is needed or whether visual verification without data is sufficient.

Commit style follows the repo convention (`type: subject`). Use `feat:` for this work. Do not use `--no-verify`.

---

### Task 1: Add `NavOptions` type and scaffold navigation plumbing in `App.tsx`

**Why:** Before changing any UI, set up the navigation state plumbing. This task introduces the state but doesn't touch any view yet. HomeView, TradingView, and AlgosView continue to render as they do today.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `NavOptions` type to `src/types.ts`**

Append to `src/types.ts`:

```typescript

export type NavOptions = {
  accountFilter?: string;
  algoFilter?: number;
  instanceId?: string;
  scrollTo?: "positions" | "orders" | "history" | "stats";
};

export type NavContext = NavOptions & { targetView: View };
```

- [ ] **Step 2: Import the new types in `App.tsx`**

In `src/App.tsx`, update the types import at the top of the file to include the new types:

```typescript
import type { Algo, AlgoRun, View, NavOptions, NavContext } from "./types";
```

(Replace the existing `import type { Algo, AlgoRun, View } from "./types";` line.)

- [ ] **Step 3: Add `pendingNavContext` state and `handleNavigate` callback**

Inside the `App` component, immediately after the `const [activeView, setActiveView] = useState<View>("home");` line, add:

```typescript
  const [pendingNavContext, setPendingNavContext] = useState<NavContext | null>(null);
```

Then replace the existing `handleNavigate` function with a version that accepts an optional `NavOptions` argument. Find the existing `const handleNavigate = (view: View) => {` block and change the signature and body to:

```typescript
  const handleNavigate = (view: View, options?: NavOptions) => {
    if (view === activeView && !options) return;
    if (activeView === "editor" && hasUnsavedChanges) {
      setConfirmDialog({
        message: "You have unsaved changes. Leave without saving?",
        confirmLabel: "Leave",
        onConfirm: () => {
          if (selectedAlgo) {
            setEditorCode(selectedAlgo.code);
            setEditorDeps(selectedAlgo.dependencies);
          }
          setPendingNavContext(options ? { ...options, targetView: view } : null);
          setActiveView(view);
          setConfirmDialog(null);
        },
      });
      return;
    }
    setPendingNavContext(options ? { ...options, targetView: view } : null);
    setActiveView(view);
  };
```

The `Sidebar` component still passes `onNavigate: (view: View) => void` — it calls `handleNavigate(view)` with no options. TypeScript accepts the narrower signature because extra parameters are optional.

- [ ] **Step 4: Add a helper to clear `pendingNavContext` after it's been consumed**

Immediately after the `handleNavigate` declaration add:

```typescript
  const clearPendingNavContext = useCallback(() => {
    setPendingNavContext(null);
  }, []);
```

(Make sure `useCallback` is in the `react` import at the top — it already is.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Smoke test the app still works**

Run: `npm run dev` and open the URL in a browser.
Expected: the app renders as before. Navigating between views via the sidebar still works. No visual change yet.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat: add NavOptions type and pendingNavContext plumbing

Why: prepare App for cross-view deep-linking from the new home view.
No UI change yet — handleNavigate now accepts optional filter/scroll
intent that will be passed to target views in upcoming commits.
EOF
)"
```

---

### Task 2: Accept `initialContext` in `TradingView` and add scroll anchors

**Why:** Deep-links from HomeView need to land on Trading with an account/algo filter pre-applied and optionally scroll to a specific panel. This task teaches `TradingView` how to consume that context.

**Files:**
- Modify: `src/views/TradingView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend `TradingViewProps` in `TradingView.tsx`**

Find the `type TradingViewProps = {` block near the top of the file and replace it with:

```typescript
import type { Algo, AlgoRun, NavContext } from "../types";

type TradingViewProps = {
  simulation: TradingSimulation;
  algos: Algo[];
  activeRuns: AlgoRun[];
  initialContext?: NavContext | null;
  onContextConsumed?: () => void;
};
```

(If the import line already imports from `../types`, just add `NavContext` to the existing import rather than writing a second import.)

- [ ] **Step 2: Accept the new props in the component signature**

Find the line `export const TradingView = ({ simulation, algos, activeRuns }: TradingViewProps) => {` and change it to:

```typescript
export const TradingView = ({ simulation, algos, activeRuns, initialContext, onContextConsumed }: TradingViewProps) => {
```

- [ ] **Step 3: Apply `initialContext` on mount / when it changes**

Add this effect inside the component, directly after the existing `useEffect` that clears `selectedAlgoId` when an algo stops running:

```typescript
  useEffect(() => {
    if (!initialContext || initialContext.targetView !== "trading") return;
    if (initialContext.accountFilter !== undefined) setSelectedAccount(initialContext.accountFilter);
    if (initialContext.algoFilter !== undefined) setSelectedAlgoId(initialContext.algoFilter);
    if (initialContext.scrollTo) {
      // defer one frame so the DOM has painted after the filter state update
      requestAnimationFrame(() => {
        const el = document.getElementById(`trading-anchor-${initialContext.scrollTo}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    onContextConsumed?.();
  }, [initialContext, onContextConsumed]);
```

- [ ] **Step 4: Add scroll anchors on the relevant panels**

The Trading view already has a "Top Row: P&L + Stats", a "Middle: Chart Area", and a "Bottom Row: Positions + Orders". Add an anchor div inside each of the three target regions. Find the comments in the JSX and add anchors:

Near `{/* Top Row: P&L + Stats */}` — add `<div id="trading-anchor-stats" />` as the first child of the outer top-row `div`.

Near `{/* Bottom Row: Positions + Orders */}` — add `<div id="trading-anchor-positions" />` as the first child of the Open Positions panel (the first of the two bottom-row children), and `<div id="trading-anchor-orders" />` as the first child of the Recent Orders panel.

Example — for the Open Positions panel change:

```typescript
        <div className="flex-1 bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
          <div id="trading-anchor-positions" />
          <div className="px-4 py-2.5 border-b border-[var(--border)]">
```

For the "history" anchor, the Trading view currently has no dedicated "history" section — it shows Recent Orders. Treat `scrollTo: "history"` as an alias for `"orders"`. Update the effect in Step 3 to translate:

```typescript
      requestAnimationFrame(() => {
        const scrollTarget = initialContext.scrollTo === "history" ? "orders" : initialContext.scrollTo;
        const el = document.getElementById(`trading-anchor-${scrollTarget}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
```

- [ ] **Step 5: Wire `initialContext` from `App.tsx` into `TradingView`**

In `src/App.tsx`, find the `{activeView === "trading" && (` block and change it to:

```typescript
      {activeView === "trading" && (
        <TradingView
          simulation={simulation}
          algos={algos}
          activeRuns={activeRuns}
          initialContext={pendingNavContext}
          onContextConsumed={clearPendingNavContext}
        />
      )}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual navigation test**

Run: `npm run dev` and open the browser.

Expected: the app still works. Clicking the sidebar to Trading still renders normally. `pendingNavContext` is always null for sidebar clicks, so the new effect short-circuits.

- [ ] **Step 8: Commit**

```bash
git add src/views/TradingView.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: accept initialContext in TradingView for deep-linking

Why: home view needs to pre-filter TradingView by account/algo and
optionally scroll to a specific panel. Anchors added for positions,
orders, and stats; "history" aliased to "orders".
EOF
)"
```

---

### Task 3: Accept `initialInstanceId` in `AlgosView` and prefer it over auto-select

**Why:** Clicking an active algo row on Home should land the user on Algos with that exact instance already focused, not whatever the auto-selector would pick.

**Files:**
- Modify: `src/views/AlgosView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend `AlgosViewProps` in `AlgosView.tsx`**

Find the `AlgosViewProps` type at the top of the file (around line 355). Add two new optional properties:

```typescript
  initialInstanceId?: string | null;
  onInstanceFocused?: () => void;
```

(Place them inside the existing type, keep all existing fields.)

- [ ] **Step 2: Accept the new props in the component signature**

Find `export const AlgosView = ({` and add `initialInstanceId` and `onInstanceFocused` to the destructure — e.g.:

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
  onClearLogs,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
  initialInstanceId,
  onInstanceFocused,
}: AlgosViewProps) => {
```

- [ ] **Step 3: Replace the "auto-select first running algo" effect**

Find the existing `useEffect(() => { if (hasAutoSelected) return; ...` block. Replace it with:

```typescript
  useEffect(() => {
    if (hasAutoSelected) return;
    if (initialInstanceId) {
      const run = activeRuns.find((r) => r.instance_id === initialInstanceId);
      if (run) {
        setSelectedChartId(run.data_source_id);
        setSelectedInstanceId(run.instance_id);
      }
      // mark consumed + notify App even if the instance wasn't found,
      // so stale context doesn't leak into the next navigation
      setHasAutoSelected(true);
      onInstanceFocused?.();
      return;
    }
    const firstRunning = activeRuns.find((r) => r.status === "running");
    if (firstRunning) {
      setSelectedChartId(firstRunning.data_source_id);
      setSelectedInstanceId(firstRunning.instance_id);
      setHasAutoSelected(true);
    }
  }, [activeRuns, hasAutoSelected, initialInstanceId, onInstanceFocused]);
```

- [ ] **Step 4: Wire `initialInstanceId` from `App.tsx` into `AlgosView`**

In `src/App.tsx`, find the `{activeView === "algos" && (` block and add the two new props:

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
          onClearLogs={clearLogs}
          onOpenAiTerminal={handleOpenAiTerminal}
          aiTerminalAlgoIds={aiTerminalAlgoIds}
          initialInstanceId={pendingNavContext?.targetView === "algos" ? pendingNavContext.instanceId : null}
          onInstanceFocused={clearPendingNavContext}
        />
      )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Smoke test**

Run: `npm run dev` and navigate to the Algos view. Expected: works exactly as before when no `initialInstanceId` is provided.

- [ ] **Step 7: Commit**

```bash
git add src/views/AlgosView.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: accept initialInstanceId in AlgosView for deep-linking

Why: home view's active-algo rows need to land the user on Algos
with that exact instance focused. Falls back to the existing
first-running auto-select when no instance is provided.
EOF
)"
```

---

### Task 4: Rewrite `HomeView` scaffolding (compact header + empty section shells)

**Why:** Replace the old HomeView file with a new skeleton that matches the target layout. This task lands the new file and new prop contract without any real content — each subsequent task fills in one section. This keeps every commit small and verifiable.

**Files:**
- Modify: `src/views/HomeView.tsx` (full rewrite)
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace `src/views/HomeView.tsx` with the new skeleton**

Overwrite the entire file with:

```typescript
import type { Algo, AlgoRun, NavOptions, View } from "../types";
import type { AlgoStats } from "../hooks/useTradingSimulation";

type Position = {
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  avgPrice: number;
  pnl: number;
  targetPnl: number;
  algo: string;
  algoId: number;
  account: string;
};

type SessionStats = {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  maxDrawdown: number;
  sharpe: string;
  profitFactor: string;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  openPositions: number;
  avgTradeDuration: string;
  consecutiveWins: number;
  consecutiveLosses: number;
};

type AccountData = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

type HomeViewProps = {
  connectionStatus: "waiting" | "connected" | "error";
  accounts: Record<string, AccountData>;
  algos: Algo[];
  activeRuns: AlgoRun[];
  stats: SessionStats;
  positions: Position[];
  pnlHistory: number[];
  runPnlHistories: Record<string, number[]>;
  algoStats: Record<string, AlgoStats>;
  onNavigate: (view: View, options?: NavOptions) => void;
  onStopAlgo: (instanceId: string) => void;
};

export const HomeView = (_props: HomeViewProps) => {
  return (
    <div className="flex-1 flex flex-col overflow-auto bg-[var(--bg-primary)]">
      <div className="max-w-[1400px] w-full mx-auto p-5 flex flex-col gap-4">
        {/* Section 0: Compact header — filled in Task 4 step 3 */}
        <div id="home-section-header" />

        {/* Section 1: Account strip — filled in Task 5 */}
        <div id="home-section-accounts" />

        {/* Section 2: KPI row — filled in Task 6 */}
        <div id="home-section-kpis" />

        {/* Section 3: Hero P&L chart — filled in Task 7 */}
        <div id="home-section-chart" />

        {/* Section 4: Bottom split (algos tape + performance) — filled in Tasks 8 & 9 */}
        <div id="home-section-bottom" className="grid grid-cols-3 gap-4">
          <div id="home-section-algos" className="col-span-2" />
          <div id="home-section-performance" className="col-span-1" />
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Update `App.tsx` to pass the new props**

In `src/App.tsx`, find the `{activeView === "home" && (` block and replace the entire `HomeView` element with:

```typescript
      {activeView === "home" && (
        <HomeView
          connectionStatus={connectionStatus}
          accounts={accounts}
          algos={algos}
          activeRuns={activeRuns}
          stats={simulation.stats}
          positions={simulation.positions}
          pnlHistory={simulation.pnlHistory}
          runPnlHistories={simulation.runPnlHistories}
          algoStats={simulation.algoStats}
          onNavigate={handleNavigate}
          onStopAlgo={handleStopAlgo}
        />
      )}
```

- [ ] **Step 3: Fill in the compact header (Section 0)**

Back in `src/views/HomeView.tsx`, replace the placeholder `<div id="home-section-header" />` with a compact header. First, add helper values inside the component body (above the `return`):

```typescript
  const accountCount = Object.keys(_props.accounts).length;
  const runningCount = _props.activeRuns.length;
  const connectionLabel =
    _props.connectionStatus === "connected"
      ? `Connected to NinjaTrader · ${accountCount} account${accountCount === 1 ? "" : "s"} · ${runningCount} algo${runningCount === 1 ? "" : "s"} running`
      : _props.connectionStatus === "error"
        ? "Connection error"
        : "Waiting for NinjaTrader…";
  const statusColor =
    _props.connectionStatus === "connected"
      ? "bg-[var(--accent-green)]"
      : _props.connectionStatus === "error"
        ? "bg-[var(--accent-red)]"
        : "bg-[var(--accent-yellow)] animate-pulse";
```

Then replace the `<div id="home-section-header" />` with:

```tsx
        <div id="home-section-header" className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Wolf Den</h1>
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span>{connectionLabel}</span>
          </div>
        </div>
```

- [ ] **Step 4: Rename `_props` back to `props` now that it's used**

Change the component signature from `(_props: HomeViewProps)` to `(props: HomeViewProps)` and replace `_props.` with `props.` in the helper values added in Step 3. (Leaving `_props` when it's actually used would be a stale lint suggestion.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Visual verification**

Run: `npm run dev` and open the home view. Expected: the page shows "Wolf Den" with a connection status line, a centered content column with up to 1400px width, and empty space below. No crash. Sidebar navigation still works.

- [ ] **Step 7: Commit**

```bash
git add src/views/HomeView.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: rewrite HomeView skeleton with new prop contract

Why: prepare for the full redesign by landing the new layout shell
and prop surface (pnlHistory, runPnlHistories, algoStats, onNavigate,
onStopAlgo). Sections are empty placeholders for now; Section 0
(compact header) is wired.
EOF
)"
```

---

### Task 5: Implement the account strip (Section 1)

**Why:** First real section. Gets the horizontal account cards rendering, plus the first working deep-link: clicking an account card navigates to Trading with that account pre-filtered.

**Files:**
- Modify: `src/views/HomeView.tsx`

- [ ] **Step 1: Add formatting helpers and local `AccountCard` component**

At the bottom of `src/views/HomeView.tsx` (below the `HomeView` export), add:

```typescript
const formatPnl = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const pnlColorClass = (value: number): string =>
  value > 0 ? "text-[var(--accent-green)]" : value < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]";

type AccountCardProps = {
  name: string;
  balance: number;
  dayPnl: number;
  positionCount: number;
  isActive: boolean;
  onClick: () => void;
};

const AccountCard = ({ name, balance, dayPnl, positionCount, isActive, onClick }: AccountCardProps) => (
  <button
    onClick={onClick}
    className="group text-left p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--accent-blue)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
  >
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[var(--accent-green)]" : "bg-[var(--border)]"}`} />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase text-[var(--text-secondary)] tracking-wider">NinjaTrader</span>
        <span className="text-[var(--accent-blue)] text-sm opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Balance</div>
        <div className="text-sm font-medium">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Day P&L</div>
        <div className={`text-sm font-medium ${pnlColorClass(dayPnl)}`}>{dayPnl !== 0 ? formatPnl(dayPnl) : "$0.00"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Positions</div>
        <div className="text-sm font-medium">{positionCount}</div>
      </div>
    </div>
  </button>
);
```

- [ ] **Step 2: Add derived-data helpers inside `HomeView`**

Inside the `HomeView` component (above the `return`), add:

```typescript
  const accountNames = Object.keys(props.accounts);
  const accountPositionCount = (accountName: string) =>
    props.positions.filter((p) => p.account === accountName).length;
  const accountLivePnl = (accountName: string) =>
    props.positions.filter((p) => p.account === accountName).reduce((sum, p) => sum + p.targetPnl, 0);
  const accountIsActive = (accountName: string) =>
    props.activeRuns.some((r) => r.account === accountName);
```

- [ ] **Step 3: Replace the `home-section-accounts` placeholder**

Replace the `<div id="home-section-accounts" />` line with:

```tsx
        <div id="home-section-accounts">
          {accountNames.length === 0 ? (
            <div className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)] text-sm text-[var(--text-secondary)]">
              No accounts connected
            </div>
          ) : (
            <div className={`grid gap-3 ${accountNames.length >= 4 ? "grid-cols-4 overflow-x-auto" : `grid-cols-${accountNames.length}`}`}>
              {accountNames.map((name) => {
                const data = props.accounts[name];
                const balance = data.cash || data.buying_power;
                const dayPnl = data.realized_pnl + accountLivePnl(name);
                return (
                  <AccountCard
                    key={name}
                    name={name}
                    balance={balance}
                    dayPnl={dayPnl}
                    positionCount={accountPositionCount(name)}
                    isActive={accountIsActive(name)}
                    onClick={() => props.onNavigate("trading", { accountFilter: name })}
                  />
                );
              })}
            </div>
          )}
        </div>
```

Note: Tailwind 4 can prune dynamic class names. If `grid-cols-1` / `grid-cols-2` / `grid-cols-3` don't render correctly, replace the dynamic expression with a switch:

```tsx
              <div className={`grid gap-3 ${
                accountNames.length === 1 ? "grid-cols-1" :
                accountNames.length === 2 ? "grid-cols-2" :
                accountNames.length === 3 ? "grid-cols-3" :
                "grid-cols-4 overflow-x-auto"
              }`}>
```

Prefer the switch form to be safe.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Visual verification**

Run: `npm run dev`. Home view should show account cards (if any accounts are connected via Tauri) or a "No accounts connected" placeholder. Each card shows a status dot, name, balance, day P&L, and position count. Hover highlights the border in blue and reveals a → arrow on the right.

For the data-present case you'll need `npm run tauri dev` with NinjaTrader running. The empty state is sufficient for this task's visual check.

- [ ] **Step 6: Click test (requires Tauri + NinjaTrader, or postpone to Task 10)**

If Tauri is running: click any account card. Expected: switches to Trading view with that account selected in the filter row.

If no Tauri session is available, defer this verification to Task 10 (final integration). Add a checkbox note and move on.

- [ ] **Step 7: Commit**

```bash
git add src/views/HomeView.tsx
git commit -m "$(cat <<'EOF'
feat: account strip on home view with trading deep-link

Why: first section of the home redesign. Horizontal account cards
show balance, day P&L, and positions. Clicking a card opens the
Trading view filtered by that account.
EOF
)"
```

---

### Task 6: Implement the KPI row (Section 2)

**Why:** Four big scannable KPI cards replace the old middle column's flat stat list. Each KPI is clickable and navigates to its corresponding deep-dive.

**Files:**
- Modify: `src/views/HomeView.tsx`

- [ ] **Step 1: Add the `KpiCard` component at the bottom of the file**

Below `AccountCard` add:

```typescript
type KpiCardProps = {
  label: string;
  value: string;
  valueColor?: string;
  detail?: string;
  sparkline?: number[];
  onClick: () => void;
};

const KpiCard = ({ label, value, valueColor, detail, sparkline, onClick }: KpiCardProps) => (
  <button
    onClick={onClick}
    className="group relative text-left p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--accent-blue)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer overflow-hidden"
  >
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">{label}</span>
      <span className="text-[var(--accent-blue)] text-sm opacity-0 group-hover:opacity-100 transition-opacity">→</span>
    </div>
    <div className={`text-[22px] font-bold tracking-tight leading-tight ${valueColor ?? ""}`}>{value}</div>
    {detail ? <div className="text-[11px] text-[var(--text-secondary)] mt-1">{detail}</div> : null}
    {sparkline && sparkline.length > 1 ? (
      <svg
        viewBox={`0 0 ${sparkline.length} 20`}
        preserveAspectRatio="none"
        className="absolute right-3 bottom-3 w-16 h-5 opacity-40 pointer-events-none"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={sparkline
            .map((v, i) => {
              const min = Math.min(...sparkline);
              const max = Math.max(...sparkline);
              const range = max - min || 1;
              const y = 18 - ((v - min) / range) * 16;
              return `${i},${y}`;
            })
            .join(" ")}
        />
      </svg>
    ) : null}
  </button>
);
```

- [ ] **Step 2: Derive KPI values inside `HomeView`**

Above the `return`, add:

```typescript
  const hasActivity = props.activeRuns.length > 0 || props.stats.totalTrades > 0;
  const liveCount = props.activeRuns.filter((r) => r.mode === "live").length;
  const shadowCount = props.activeRuns.filter((r) => r.mode === "shadow").length;
  const positionSymbols = [...new Set(props.positions.map((p) => p.symbol))];
  const positionSymbolsLabel =
    positionSymbols.length === 0
      ? "—"
      : positionSymbols.length <= 3
        ? positionSymbols.join(" · ")
        : `${positionSymbols.slice(0, 3).join(" · ")} +${positionSymbols.length - 3}`;
```

- [ ] **Step 3: Replace the `home-section-kpis` placeholder**

Replace `<div id="home-section-kpis" />` with:

```tsx
        <div id="home-section-kpis" className="grid grid-cols-4 gap-3">
          <KpiCard
            label="Total P&L"
            value={hasActivity ? formatPnl(props.stats.totalPnl) : "$0.00"}
            valueColor={hasActivity ? pnlColorClass(props.stats.totalPnl) : undefined}
            detail={hasActivity ? `Realized ${formatPnl(props.stats.realizedPnl)} · Unrealized ${formatPnl(props.stats.unrealizedPnl)}` : undefined}
            sparkline={props.pnlHistory.length > 1 ? props.pnlHistory : undefined}
            onClick={() => props.onNavigate("trading")}
          />
          <KpiCard
            label="Win Rate"
            value={props.stats.totalTrades > 0 ? `${props.stats.winRate}%` : "—"}
            detail={props.stats.totalTrades > 0 ? `${props.stats.wins} W · ${props.stats.losses} L` : undefined}
            onClick={() => props.onNavigate("trading", { scrollTo: "history" })}
          />
          <KpiCard
            label="Active Algos"
            value={`${props.activeRuns.length}`}
            detail={props.activeRuns.length > 0 ? `${liveCount} live · ${shadowCount} shadow` : undefined}
            onClick={() => props.onNavigate("algos")}
          />
          <KpiCard
            label="Open Positions"
            value={`${props.stats.openPositions}`}
            detail={positionSymbolsLabel !== "—" ? positionSymbolsLabel : undefined}
            onClick={() => props.onNavigate("trading", { scrollTo: "positions" })}
          />
        </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Visual verification**

Run: `npm run dev`. Expected: four KPI cards render across the top in a single row. In the no-activity state: `$0.00`, `—`, `0`, `0`. Cards have a subtle hover highlight and a → cue in the top-right corner.

- [ ] **Step 6: Commit**

```bash
git add src/views/HomeView.tsx
git commit -m "$(cat <<'EOF'
feat: KPI row on home view with deep-links

Why: four scannable KPIs (Total P&L, Win Rate, Active Algos, Open
Positions) replace the dense flat stat list. Each card is clickable
and navigates to the right deep-dive section.
EOF
)"
```

---

### Task 7: Implement the hero P&L chart (Section 3)

**Why:** The centerpiece of the redesign. Multi-line area chart with per-algo overlay, toggleable legend, and a (v1: stub-only) time-range segment control. Uses uPlot (already a dependency).

**Files:**
- Modify: `src/views/HomeView.tsx`

- [ ] **Step 1: Add imports at the top of `HomeView.tsx`**

Add to the top of the file:

```typescript
import { useMemo, useState, type MouseEvent } from "react";
import UplotReact from "uplot-react";
import "uplot/dist/uPlot.min.css";
import type uPlot from "uplot";
```

Note: `uplot-react` is a default export. `uplot` has no named exports used here — only its CSS side-effect and the TS types. Both packages are already declared in `package.json`, but this is the project's first use of them, so watch for a missing-types warning on `tsc` and add `// @ts-expect-error` only as a last resort. Prefer fixing via an `.d.ts` shim if needed.

(If any of these imports already exist, keep a single consolidated import line.)

- [ ] **Step 2: Add the `SessionPnlChart` component at the bottom of the file**

Below `KpiCard`, add:

```typescript
const CHART_PALETTE = ["#e5e7eb", "#22c55e", "#60a5fa", "#f59e0b", "#a78bfa", "#f472b6", "#34d399", "#fb923c"];

type SessionPnlChartProps = {
  pnlHistory: number[];
  runPnlHistories: Record<string, number[]>;
  activeRuns: AlgoRun[];
  algos: Algo[];
  visibleInstanceIds: Set<string>;
  onToggleInstance: (instanceId: string) => void;
};

const SessionPnlChart = ({ pnlHistory, runPnlHistories, activeRuns, algos, visibleInstanceIds, onToggleInstance }: SessionPnlChartProps) => {
  const instances = activeRuns.filter((r) => runPnlHistories[r.instance_id]?.length);

  const data = useMemo<uPlot.AlignedData>(() => {
    const length = Math.max(pnlHistory.length, ...instances.map((r) => runPnlHistories[r.instance_id]?.length ?? 0), 1);
    const x = Array.from({ length }, (_, i) => i);
    const totalSeries = Array.from({ length }, (_, i) => pnlHistory[i] ?? pnlHistory[pnlHistory.length - 1] ?? 0);
    const perRun = instances.map((r) => {
      const h = runPnlHistories[r.instance_id] ?? [];
      return Array.from({ length }, (_, i) => h[i] ?? h[h.length - 1] ?? 0);
    });
    return [x, totalSeries, ...perRun] as uPlot.AlignedData;
  }, [pnlHistory, runPnlHistories, instances]);

  const options = useMemo<uPlot.Options>(() => ({
    width: 800,
    height: 220,
    cursor: { drag: { x: false, y: false } },
    legend: { show: false },
    scales: { x: { time: false } },
    axes: [
      { stroke: "#6b7280", grid: { stroke: "#1a1b1f", width: 1 } },
      { stroke: "#6b7280", grid: { stroke: "#1a1b1f", width: 1 } },
    ],
    series: [
      {},
      { label: "Total", stroke: CHART_PALETTE[0], width: 2, fill: "rgba(229,231,235,0.08)" },
      ...instances.map((r, i) => ({
        label: algos.find((a) => a.id === r.algo_id)?.name ?? `algo ${r.algo_id}`,
        stroke: CHART_PALETTE[(i + 1) % CHART_PALETTE.length],
        width: 1.5,
        show: visibleInstanceIds.has(r.instance_id),
      })),
    ],
  }), [instances, algos, visibleInstanceIds]);

  if (pnlHistory.length <= 1) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
        No session activity yet
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-3">
        <LegendItem color={CHART_PALETTE[0]} label="Total" visible={true} onClick={() => undefined} disabledToggle />
        {instances.map((r, i) => {
          const algoName = algos.find((a) => a.id === r.algo_id)?.name ?? `algo ${r.algo_id}`;
          return (
            <LegendItem
              key={r.instance_id}
              color={CHART_PALETTE[(i + 1) % CHART_PALETTE.length]}
              label={algoName}
              visible={visibleInstanceIds.has(r.instance_id)}
              onClick={() => onToggleInstance(r.instance_id)}
            />
          );
        })}
      </div>
      <div className="w-full overflow-hidden">
        <UplotReact options={options} data={data} />
      </div>
    </>
  );
};

type LegendItemProps = {
  color: string;
  label: string;
  visible: boolean;
  onClick: () => void;
  disabledToggle?: boolean;
};

const LegendItem = ({ color, label, visible, onClick, disabledToggle }: LegendItemProps) => (
  <button
    onClick={disabledToggle ? undefined : onClick}
    disabled={disabledToggle}
    className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-opacity ${disabledToggle ? "cursor-default" : "hover:bg-[var(--bg-panel)]"} ${visible ? "opacity-100" : "opacity-40 line-through"}`}
  >
    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
    <span className="text-[var(--text-primary)]">{label}</span>
  </button>
);
```

- [ ] **Step 3: Add the segmented time-range control component**

Below `LegendItem`, add:

```typescript
type TimeRange = "1h" | "today" | "week" | "mtd";

type SegmentedProps = {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
};

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; enabled: boolean }[] = [
  { value: "1h", label: "1h", enabled: false },
  { value: "today", label: "Today", enabled: true },
  { value: "week", label: "Week", enabled: false },
  { value: "mtd", label: "MTD", enabled: false },
];

const TimeRangeSegmented = ({ value, onChange }: SegmentedProps) => (
  <div className="flex bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md overflow-hidden">
    {TIME_RANGE_OPTIONS.map((opt) => (
      <button
        key={opt.value}
        disabled={!opt.enabled}
        onClick={() => opt.enabled && onChange(opt.value)}
        className={`px-2.5 py-1 text-[11px] transition-colors ${
          value === opt.value
            ? "bg-[var(--bg-panel)] text-[var(--text-primary)]"
            : opt.enabled
              ? "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]"
              : "text-[var(--text-secondary)] opacity-40 cursor-not-allowed"
        }`}
        title={opt.enabled ? "" : "Coming soon"}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
```

- [ ] **Step 4: Add chart state inside `HomeView`**

Above the `return`, add:

```typescript
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [visibleInstanceIds, setVisibleInstanceIds] = useState<Set<string>>(() => new Set(props.activeRuns.map((r) => r.instance_id)));

  const toggleInstanceVisibility = (instanceId: string) => {
    setVisibleInstanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  };
```

- [ ] **Step 5: Replace the `home-section-chart` placeholder**

Replace `<div id="home-section-chart" />` with:

```tsx
        <div id="home-section-chart" className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => props.onNavigate("trading")}
              className="group text-[11px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold hover:text-[var(--accent-blue)] transition-colors"
            >
              Session P&L
              <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
            </button>
            <TimeRangeSegmented value={timeRange} onChange={setTimeRange} />
          </div>
          <SessionPnlChart
            pnlHistory={props.pnlHistory}
            runPnlHistories={props.runPnlHistories}
            activeRuns={props.activeRuns}
            algos={props.algos}
            visibleInstanceIds={visibleInstanceIds}
            onToggleInstance={toggleInstanceVisibility}
          />
        </div>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If uPlot's `AlignedData` type doesn't cleanly accept the spread form, widen the cast to `data as unknown as uPlot.AlignedData`.

- [ ] **Step 7: Visual verification**

Run: `npm run dev`. Expected: a new panel appears with "Session P&L →" label on the left and a 4-segment time-range control on the right (only "Today" is enabled; the others are faded and disabled). The chart area shows "No session activity yet" when there's no P&L history. With data (Tauri + NinjaTrader), it shows the total line + one line per running algo, and clicking a legend item toggles that line. The "Total" legend item is non-interactive.

- [ ] **Step 8: Commit**

```bash
git add src/views/HomeView.tsx
git commit -m "$(cat <<'EOF'
feat: hero P&L chart on home view with toggleable legend

Why: centerpiece of the redesign. Multi-line uPlot chart with a "Total"
line plus one line per running algo. Legend items toggle visibility.
Time-range segmented control is scaffolded; only "Today" is wired in v1.
Chart title links to the Trading view.
EOF
)"
```

---

### Task 8: Implement the active algos tape (Section 4 left)

**Why:** Compact table with rows for each running instance, sparkline per row, inline stop button, and deep-link on row click to the Algos view focused on that instance.

**Files:**
- Modify: `src/views/HomeView.tsx`

- [ ] **Step 1: Add the `AlgoTapeRow` component at the bottom of the file**

```typescript
type AlgoTapeRowProps = {
  instanceId: string;
  algoName: string;
  mode: string;
  account: string;
  pnl: number;
  trades: number;
  winRate: number;
  history: number[];
  onClickRow: () => void;
  onStop: () => void;
};

const AlgoTapeRow = ({ instanceId: _id, algoName, mode, account, pnl, trades, winRate, history, onClickRow, onStop }: AlgoTapeRowProps) => {
  const modePill =
    mode === "live"
      ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
      : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]";

  const handleStop = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onStop();
  };

  return (
    <tr
      onClick={onClickRow}
      className="group border-t border-[var(--border)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
    >
      <td className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${mode === "live" ? "bg-[var(--accent-green)]" : "bg-[var(--accent-yellow)]"}`} />
          <span className="font-medium">{algoName}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${modePill}`}>{mode}</span>
      </td>
      <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">{account}</td>
      <td className={`px-3 py-2 text-sm text-right font-medium tabular-nums ${pnlColorClass(pnl)}`}>{formatPnl(pnl)}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{trades}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{trades > 0 ? `${winRate}%` : "—"}</td>
      <td className="px-3 py-2">
        {history.length > 1 ? (
          <svg viewBox={`0 0 ${history.length} 18`} preserveAspectRatio="none" className="w-16 h-4">
            <polyline
              fill="none"
              stroke={pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)"}
              strokeWidth="1.2"
              points={history
                .map((v, i) => {
                  const min = Math.min(...history);
                  const max = Math.max(...history);
                  const range = max - min || 1;
                  const y = 16 - ((v - min) / range) * 14;
                  return `${i},${y}`;
                })
                .join(" ")}
            />
          </svg>
        ) : (
          <span className="text-[var(--text-secondary)] text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={handleStop}
          className="opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent-red)] hover:text-[var(--accent-red)] transition-all"
          title="Stop this algo"
        >
          Stop
        </button>
      </td>
    </tr>
  );
};
```

- [ ] **Step 2: Replace the `home-section-algos` placeholder**

Replace `<div id="home-section-algos" className="col-span-2" />` with:

```tsx
          <div id="home-section-algos" className="col-span-2 p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">Active Algos</span>
              <button
                onClick={() => props.onNavigate("algos")}
                className="text-[11px] text-[var(--accent-blue)] hover:underline"
              >
                View all →
              </button>
            </div>
            {props.activeRuns.length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)] py-6 text-center">
                No algos running — start one from the Algos view
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Algo</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Mode</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Account</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">P&L</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Trades</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Win %</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Trend</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {props.activeRuns.map((run) => {
                    const algo = props.algos.find((a) => a.id === run.algo_id);
                    const stats = props.algoStats[run.instance_id];
                    const history = props.runPnlHistories[run.instance_id] ?? [];
                    return (
                      <AlgoTapeRow
                        key={run.instance_id}
                        instanceId={run.instance_id}
                        algoName={algo?.name ?? `algo ${run.algo_id}`}
                        mode={run.mode}
                        account={run.account}
                        pnl={stats?.pnl ?? 0}
                        trades={stats?.totalTrades ?? 0}
                        winRate={stats?.winRate ?? 0}
                        history={history}
                        onClickRow={() => props.onNavigate("algos", { instanceId: run.instance_id })}
                        onStop={() => props.onStopAlgo(run.instance_id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual verification**

Run: `npm run dev`. Expected (no data): "No algos running" placeholder inside the Active Algos panel. With data: table rows appear with sparklines, mode pill, and a Stop button visible on row hover.

- [ ] **Step 5: Commit**

```bash
git add src/views/HomeView.tsx
git commit -m "$(cat <<'EOF'
feat: active algos tape on home view with inline stop + deep-link

Why: compact per-instance row replaces the old vertical card list.
Row click opens Algos with the instance focused; inline Stop button
calls onStopAlgo without navigating away. "View all" also routes.
EOF
)"
```

---

### Task 9: Implement the performance panel (Section 4 right)

**Why:** The grouped secondary stats that don't belong in the KPI row. One compact panel with three visual groups (Quality / Trades / Streaks).

**Files:**
- Modify: `src/views/HomeView.tsx`

- [ ] **Step 1: Add the `StatRow` component at the bottom of the file**

```typescript
type StatRowProps = {
  label: string;
  value: string;
  valueColor?: string;
};

const StatRow = ({ label, value, valueColor }: StatRowProps) => (
  <div className="flex items-center justify-between py-1 text-sm">
    <span className="text-[var(--text-secondary)]">{label}</span>
    <span className={`font-medium tabular-nums ${valueColor ?? ""}`}>{value}</span>
  </div>
);
```

- [ ] **Step 2: Replace the `home-section-performance` placeholder**

Replace `<div id="home-section-performance" className="col-span-1" />` with:

```tsx
          <div id="home-section-performance" className="col-span-1 p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">Performance</span>
              <button
                onClick={() => props.onNavigate("trading", { scrollTo: "stats" })}
                className="text-[11px] text-[var(--accent-blue)] hover:underline"
              >
                Full stats →
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-1">Quality</div>
                <StatRow label="Profit Factor" value={props.stats.profitFactor} />
                <StatRow label="Sharpe" value={props.stats.sharpe} />
                <StatRow
                  label="Max Drawdown"
                  value={props.stats.totalTrades > 0 ? formatPnl(props.stats.maxDrawdown) : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
                />
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-1">Trades</div>
                <StatRow
                  label="Avg Win"
                  value={props.stats.totalTrades > 0 ? formatPnl(props.stats.avgWin) : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined}
                />
                <StatRow
                  label="Avg Loss"
                  value={props.stats.totalTrades > 0 ? formatPnl(props.stats.avgLoss) : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
                />
                <StatRow label="Avg Duration" value={props.stats.avgTradeDuration || "—"} />
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-1">Streaks</div>
                <StatRow
                  label="Consecutive W"
                  value={props.stats.totalTrades > 0 ? `${props.stats.consecutiveWins}` : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined}
                />
                <StatRow
                  label="Consecutive L"
                  value={props.stats.totalTrades > 0 ? `${props.stats.consecutiveLosses}` : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
                />
              </div>
            </div>
          </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual verification**

Run: `npm run dev`. Expected: the right column of the bottom split now shows a Performance panel with three groups (Quality / Trades / Streaks), each with labeled stat rows. "Full stats →" link in the header navigates to Trading view.

- [ ] **Step 5: Commit**

```bash
git add src/views/HomeView.tsx
git commit -m "$(cat <<'EOF'
feat: performance stats panel on home view

Why: compact, grouped secondary stats (quality / trades / streaks)
replace the old middle column's long flat list. "Full stats" links
to the Trading view stats section.
EOF
)"
```

---

### Task 10: Full integration verification

**Why:** Final end-to-end check. All sections are now filled in. This task verifies that every click in the click map reaches its correct destination with the correct filter applied, and that all empty states render cleanly.

**Files:** no code changes expected. Fix regressions as they come up.

- [ ] **Step 1: Full type check + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean build, no warnings about missing exports.

- [ ] **Step 2: Visual walkthrough — no-data state**

Run: `npm run dev`. Open home view. Verify:

- Header shows "Wolf Den" + status line
- Accounts section shows "No accounts connected"
- KPIs show $0.00 / — / 0 / 0
- Chart panel shows "No session activity yet"
- Active Algos panel shows "No algos running — start one from the Algos view"
- Performance panel shows — for numeric stats, but Profit Factor / Sharpe / Avg Duration fall back to whatever the simulation returns by default (likely "0.00" / "0.00" / "—")

- [ ] **Step 3: Integration walkthrough — with NinjaTrader running**

Run: `npm run tauri dev`. Connect NinjaTrader, start at least two algos (one live, one shadow) on different accounts. On the home view verify:

- Accounts row renders one card per account, with correct balance, day P&L coloring, and green dot where the account has running algos
- KPIs update as trades happen
- Chart renders a Total line plus one line per running algo; legend items toggle lines
- Active Algos tape lists both running algos with correct mode pill, sparkline, and stop-button hover
- Stopping an algo via the inline button removes the row without navigating away

- [ ] **Step 4: Click-map walkthrough**

From the home view, verify each interaction:

| Click | Expected destination |
|---|---|
| Account card (Sim101) | Trading view with account filter set to Sim101 |
| KPI Total P&L | Trading view, no filter |
| KPI Win Rate | Trading view scrolled to orders region |
| KPI Active Algos | Algos view, default |
| KPI Open Positions | Trading view scrolled to Positions panel |
| Chart title "Session P&L →" | Trading view, no filter |
| Chart legend item (algo) | stays on home, toggles line visibility |
| Chart Today segment | stays on home, no change (only option wired) |
| Chart disabled segments (1h / Week / MTD) | no response |
| Algo tape row | Algos view, that instance focused |
| Algo tape Stop button | stays on home, row disappears |
| "View all →" in Active Algos header | Algos view, default |
| "Full stats →" in Performance header | Trading view scrolled to stats |

Between every navigation, return to home via the sidebar and verify no leaked context (e.g. Trading view doesn't keep the old filter when you navigate back to it from the sidebar after previously filtering from home).

- [ ] **Step 5: Overflow cases**

If your environment has or can simulate ≥5 accounts, verify the account strip renders 4 columns and scrolls horizontally rather than stacking. If ≥10 algos, the tape panel gains a fixed max-height and scrolls vertically. If either overflow is unpleasant, tighten max-heights on those panels — e.g. `max-h-[320px] overflow-y-auto` on the tape's inner `<table>` wrapper.

- [ ] **Step 6: Fix anything broken**

Any visual or functional regressions found in Steps 2–5 get a follow-up commit with a descriptive message (`fix: …`). Don't let this task sit with known issues.

- [ ] **Step 7: Final commit (only if step 6 produced changes)**

If fixes were made, commit with a message like:

```bash
git commit -m "$(cat <<'EOF'
fix: home view integration fixes

Why: regressions caught during end-to-end verification of the new home
view. <describe what broke and what changed>
EOF
)"
```

If no fixes needed, no commit. Move on.

- [ ] **Step 8: Update the spec with Status**

Edit `docs/superpowers/specs/2026-04-18-home-view-redesign-design.md` and change the status line from `**Status:** Approved` to `**Status:** Implemented`. Commit:

```bash
git add docs/superpowers/specs/2026-04-18-home-view-redesign-design.md
git commit -m "$(cat <<'EOF'
docs: mark home view redesign spec as implemented
EOF
)"
```

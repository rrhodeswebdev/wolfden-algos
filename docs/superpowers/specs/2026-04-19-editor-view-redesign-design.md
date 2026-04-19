# Editor View Redesign — Design

**Date:** 2026-04-19
**Direction:** Variant B — "Workspace" (VS Code / Cursor inspired)
**Prototypes:** `prototypes/editor-view/` (Variants A, B, C)

## Summary

Modernize the algo editor from a single-algo-at-a-time pane into a multi-tab workspace. Users can have several algos open simultaneously, each with its own unsaved buffer. Tab buffers persist across view navigation. The existing left rail (`Sidebar.tsx`) is visually tightened to match the new chrome. A Monaco theme aligned with the app's design tokens replaces the generic `vs-dark`. An integrated status bar replaces the ad-hoc header.

## Goals

- Multi-tab editing — several algos open at once, independent dirty buffers, zero-friction tab switching.
- Cleaner chrome — filename-led tab strip and an always-visible status bar carry the state that a decorative header used to carry.
- Design-token-aware editor — Monaco's colors match the app's panel / accent palette instead of clashing with it.
- Surgical refactor — no backend / Tauri-command / schema changes; PRable as one unit.

## Non-Goals

- Command palette (⌘K) — deferred to a later project that spans the whole app.
- Autosave — explicit save remains the semantic; algos can be running live and side-effectful writes belong to user intent, not debounce.
- Tab persistence across app restart — in-memory only. (Can be layered on later.)
- Integrated terminal in the bottom panel — AI terminal keeps its current right-side panel behavior.
- Backtest / split-editor buttons — the prototype showed them; the features don't exist, dropped for YAGNI.

## Scope

### In scope
- New `useEditorTabs` hook (centralized tab state).
- New components: `EditorTabs.tsx`, `EditorStatusBar.tsx`.
- Edits: `AlgoEditor.tsx` (slimmed to Monaco + deps strip), `AlgoManager.tsx` (search + dirty dot + always-on overflow), `Sidebar.tsx` (restyle to 52px icon-only), `EditorView.tsx` (layout-only orchestrator), `App.tsx` (adopt hook, drop singleton editor buffers).
- New: `src/lib/monacoTheme.ts` — custom Monaco theme.
- Removal of the confirm-on-view-navigation dialog (tab buffers persist, so it becomes redundant).

### Out of scope
- Other views (Home, Algos, Trading) — untouched except for the restyled shared left rail.
- `AiTerminalPanel` — no change; keeps its independent right-side tab list.
- Backend commands and the Tauri event surface.

## Architecture

### File layout

```
src/
  hooks/
    useEditorTabs.ts          [new]
  lib/
    monacoTheme.ts            [new]
  components/
    Sidebar.tsx               [edit]  — restyle 80→52px, icon-only
    AlgoManager.tsx           [edit]  — filter input, dirty dot, overflow menu
    AlgoEditor.tsx            [edit]  — drop header; Monaco + deps strip only
    EditorTabs.tsx            [new]   — tab strip
    EditorStatusBar.tsx       [new]   — dirty state, deps count, cursor position
  views/
    EditorView.tsx            [edit]  — layout-only orchestrator
  App.tsx                     [edit]  — adopt useEditorTabs; remove nav unsaved-guard
```

### Component tree (Editor view)

```
<EditorView>
  <AlgoManager>                    ← left pane, algo list + filter + overflow
  <div.editor-column>
    <EditorTabs>                   ← tab strip (filenames, dirty dot, AI pulse, close)
    <AlgoEditor>                   ← Monaco + deps strip
    <EditorStatusBar>              ← dirty · language · deps · ln/col · encoding
  </div>
</EditorView>
```

The left rail (`Sidebar.tsx`) sits outside `EditorView` inside `App.tsx`, same as today. `AiTerminalPanel` also sits outside `EditorView`, same as today — independent of editor tabs.

## The `useEditorTabs` hook

Centralizes all multi-tab state and mutations. Matches the codebase's existing `useAlgo*` hook pattern.

### State

```ts
type TabBuffer = {
  code: string;
  deps: string;
  savedCode: string;   // snapshot at last save / load / open
  savedDeps: string;
};

type State = {
  openTabIds: number[];               // ordered, left-to-right
  activeTabId: number | null;
  buffers: Record<number, TabBuffer>; // keyed by algo id
};
```

### API

| Returned | Purpose |
|---|---|
| `openTabIds: number[]` | Render tab strip in order |
| `activeTabId: number \| null` | Which tab is in the editor |
| `activeCode: string`, `activeDeps: string` | Derived; drive Monaco + deps input |
| `isDirty(id: number): boolean` | Per-tab dirty flag |
| `hasAnyDirty: boolean` | Derived convenience |
| `openTab(algo: Algo): void` | Idempotent; initializes buffer from `algo.code` / `algo.dependencies` if new; activates either way |
| `switchTab(id: number): void` | No prompt — buffers persist |
| `closeTab(id: number): { dirty: boolean }` | Caller inspects `dirty` and shows confirm if needed |
| `forceCloseTab(id: number): void` | Post-confirm close path |
| `updateCode(code: string)`, `updateDeps(deps: string)` | Update active tab's buffer |
| `markActiveSaved(): void` | Snapshot `code`→`savedCode`, `deps`→`savedDeps` on successful save |
| `onAlgoDeleted(id: number): void` | External hook — closes tab silently |
| `onAlgoExternallyUpdated(id: number, code: string, deps: string): void` | Sync rule below |

### Close-active-tab rule

When closing the active tab: activate right neighbor; else left neighbor; else set `activeTabId` to `null` (empty state).

### External-update rule (`algo-code-updated` event)

- **Buffer clean** → replace both `code` and `savedCode` (full sync).
- **Buffer dirty** → leave everything alone. Toast: *"External update to `<name>`. Your unsaved edits will overwrite it on save."*

Fixes an existing latent issue where the event unconditionally overwrites unsaved edits on the selected algo.

### Behavior changes from today

1. **No more unsaved-changes dialog on view navigation.** Tab buffers persist in the hook across view switches, so no data is lost.
2. **Tab/algo-select never prompts.** Buffers are preserved — the whole point of multi-tab.

Close-dirty-tab still prompts. Delete algo still prompts (the delete confirm covers the unsaved-data case too — no second prompt).

**Confirm dispatch.** The dirty-close confirm reuses the existing `ConfirmDialog` pattern in `App.tsx`. `EditorView` receives an `onRequestCloseTab(id: number)` prop from `App`; `App` inspects `tabs.isDirty(id)` and either calls `tabs.forceCloseTab(id)` directly (clean) or opens the existing `ConfirmDialog` (dirty) and calls `tabs.forceCloseTab(id)` on confirm. No new dialog component.

## Component specs

### `Sidebar.tsx` (edit — restyle only)

- Width 80px → 52px.
- Drop the uppercase text labels beneath each icon; rely on `title` tooltips.
- Logo shrinks to `32px`.
- Connection dot relocates to bottom-right corner of the rail.
- No prop / behavior changes. Guide button stays.

### `EditorView.tsx` (edit — layout-only)

New prop shape:

```ts
type EditorViewProps = {
  algos: Algo[];
  tabs: ReturnType<typeof useEditorTabs>;
  aiTerminalAlgoIds: Set<number>;
  onSelectAlgo: (id: number) => void;           // wraps tabs.openTab
  onCreateAlgo: () => void;
  onCreateAlgoWithAi: () => void;
  onOpenAiTerminal: (algoId: number) => void;
  onRequestCloseTab: (id: number) => void;      // routes to App for dirty-confirm dispatch
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
  onSaveAlgo: () => void;
};
```

Layout:

```
<AlgoManager ...>  <div.editor-column>
                     <EditorTabs ...>
                     {activeTabId !== null
                       ? <AlgoEditor ...>  <EditorStatusBar ...>
                       : <empty-state>}
                   </div>
```

Owns local `showDeps` + `cursor { line, col }` state; passes them down.

### `EditorTabs.tsx` (new)

Props:

```ts
type EditorTabsProps = {
  tabs: Array<{ id: number; name: string; isDirty: boolean; hasAiTerminal: boolean }>;
  activeTabId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;         // EditorView forwards to App via onRequestCloseTab
  onCreateAlgo: () => void;
  onCreateAlgoWithAi: () => void;
  onRenameActive: () => void;
  onDeleteActive: () => void;
  onCloseOthers: (id: number) => void;
  onCloseAll: () => void;
};
```

Renders horizontal strip. Each tab: `Py` lang tag, filename (truncates with ellipsis), dirty dot (yellow) or AI pulse (blue), close `×` on hover. Active tab has a 2px `var(--accent-blue)` top border. Tabstrip-right has `+` and `+ AI` buttons and a `⋯` menu (Rename, Close Others, Close All, Delete). Horizontal scroll on overflow.

### `AlgoEditor.tsx` (edit — slim down)

New props:

```ts
type AlgoEditorProps = {
  code: string;
  deps: string;
  showDeps: boolean;
  onChange: (code: string) => void;
  onDepsChange: (deps: string) => void;
  onSave: () => void;
  onCursorChange: (line: number, col: number) => void;
};
```

Renders only:
- Deps reveal strip (same visual as today; toggled via `showDeps` from parent).
- Monaco editor with `beforeMount={defineWolfDenTheme}` and `theme="wolf-den-dark"`.
- Monaco's `onDidChangeCursorPosition` hook calls `onCursorChange`.

No header. No save button (the mouse-clickable save affordance moves into `EditorStatusBar`'s dirty chip). Keyboard `⌘S` / `Ctrl+S` stays bound here (Monaco has focus).

### `EditorStatusBar.tsx` (new)

Props:

```ts
type EditorStatusBarProps = {
  isDirty: boolean;
  depsCount: number;
  cursorLine: number;
  cursorCol: number;
  onSave: () => void;          // invoked when the dirty chip is clicked
  onToggleDeps: () => void;    // invoked when the deps chip is clicked
};
```

Two groups:

- **Left:**
  - **Save chip** (primary mouse-clickable save affordance since `AlgoEditor` no longer has a Save button):
    - When `isDirty`: yellow dot + `"Unsaved · ⌘S"`. Clickable — calls `onSave`. Cursor pointer; hover state highlights the background.
    - When clean: green dot + `"Saved"`. Non-interactive.
  - `"Python 3.11"` — static.
  - `deps: N` chip — clickable, calls `onToggleDeps`.
- **Right:** `"Ln 12, Col 28"`; `"Spaces: 4"`; `"UTF-8"` — all static.

Height 26px; border-top `var(--border)`; font 11px; background `var(--bg-panel)`.

### `AlgoManager.tsx` (edit — refresh)

Existing selection / create behavior preserved. Added:

- Filter input at top of list (local-state filter by name substring).
- Per-item dirty dot — accepts `dirtyAlgoIds: Set<number>` prop.
- Hover-only action buttons replaced with always-present `⋯` overflow. Menu items: Open (if not currently in `openTabIds`), Rename, AI Terminal, Delete.

## `src/lib/monacoTheme.ts`

Exports `defineWolfDenTheme(monaco)`. Called from `AlgoEditor`'s `beforeMount`.

- Base: `vs-dark`, `inherit: true`.
- Applied via `theme="wolf-den-dark"` prop on the `<Editor>` component.

Color overrides:

| Monaco key | Hex | Token |
|---|---|---|
| `editor.background` | `#1a1a28` | `--bg-panel` |
| `editor.foreground` | `#e0e0e8` | `--text-primary` |
| `editorLineNumber.foreground` | `#55556a` | `--text-muted` |
| `editorLineNumber.activeForeground` | `#e0e0e8` | `--text-primary` |
| `editor.selectionBackground` | `#4d9fff33` | `--accent-blue` @ 20% |
| `editor.lineHighlightBackground` | `#4d9fff0d` | `--accent-blue` @ 5% |
| `editor.lineHighlightBorder` | `#00000000` | transparent |
| `editorCursor.foreground` | `#4d9fff` | `--accent-blue` |
| `editorWidget.background` | `#20202e` | `--bg-elevated` |
| `editorWidget.border` | `#2a2a3a` | `--border` |
| `editorIndentGuide.background` | `#2a2a3a` | `--border` |

Token rules (`rules: [...]`): keyword `#c792ea`, function `#82aaff`, string `#c3e88d`, number `#f78c6c`, comment `#546e7a` italic, operator `#89ddff`, class `#ffcb6b`. Matches the prototype palette.

Hardcoded hex rather than reading CSS vars at runtime — Monaco's `defineTheme` wants strings up front; the CSS vars themselves are already constants in `styles.css`. If tokens ever become dynamic (light mode), revisit.

## State migration in `App.tsx`

Removed:
- `selectedAlgoId`, `selectedAlgoIdRef`
- `editorCode`, `editorDeps`
- `hasUnsavedChanges`
- Confirm-on-navigate logic inside `handleNavigate`
- Confirm-on-select logic inside `handleSelectAlgo`
- The `useEffect` that syncs `selectedAlgo` → `editorCode` / `editorDeps`

Added:
- `const tabs = useEditorTabs()` — single replacement for the above.
- All AI-terminal and nav-context code that previously referenced `selectedAlgoId` now uses `tabs.activeTabId` (same semantic — "the algo currently in focus in the editor").

Handler rewiring:

| Today | New |
|---|---|
| `handleSelectAlgo(id)` — sets `selectedAlgoId`, confirms if dirty | `tabs.openTab(algo)` — idempotent, no confirm |
| `handleSaveAlgo()` — reads `editorCode` / `editorDeps`, calls backend, reloads | Reads `tabs.activeCode` / `tabs.activeDeps`, calls backend, calls `tabs.markActiveSaved()` on success, toasts on failure |
| `handleCreateAlgo` / `handleCreateAlgoWithAi` | After backend create, calls `tabs.openTab(newAlgo)` |
| `handleDeleteAlgo(id)` → on confirm | Backend delete → `tabs.onAlgoDeleted(id)` → `loadAlgos()` |
| `algo-code-updated` event handler | Calls `tabs.onAlgoExternallyUpdated(algo_id, code, deps)` |

## Error handling

- **Save failure** — existing handler adds `toast.error("Failed to save: <msg>")` and does **not** call `markActiveSaved()` on throw. Buffer stays dirty; user retries.
- **Open-tab for stale / missing id** — `openTab` defensively no-ops if the algo isn't in the current list.
- **`onAlgoDeleted` for non-open id** — no-op.
- **`forceCloseTab` on non-open id** — no-op.
- **External-update event for non-open algo** — ignored; next `openTab` picks up the current code.

## Verification plan

The project has no test framework. Verification is manual + TypeScript type-check.

1. `npm run build` passes (type-check is clean on all touched files).
2. Smoke matrix:
   - Open 3 tabs; switch between them — each retains independent buffer and dirty state.
   - Edit tab A, switch to B, switch back to A — edits preserved; A still dirty.
   - Close dirty tab → confirm dialog. Cancel keeps tab; Confirm drops edits.
   - Close active tab — right neighbor activates; left neighbor activates if no right.
   - Close last tab — empty state shows.
   - Delete algo with tab open (via sidebar `⋯` or tab `⋯`) — single delete confirm only; tab closes on confirm.
   - Rename algo from sidebar — tab label updates live.
   - Save active tab — dirty dots clear in tab strip, sidebar, and status bar.
   - Editor → Home → Editor — tabs and dirty state survive view nav; no prompt fires.
   - External `algo-code-updated` event on clean buffer — syncs transparently.
   - External `algo-code-updated` event on dirty buffer — toast fires; buffer untouched; save overwrites.
   - Monaco theme: background / selection / line highlight / syntax colors match the prototype.
3. Regression walk: Home, Algos, Trading views render correctly with the restyled 52px left rail; connection dot still visible; Guide button still works.

## Ship strategy

Single PR. No feature flag. No backend / schema / Tauri-command changes. No persisted-state migration. The risky diff is `App.tsx` and the hook; the smoke matrix catches regressions.

## Open questions

None at spec time.

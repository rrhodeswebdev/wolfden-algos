# Editor View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the algo editor into a multi-tab workspace (Variant B "Workspace" direction), aligned with `docs/superpowers/specs/2026-04-19-editor-view-redesign-design.md`.

**Architecture:** A new `useEditorTabs` hook centralizes tab state (open tabs, per-tab dirty buffers, active tab). `EditorView` becomes a layout-only orchestrator that composes `AlgoManager` + new `EditorTabs` + slimmed `AlgoEditor` + new `EditorStatusBar`. `Sidebar.tsx` is restyled to a 52px icon-only rail. A custom Monaco theme (`wolf-den-dark`) replaces `vs-dark`. No backend / Tauri-command / schema changes.

**Tech Stack:** React 19, TypeScript 6, `@monaco-editor/react` 4.7, `monaco-editor` 0.55, `lucide-react` (already installed) for icons, Tailwind 4 + CSS vars in `src/styles.css`.

---

## Project has no test framework — adapted task template

The standard `superpowers:writing-plans` template uses a TDD flow. This project has no vitest / jest setup (see `package.json`), and the spec's verification plan is `npm run build` + manual smoke matrix. Every task here replaces the "write failing test → run → implement → pass" cycle with:

1. **Implement** — write the code.
2. **Type-check** — run `npm run build` from the repo root; expect zero TypeScript errors. (The project's `build` script is `tsc && vite build` — passing `tsc` means the types are clean.)
3. **Smoke** — a targeted manual walk-through described per task.
4. **Commit** — Conventional Commits.

Do not introduce a test framework in this plan. It's out of scope.

---

## Task dependency map

Tasks 1–6 are independent pure additions / backward-compatible edits. They can be done in any order, or in parallel by a subagent runner.

Task 7 is the **coordinated rewire**: `AlgoEditor.tsx`, `EditorView.tsx`, and `App.tsx` change together (their prop shapes are mutually dependent) and ship in a single commit.

Task 8 is the final smoke + polish.

```
1 (hook)        ──┐
2 (theme)       ──┤
3 (StatusBar)   ──┼──▶ 7 (rewire) ──▶ 8 (smoke + polish)
4 (EditorTabs)  ──┤
5 (Sidebar)     ──┤
6 (AlgoManager) ──┘
```

---

### Task 1: Create `useEditorTabs` hook

**Files:**
- Create: `src/hooks/useEditorTabs.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useEditorTabs.ts` with this exact content:

```ts
import { useCallback, useMemo, useState } from "react";
import type { Algo } from "../types";

export type TabBuffer = {
  code: string;
  deps: string;
  savedCode: string;
  savedDeps: string;
};

type State = {
  openTabIds: number[];
  activeTabId: number | null;
  buffers: Record<number, TabBuffer>;
};

const EMPTY: State = {
  openTabIds: [],
  activeTabId: null,
  buffers: {},
};

export type UseEditorTabs = ReturnType<typeof useEditorTabs>;

export const useEditorTabs = () => {
  const [state, setState] = useState<State>(EMPTY);

  const isDirty = useCallback(
    (id: number): boolean => {
      const b = state.buffers[id];
      if (!b) return false;
      return b.code !== b.savedCode || b.deps !== b.savedDeps;
    },
    [state.buffers],
  );

  const hasAnyDirty = useMemo(
    () => state.openTabIds.some((id) => {
      const b = state.buffers[id];
      return !!b && (b.code !== b.savedCode || b.deps !== b.savedDeps);
    }),
    [state.openTabIds, state.buffers],
  );

  const openTab = useCallback((algo: Algo) => {
    setState((s) => {
      const alreadyOpen = s.openTabIds.includes(algo.id);
      if (alreadyOpen) {
        return { ...s, activeTabId: algo.id };
      }
      return {
        openTabIds: [...s.openTabIds, algo.id],
        activeTabId: algo.id,
        buffers: {
          ...s.buffers,
          [algo.id]: {
            code: algo.code,
            deps: algo.dependencies,
            savedCode: algo.code,
            savedDeps: algo.dependencies,
          },
        },
      };
    });
  }, []);

  const switchTab = useCallback((id: number) => {
    setState((s) => (s.openTabIds.includes(id) ? { ...s, activeTabId: id } : s));
  }, []);

  const pickNextActive = (openTabIds: number[], closingId: number): number | null => {
    const idx = openTabIds.indexOf(closingId);
    if (idx === -1) return null;
    // right neighbor
    if (idx + 1 < openTabIds.length) return openTabIds[idx + 1];
    // left neighbor
    if (idx - 1 >= 0) return openTabIds[idx - 1];
    return null;
  };

  const forceCloseTab = useCallback((id: number) => {
    setState((s) => {
      if (!s.openTabIds.includes(id)) return s;
      const nextOpen = s.openTabIds.filter((x) => x !== id);
      const nextActive =
        s.activeTabId === id ? pickNextActive(s.openTabIds, id) : s.activeTabId;
      const { [id]: _removed, ...nextBuffers } = s.buffers;
      return {
        openTabIds: nextOpen,
        activeTabId: nextActive,
        buffers: nextBuffers,
      };
    });
  }, []);

  const closeTab = useCallback(
    (id: number): { dirty: boolean } => {
      const dirty = isDirty(id);
      if (!dirty) {
        forceCloseTab(id);
      }
      return { dirty };
    },
    [isDirty, forceCloseTab],
  );

  const updateCode = useCallback((code: string) => {
    setState((s) => {
      if (s.activeTabId === null) return s;
      const b = s.buffers[s.activeTabId];
      if (!b) return s;
      return {
        ...s,
        buffers: { ...s.buffers, [s.activeTabId]: { ...b, code } },
      };
    });
  }, []);

  const updateDeps = useCallback((deps: string) => {
    setState((s) => {
      if (s.activeTabId === null) return s;
      const b = s.buffers[s.activeTabId];
      if (!b) return s;
      return {
        ...s,
        buffers: { ...s.buffers, [s.activeTabId]: { ...b, deps } },
      };
    });
  }, []);

  const markActiveSaved = useCallback(() => {
    setState((s) => {
      if (s.activeTabId === null) return s;
      const b = s.buffers[s.activeTabId];
      if (!b) return s;
      return {
        ...s,
        buffers: {
          ...s.buffers,
          [s.activeTabId]: { ...b, savedCode: b.code, savedDeps: b.deps },
        },
      };
    });
  }, []);

  const onAlgoDeleted = useCallback((id: number) => {
    setState((s) => {
      if (!s.openTabIds.includes(id)) return s;
      const nextOpen = s.openTabIds.filter((x) => x !== id);
      const nextActive =
        s.activeTabId === id ? pickNextActive(s.openTabIds, id) : s.activeTabId;
      const { [id]: _removed, ...nextBuffers } = s.buffers;
      return {
        openTabIds: nextOpen,
        activeTabId: nextActive,
        buffers: nextBuffers,
      };
    });
  }, []);

  type ExternalUpdateResult = { synced: boolean; conflicted: boolean };

  const onAlgoExternallyUpdated = useCallback(
    (id: number, code: string, deps: string): ExternalUpdateResult => {
      let result: ExternalUpdateResult = { synced: false, conflicted: false };
      setState((s) => {
        const b = s.buffers[id];
        if (!b) {
          result = { synced: false, conflicted: false };
          return s;
        }
        const dirty = b.code !== b.savedCode || b.deps !== b.savedDeps;
        if (dirty) {
          result = { synced: false, conflicted: true };
          return s;
        }
        result = { synced: true, conflicted: false };
        return {
          ...s,
          buffers: {
            ...s.buffers,
            [id]: { code, deps, savedCode: code, savedDeps: deps },
          },
        };
      });
      return result;
    },
    [],
  );

  const activeBuffer = state.activeTabId !== null ? state.buffers[state.activeTabId] : null;

  return {
    openTabIds: state.openTabIds,
    activeTabId: state.activeTabId,
    activeCode: activeBuffer?.code ?? "",
    activeDeps: activeBuffer?.deps ?? "",
    isDirty,
    hasAnyDirty,
    openTab,
    switchTab,
    closeTab,
    forceCloseTab,
    updateCode,
    updateDeps,
    markActiveSaved,
    onAlgoDeleted,
    onAlgoExternallyUpdated,
  };
};
```

Notes:
- `onAlgoExternallyUpdated` returns a result object so the caller (`App.tsx`) can toast on conflict. The spec requires that toast; putting the decision in the caller keeps the hook UI-free.
- The `pickNextActive` helper operates on the *pre-close* `openTabIds` array — that's the list where the neighbor indices make sense.
- `buffers` is a plain object (`Record<number, TabBuffer>`), not a `Map` — objects play nicely with React's reference-equality change detection when we spread.

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: no TypeScript errors. `tsc` completes cleanly, Vite build succeeds. The hook is imported by nothing yet, so it lives as dead code for this commit.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useEditorTabs.ts
git commit -m "feat(editor): add useEditorTabs hook for multi-tab state"
```

---

### Task 2: Create Monaco theme module

**Files:**
- Create: `src/lib/monacoTheme.ts`

- [ ] **Step 1: Write the theme module**

Create `src/lib/monacoTheme.ts` with this exact content:

```ts
import type { Monaco } from "@monaco-editor/react";

export const WOLF_DEN_THEME = "wolf-den-dark";

export const defineWolfDenTheme = (monaco: Monaco): void => {
  monaco.editor.defineTheme(WOLF_DEN_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c792ea" },
      { token: "keyword.flow", foreground: "c792ea" },
      { token: "operator", foreground: "89ddff" },
      { token: "delimiter", foreground: "89ddff" },
      { token: "string", foreground: "c3e88d" },
      { token: "string.escape", foreground: "c3e88d" },
      { token: "number", foreground: "f78c6c" },
      { token: "comment", foreground: "546e7a", fontStyle: "italic" },
      { token: "type", foreground: "ffcb6b" },
      { token: "type.identifier", foreground: "ffcb6b" },
      { token: "identifier", foreground: "e0e0e8" },
      // Python-specific (Monaco's python tokenizer emits these)
      { token: "keyword.python", foreground: "c792ea" },
      { token: "function", foreground: "82aaff" },
      { token: "function.call", foreground: "82aaff" },
      { token: "identifier.function", foreground: "82aaff" },
    ],
    colors: {
      "editor.background": "#1a1a28",
      "editor.foreground": "#e0e0e8",
      "editorLineNumber.foreground": "#55556a",
      "editorLineNumber.activeForeground": "#e0e0e8",
      "editor.selectionBackground": "#4d9fff33",
      "editor.lineHighlightBackground": "#4d9fff0d",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#4d9fff",
      "editorWidget.background": "#20202e",
      "editorWidget.border": "#2a2a3a",
      "editorIndentGuide.background": "#2a2a3a",
      "editorIndentGuide.activeBackground": "#3a3a4e",
      "editorBracketMatch.background": "#4d9fff26",
      "editorBracketMatch.border": "#4d9fff",
    },
  });
};
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: no TypeScript errors. The theme module is imported by nothing yet.

- [ ] **Step 3: Commit**

```bash
git add src/lib/monacoTheme.ts
git commit -m "feat(editor): add wolf-den-dark Monaco theme"
```

---

### Task 3: Create `EditorStatusBar` component

**Files:**
- Create: `src/components/EditorStatusBar.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/EditorStatusBar.tsx` with this exact content:

```tsx
type EditorStatusBarProps = {
  isDirty: boolean;
  depsCount: number;
  cursorLine: number;
  cursorCol: number;
  onSave: () => void;
  onToggleDeps: () => void;
};

export const EditorStatusBar = ({
  isDirty,
  depsCount,
  cursorLine,
  cursorCol,
  onSave,
  onToggleDeps,
}: EditorStatusBarProps) => {
  return (
    <div className="flex items-center justify-between h-[26px] px-4 border-t border-[var(--border)] bg-[var(--bg-panel)] text-[11px] text-[var(--text-secondary)] select-none">
      {/* Left group */}
      <div className="flex items-center gap-4">
        {isDirty ? (
          <button
            onClick={onSave}
            className="flex items-center gap-2 px-1 -mx-1 rounded hover:bg-[var(--bg-secondary)] transition-colors text-[var(--accent-yellow)]"
            title="Save changes"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-yellow)]" />
            <span>Unsaved · ⌘S</span>
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
            <span>Saved</span>
          </span>
        )}
        <span className="text-[var(--text-muted)]">Python 3.11</span>
        <button
          onClick={onToggleDeps}
          className="px-1 -mx-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
          title="Toggle dependencies"
        >
          deps: {depsCount}
        </button>
      </div>

      {/* Right group */}
      <div className="flex items-center gap-4 text-[var(--text-muted)]">
        <span>
          Ln {cursorLine}, Col {cursorCol}
        </span>
        <span>Spaces: 4</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorStatusBar.tsx
git commit -m "feat(editor): add EditorStatusBar component"
```

---

### Task 4: Create `EditorTabs` component

**Files:**
- Create: `src/components/EditorTabs.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/EditorTabs.tsx` with this exact content:

```tsx
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus, Sparkles, X } from "lucide-react";

export type EditorTab = {
  id: number;
  name: string;
  isDirty: boolean;
  hasAiTerminal: boolean;
};

type EditorTabsProps = {
  tabs: EditorTab[];
  activeTabId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onCreateAlgo: () => void;
  onCreateAlgoWithAi: () => void;
  onRenameActive: () => void;
  onDeleteActive: () => void;
  onCloseOthers: (id: number) => void;
  onCloseAll: () => void;
};

export const EditorTabs = ({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreateAlgo,
  onCreateAlgoWithAi,
  onRenameActive,
  onDeleteActive,
  onCloseOthers,
  onCloseAll,
}: EditorTabsProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const menuAction = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <div className="flex items-stretch h-[38px] bg-[var(--bg-secondary)] border-b border-[var(--border)]">
      <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={`group/tab relative flex items-center gap-2 px-3 text-xs cursor-pointer flex-shrink-0 border-r border-[var(--border)] transition-colors ${
                isActive
                  ? "bg-[var(--bg-panel)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)]/30"
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--accent-blue)]" />
              )}
              <span className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-[3px] bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] text-[9px] font-bold flex-shrink-0">
                Py
              </span>
              <span className="max-w-[180px] truncate">{tab.name}</span>
              {tab.hasAiTerminal && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse flex-shrink-0"
                  title="AI terminal active"
                />
              )}
              {tab.isDirty && !tab.hasAiTerminal && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-yellow)] flex-shrink-0 group-hover/tab:hidden"
                  title="Unsaved"
                />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="inline-flex items-center justify-center w-4 h-4 rounded opacity-0 group-hover/tab:opacity-100 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-opacity flex-shrink-0"
                title="Close tab"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 px-2 flex-shrink-0 border-l border-[var(--border)]">
        <button
          onClick={onCreateAlgo}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors"
          title="New algo"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={onCreateAlgoWithAi}
          className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:bg-[var(--bg-panel)] transition-colors"
          title="New algo with AI"
        >
          <Sparkles size={13} />
        </button>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={activeTabId === null}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="More actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && activeTabId !== null && (
            <div className="absolute right-0 top-full mt-1 z-30 w-44 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md shadow-xl py-1 text-xs">
              <MenuItem label="Rename" onClick={menuAction(onRenameActive)} />
              <MenuItem
                label="Close others"
                onClick={menuAction(() => onCloseOthers(activeTabId))}
                disabled={tabs.length < 2}
              />
              <MenuItem
                label="Close all"
                onClick={menuAction(onCloseAll)}
              />
              <div className="h-px bg-[var(--border)] my-1" />
              <MenuItem
                label="Delete algo"
                onClick={menuAction(onDeleteActive)}
                danger
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

type MenuItemProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const MenuItem = ({ label, onClick, disabled, danger }: MenuItemProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full text-left px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger
        ? "text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
        : "text-[var(--text-primary)] hover:bg-[var(--bg-panel)]"
    }`}
  >
    {label}
  </button>
);
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorTabs.tsx
git commit -m "feat(editor): add EditorTabs component"
```

---

### Task 5: Restyle `Sidebar.tsx` to 52px icon-only rail

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `src/components/Sidebar.tsx` with this exact content:

```tsx
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { View } from "../types";

type SidebarProps = {
  activeView: View;
  onNavigate: (view: View) => void;
  connectionStatus: "waiting" | "connected" | "error";
};

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: "home", label: "Home", icon: "⌂" },
  { view: "editor", label: "Editor", icon: "λ" },
  { view: "algos", label: "Algos", icon: "▶" },
  { view: "trading", label: "Trading", icon: "⇅" },
];

const openGuideWindow = async () => {
  const existing = await WebviewWindow.getByLabel("guide");
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow("guide", {
    title: "Wolf Den — Guide",
    url: "guide.html",
    width: 1200,
    height: 900,
    resizable: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
};

export const Sidebar = ({ activeView, onNavigate, connectionStatus }: SidebarProps) => {
  const statusTitle =
    connectionStatus === "connected"
      ? "NinjaTrader Connected"
      : connectionStatus === "error"
        ? "Connection Error"
        : "Waiting for NinjaTrader...";

  return (
    <div className="relative flex flex-col w-[52px] bg-[var(--bg-secondary)] border-r border-[var(--border)] select-none">
      {/* Logo */}
      <div className="flex items-center justify-center h-12 border-b border-[var(--border)] p-1.5">
        <img src="/wolf-den-logo.svg" alt="Wolf Den" className="w-8 h-8 object-contain" />
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col items-center pt-3 gap-1">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button
            key={view}
            onClick={() => onNavigate(view)}
            title={label}
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              activeView === view
                ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="text-base leading-none">{icon}</span>
          </button>
        ))}
      </nav>

      {/* Guide (bottom) */}
      <div className="flex flex-col items-center pb-2 gap-1">
        <button
          onClick={openGuideWindow}
          title="Guide"
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
        >
          <span className="text-base leading-none">?</span>
        </button>
      </div>

      {/* Connection Status — bottom-right corner */}
      <div
        title={statusTitle}
        className={`absolute bottom-2 right-2 w-2 h-2 rounded-full ${
          connectionStatus === "connected"
            ? "bg-[var(--accent-green)]"
            : connectionStatus === "error"
              ? "bg-[var(--accent-red)]"
              : "bg-[var(--accent-yellow)] animate-pulse"
        }`}
      />
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Smoke**

```bash
npm run tauri dev
```

Verify each view still renders:
- Home view loads; left rail is 52px wide, icons-only, no text labels.
- Click Editor → opens Editor (still today's layout at this point — Task 7 rewires it).
- Click Algos → loads. Click Trading → loads.
- Connection dot is visible in bottom-right of rail; color reflects NinjaTrader state.
- Hover an icon → tooltip shows the view label.

Close the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(ui): restyle Sidebar to 52px icon-only rail"
```

---

### Task 6: Refresh `AlgoManager.tsx` — filter, dirty dot, overflow menu

**Files:**
- Modify: `src/components/AlgoManager.tsx`

- [ ] **Step 1: Replace the file**

Overwrite `src/components/AlgoManager.tsx` with this exact content:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Search, Sparkles, Terminal, Trash2 } from "lucide-react";
import type { Algo } from "../types";

type AlgoManagerProps = {
  algos: Algo[];
  selectedAlgoId: number | null;
  dirtyAlgoIds?: Set<number>;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onCreateAlgoWithAi?: () => void;
  onOpenAiTerminal?: (algoId: number) => void;
  aiTerminalAlgoIds?: Set<number>;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
};

export const AlgoManager = ({
  algos,
  selectedAlgoId,
  dirtyAlgoIds,
  onSelectAlgo,
  onCreateAlgo,
  onCreateAlgoWithAi,
  onOpenAiTerminal,
  aiTerminalAlgoIds,
  onDeleteAlgo,
  onRenameAlgo,
}: AlgoManagerProps) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [filter, setFilter] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (menuOpenId === null) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpenId]);

  const startRename = (algo: Algo) => {
    setMenuOpenId(null);
    setEditingId(algo.id);
    setEditingName(algo.name);
  };

  const commitRename = () => {
    if (editingId === null) return;
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== algos.find((a) => a.id === editingId)?.name) {
      onRenameAlgo(editingId, trimmed);
    }
    setEditingId(null);
  };

  const cancelRename = () => setEditingId(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return algos;
    return algos.filter((a) => a.name.toLowerCase().includes(q));
  }, [algos, filter]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Algos · {algos.length}
          </span>
          <div className="flex items-center gap-1">
            {onCreateAlgoWithAi && (
              <button
                onClick={onCreateAlgoWithAi}
                title="New algo with AI"
                className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
              >
                <Sparkles size={13} />
              </button>
            )}
            <button
              onClick={onCreateAlgo}
              title="New algo"
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter algos…"
            className="w-full bg-[var(--bg-secondary)] border border-transparent rounded-md pl-8 pr-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-1.5">
        {algos.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            No algos yet. Click <span className="inline-block align-middle"><Plus size={12} /></span> to create one.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            No algos match "{filter}".
          </div>
        ) : (
          filtered.map((algo) => {
            const isSelected = algo.id === selectedAlgoId;
            const isEditing = editingId === algo.id;
            const isDirty = dirtyAlgoIds?.has(algo.id) ?? false;
            const hasActiveTerminal = aiTerminalAlgoIds?.has(algo.id) ?? false;
            const menuOpen = menuOpenId === algo.id;

            return (
              <div
                key={algo.id}
                onClick={() => !isEditing && onSelectAlgo(algo.id)}
                className={`group/algo relative flex items-center justify-between px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-[var(--accent-blue)]/10 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {isDirty && !isEditing && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-yellow)] flex-shrink-0"
                      title="Unsaved"
                    />
                  )}
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--accent-blue)] rounded px-2 py-0.5 outline-none w-full min-w-0"
                    />
                  ) : (
                    <span className="text-sm truncate">{algo.name}</span>
                  )}
                  {hasActiveTerminal && !isEditing && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse flex-shrink-0"
                      title="AI terminal active"
                    />
                  )}
                </div>
                {!isEditing && (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpen ? null : algo.id);
                      }}
                      className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors"
                      title="More actions"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {menuOpen && (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full mt-1 z-30 w-44 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md shadow-xl py-1 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MenuRow
                          icon={<Pencil size={11} />}
                          label="Rename"
                          onClick={() => startRename(algo)}
                        />
                        {onOpenAiTerminal && (
                          <MenuRow
                            icon={<Terminal size={11} />}
                            label="AI terminal"
                            disabled={hasActiveTerminal}
                            onClick={() => {
                              setMenuOpenId(null);
                              onSelectAlgo(algo.id);
                              onOpenAiTerminal(algo.id);
                            }}
                          />
                        )}
                        <div className="h-px bg-[var(--border)] my-1" />
                        <MenuRow
                          icon={<Trash2 size={11} />}
                          label="Delete"
                          danger
                          onClick={() => {
                            setMenuOpenId(null);
                            onSelectAlgo(algo.id);
                            onDeleteAlgo(algo.id);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

type MenuRowProps = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const MenuRow = ({ icon, label, onClick, disabled, danger }: MenuRowProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger
        ? "text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
        : "text-[var(--text-primary)] hover:bg-[var(--bg-panel)]"
    }`}
  >
    <span className="text-[var(--text-muted)]">{icon}</span>
    <span>{label}</span>
  </button>
);
```

Notes:
- `dirtyAlgoIds?: Set<number>` is optional so this change is backward-compatible while Task 7 is pending. After Task 7 the caller will always pass it.
- The old hover-only row of buttons is gone. The overflow menu carries rename / AI terminal / delete. The outer `onClick` still selects the algo — that preserves today's row-click semantic.
- **Spec deviation (intentional):** the spec mentions an "Open" menu item (conditional on not-in-`openTabIds`). In practice the row-click already does the same thing (`handleSelectAlgo` → `tabs.openTab`), so a redundant menu item hurts UX more than it helps. Omitted. If you prefer the spec literal, add an `openTabIds?: Set<number>` prop and an `Open` menu item above `Rename` guarded by `!openTabIds.has(algo.id)`.

- [ ] **Step 2: Type-check**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Smoke**

```bash
npm run tauri dev
```

Verify on the Editor view (still today's layout until Task 7):
- Algo list renders with the new filter input at the top.
- Typing in the filter narrows the list.
- Clicking `⋯` on an algo opens the overflow menu; it closes when you click elsewhere.
- Rename from the menu still works.
- Delete from the menu still triggers the existing confirm dialog and deletes the algo.
- `+` creates a new algo; `Sparkles` creates with AI.
- AI-terminal pulse dot still appears on algos with an active terminal.

Close the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/AlgoManager.tsx
git commit -m "feat(editor): refresh AlgoManager with filter and overflow menu"
```

---

### Task 7: Coordinated rewire — `AlgoEditor` + `EditorView` + `App`

This is the keystone task. Three files change together because their prop shapes are mutually dependent. Implement in the order below, run `npm run build` once at the end, then walk the full smoke matrix, then commit once.

**Files:**
- Modify: `src/components/AlgoEditor.tsx`
- Modify: `src/views/EditorView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Slim `src/components/AlgoEditor.tsx`**

Overwrite `src/components/AlgoEditor.tsx` with this exact content:

```tsx
import { useCallback } from "react";
import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import { defineWolfDenTheme, WOLF_DEN_THEME } from "../lib/monacoTheme";

type AlgoEditorProps = {
  code: string;
  deps: string;
  showDeps: boolean;
  onChange: (value: string) => void;
  onDepsChange: (value: string) => void;
  onSave: () => void;
  onCursorChange: (line: number, col: number) => void;
};

export const DEFAULT_ALGO = `from wolf_types import AlgoResult, market_buy, market_sell


def create_algo():
    """Return a dict of handler functions."""

    def init():
        return {'prices': ()}

    def on_tick(state, tick, ctx):
        prices = (*state['prices'], tick.price)[-20:]
        new_state = {**state, 'prices': prices}
        return AlgoResult(new_state, ())

    return {'init': init, 'on_tick': on_tick}
`;

export const AlgoEditor = ({
  code,
  deps,
  showDeps,
  onChange,
  onDepsChange,
  onSave,
  onCursorChange,
}: AlgoEditorProps) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  const beforeMount = useCallback((monaco: Monaco) => {
    defineWolfDenTheme(monaco);
  }, []);

  const onMount = useCallback(
    (editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>["onMount"]>>[0]) => {
      editor.onDidChangeCursorPosition((e) => {
        onCursorChange(e.position.lineNumber, e.position.column);
      });
      const pos = editor.getPosition();
      if (pos) onCursorChange(pos.lineNumber, pos.column);
    },
    [onCursorChange],
  );

  return (
    <div
      className="flex flex-col h-full"
      onKeyDown={handleKeyDown as unknown as React.KeyboardEventHandler}
    >
      {showDeps && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <label className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold block mb-1.5">
            Pip Dependencies
          </label>
          <input
            type="text"
            value={deps}
            onChange={(e) => onDepsChange(e.target.value)}
            placeholder="e.g. tensorflow pandas scikit-learn"
            className="w-full px-3 py-2 text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-[var(--accent-blue)]/50"
          />
          <p className="text-[10px] text-[var(--text-secondary)] mt-1.5">
            Space-separated pip packages. Installed automatically when the algo starts.
          </p>
        </div>
      )}
      <div className="flex-1 p-0.5">
        <Editor
          height="100%"
          defaultLanguage="python"
          theme={WOLF_DEN_THEME}
          beforeMount={beforeMount}
          onMount={onMount}
          value={code}
          onChange={(value) => onChange(value ?? "")}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: "off",
            lineNumbers: "on",
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            smoothScrolling: true,
          }}
        />
      </div>
    </div>
  );
};
```

Key changes:
- No header. The deps toggle button / save button / label are gone.
- `showDeps` is a prop (controlled by parent via the status bar).
- `beforeMount` registers the wolf-den-dark theme; `theme` prop applies it.
- `onMount` wires cursor position reporting.
- `DEFAULT_ALGO` export stays — `App.tsx` imports it.

- [ ] **Step 2: Rewrite `src/views/EditorView.tsx`**

Overwrite `src/views/EditorView.tsx` with this exact content:

```tsx
import { useState } from "react";
import { AlgoEditor } from "../components/AlgoEditor";
import { AlgoManager } from "../components/AlgoManager";
import { EditorTabs, type EditorTab } from "../components/EditorTabs";
import { EditorStatusBar } from "../components/EditorStatusBar";
import type { UseEditorTabs } from "../hooks/useEditorTabs";
import type { Algo } from "../types";

type EditorViewProps = {
  algos: Algo[];
  tabs: UseEditorTabs;
  aiTerminalAlgoIds: Set<number>;
  onSelectAlgo: (id: number) => void;
  onCreateAlgo: () => void;
  onCreateAlgoWithAi: () => void;
  onOpenAiTerminal: (algoId: number) => void;
  onRequestCloseTab: (id: number) => void;
  onDeleteAlgo: (id: number) => void;
  onRenameAlgo: (id: number, newName: string) => void;
  onSaveAlgo: () => void;
  onRenameActiveAlgo: () => void;
};

export const EditorView = ({
  algos,
  tabs,
  aiTerminalAlgoIds,
  onSelectAlgo,
  onCreateAlgo,
  onCreateAlgoWithAi,
  onOpenAiTerminal,
  onRequestCloseTab,
  onDeleteAlgo,
  onRenameAlgo,
  onSaveAlgo,
  onRenameActiveAlgo,
}: EditorViewProps) => {
  const [showDeps, setShowDeps] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const activeTabId = tabs.activeTabId;
  const dirtyAlgoIds = new Set(tabs.openTabIds.filter((id) => tabs.isDirty(id)));

  const tabItems: EditorTab[] = tabs.openTabIds.map((id) => {
    const algo = algos.find((a) => a.id === id);
    return {
      id,
      name: algo?.name ?? `algo_${id}`,
      isDirty: tabs.isDirty(id),
      hasAiTerminal: aiTerminalAlgoIds.has(id),
    };
  });

  const depsCount = tabs.activeDeps.split(/\s+/).filter(Boolean).length;
  const isActiveDirty = activeTabId !== null ? tabs.isDirty(activeTabId) : false;

  const handleCloseOthers = (keepId: number) => {
    for (const id of [...tabs.openTabIds]) {
      if (id !== keepId) onRequestCloseTab(id);
    }
  };

  const handleCloseAll = () => {
    for (const id of [...tabs.openTabIds]) {
      onRequestCloseTab(id);
    }
  };

  const handleDeleteActive = () => {
    if (activeTabId !== null) onDeleteAlgo(activeTabId);
  };

  return (
    <div className="flex-1 flex gap-3 p-4 overflow-hidden">
      {/* Left: Algo List */}
      <div className="w-72 flex-shrink-0 bg-[var(--bg-panel)] rounded-lg overflow-hidden">
        <AlgoManager
          algos={algos}
          selectedAlgoId={activeTabId}
          dirtyAlgoIds={dirtyAlgoIds}
          onSelectAlgo={onSelectAlgo}
          onCreateAlgo={onCreateAlgo}
          onCreateAlgoWithAi={onCreateAlgoWithAi}
          onOpenAiTerminal={onOpenAiTerminal}
          aiTerminalAlgoIds={aiTerminalAlgoIds}
          onDeleteAlgo={onDeleteAlgo}
          onRenameAlgo={onRenameAlgo}
        />
      </div>

      {/* Right: Editor column */}
      <div className="flex-1 bg-[var(--bg-panel)] rounded-lg overflow-hidden flex flex-col">
        <EditorTabs
          tabs={tabItems}
          activeTabId={activeTabId}
          onSelect={(id) => tabs.switchTab(id)}
          onClose={onRequestCloseTab}
          onCreateAlgo={onCreateAlgo}
          onCreateAlgoWithAi={onCreateAlgoWithAi}
          onRenameActive={onRenameActiveAlgo}
          onDeleteActive={handleDeleteActive}
          onCloseOthers={handleCloseOthers}
          onCloseAll={handleCloseAll}
        />

        {activeTabId !== null ? (
          <>
            <div className="flex-1 min-h-0">
              <AlgoEditor
                code={tabs.activeCode}
                deps={tabs.activeDeps}
                showDeps={showDeps}
                onChange={tabs.updateCode}
                onDepsChange={tabs.updateDeps}
                onSave={onSaveAlgo}
                onCursorChange={(line, col) => setCursor({ line, col })}
              />
            </div>
            <EditorStatusBar
              isDirty={isActiveDirty}
              depsCount={depsCount}
              cursorLine={cursor.line}
              cursorCol={cursor.col}
              onSave={onSaveAlgo}
              onToggleDeps={() => setShowDeps((v) => !v)}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
            {algos.length === 0
              ? "Create an algo to get started"
              : "Select an algo to edit"}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Rewrite `src/App.tsx`**

Overwrite `src/App.tsx` with this exact content:

```tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_ALGO } from "./components/AlgoEditor";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./views/HomeView";
import { EditorView } from "./views/EditorView";
import { AlgosView } from "./views/AlgosView";
import { TradingView } from "./views/TradingView";
import { TitleBar } from "./components/TitleBar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { AiTerminalPanel } from "./components/AiTerminalPanel";
import { ToastContainer, toast } from "./components/Toast";
import { useTradingSimulation } from "./hooks/useTradingSimulation";
import { useAlgoErrors } from "./hooks/useAlgoErrors";
import { useAlgoLogs } from "./hooks/useAlgoLogs";
import { useAlgoHealth } from "./hooks/useAlgoHealth";
import { useEditorTabs } from "./hooks/useEditorTabs";
import type { DataSource } from "./hooks/useTradingSimulation";
import { VenvSetupModal } from "./components/VenvSetupModal";
import type { Algo, AlgoRun, View, NavOptions, NavContext } from "./types";

export const App = () => {
  const [activeView, setActiveView] = useState<View>("home");
  const [pendingNavContext, setPendingNavContext] = useState<NavContext | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"waiting" | "connected" | "error">("waiting");
  const [accounts, setAccounts] = useState<Record<string, { buying_power: number; cash: number; realized_pnl: number }>>({});
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [algos, setAlgos] = useState<Algo[]>([]);
  const [activeRuns, setActiveRuns] = useState<AlgoRun[]>([]);

  const tabs = useEditorTabs();
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const algosRef = useRef(algos);
  useEffect(() => {
    algosRef.current = algos;
  }, [algos]);

  const activeRunsRef = useRef(activeRuns);
  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);

  const [aiTerminalAlgoIds, setAiTerminalAlgoIds] = useState<Set<number>>(new Set());
  const [venvReady, setVenvReady] = useState<boolean | null>(null);

  const simulation = useTradingSimulation(algos, activeRuns, dataSources);

  const handleAutoStop = useCallback(async (instanceId: string) => {
    toast.error(`Algo instance ${instanceId.slice(0, 8)}... halted due to repeated errors`);
    try {
      await invoke("stop_algo_instance", { instanceId });
    } catch (e) {
      console.error("Failed to auto-stop algo:", e);
    }
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
  }, []);

  const { errorsByInstance, clearErrors } = useAlgoErrors(handleAutoStop);
  const { logsByInstance, clearLogs } = useAlgoLogs();
  const { healthByInstance } = useAlgoHealth();

  const aiTerminalAlgos = algos.filter((a) => aiTerminalAlgoIds.has(a.id));

  const loadAlgos = useCallback(async () => {
    try {
      const result = await invoke<Algo[]>("get_algos");
      setAlgos(result);
    } catch (e) {
      console.error("Failed to load algos:", e);
    }
  }, []);

  const loadRunningInstances = useCallback(async () => {
    try {
      type Instance = { id: string; algo_id: number; data_source_id: string; account: string; mode: string; status: string };
      const instances = await invoke<Instance[]>("get_algo_instances", { dataSourceId: null });
      const running = instances
        .filter((i) => i.status === "running")
        .map((i) => ({
          algo_id: i.algo_id,
          status: i.status,
          mode: i.mode,
          account: i.account,
          data_source_id: i.data_source_id,
          instance_id: i.id,
        }));
      setActiveRuns(running);
    } catch (e) {
      console.error("Failed to load running instances:", e);
    }
  }, []);

  useEffect(() => {
    loadAlgos();
    loadRunningInstances();
  }, [loadAlgos, loadRunningInstances]);

  useEffect(() => {
    const checkVenv = async () => {
      try {
        const status = await invoke<{ healthy: boolean }>("check_venv_status");
        if (status.healthy) {
          setVenvReady(true);
        } else {
          setVenvReady(false);
        }
      } catch {
        setVenvReady(false);
      }
    };
    checkVenv();
  }, []);

  useEffect(() => {
    const u1 = listen<number>("nt-connection-count", (event) => {
      setConnectionStatus(event.payload > 0 ? "connected" : "waiting");
    });
    const u2 = listen<{ name: string; buying_power: number; cash: number; realized_pnl: number }>("nt-account", (event) => {
      const { name, ...data } = event.payload;
      setAccounts((prev) => ({ ...prev, [name]: data }));
    });
    const u3 = listen<string>("nt-account-removed", (event) => {
      setAccounts((prev) => {
        const next = { ...prev };
        delete next[event.payload];
        return next;
      });
    });
    const u4 = listen<DataSource>("nt-chart", (event) => {
      setDataSources((prev) => {
        const exists = prev.some((ds) => ds.id === event.payload.id);
        if (exists) return prev.map((ds) => ds.id === event.payload.id ? event.payload : ds);
        return [...prev, event.payload];
      });
    });
    const u5 = listen<string>("nt-chart-removed", (event) => {
      const removedId = event.payload;
      setDataSources((prev) => prev.filter((ds) => ds.id !== removedId));
      const toStop = activeRunsRef.current.filter((r) => r.data_source_id === removedId);
      for (const run of toStop) {
        invoke("stop_algo_instance", { instanceId: run.instance_id }).catch((e) =>
          console.error("Failed to stop algo on chart disconnect:", e)
        );
      }
      setActiveRuns((prev) => prev.filter((r) => r.data_source_id !== removedId));
    });
    const u6 = listen<{ algo_id: number; code: string }>("algo-code-updated", (event) => {
      const { algo_id, code } = event.payload;
      const algo = algosRef.current.find((a) => a.id === algo_id);
      const deps = algo?.dependencies ?? "";
      setAlgos((prev) =>
        prev.map((a) => (a.id === algo_id ? { ...a, code, updated_at: new Date().toISOString() } : a))
      );
      const result = tabsRef.current.onAlgoExternallyUpdated(algo_id, code, deps);
      if (result.conflicted) {
        const name = algosRef.current.find((a) => a.id === algo_id)?.name ?? `algo ${algo_id}`;
        toast.error(`External update to ${name}. Your unsaved edits will overwrite it on save.`);
      }
    });
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
      u3.then((f) => f());
      u4.then((f) => f());
      u5.then((f) => f());
      u6.then((f) => f());
    };
  }, []);

  const [confirmDialog, setConfirmDialog] = useState<{ message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

  const handleNavigate = (view: View, options?: NavOptions) => {
    if (view === activeView && !options) return;
    setPendingNavContext(options ? { ...options, targetView: view } : null);
    setActiveView(view);
  };

  const clearPendingNavContext = useCallback(() => {
    setPendingNavContext(null);
  }, []);

  const handleSelectAlgo = (id: number) => {
    const algo = algos.find((a) => a.id === id);
    if (!algo) return;
    tabs.openTab(algo);
  };

  const handleRequestCloseTab = (id: number) => {
    const { dirty } = tabs.closeTab(id);
    if (!dirty) return;
    const name = algos.find((a) => a.id === id)?.name ?? `algo ${id}`;
    setConfirmDialog({
      message: `Close ${name}? Unsaved changes will be lost.`,
      confirmLabel: "Close",
      onConfirm: () => {
        tabs.forceCloseTab(id);
        setConfirmDialog(null);
      },
    });
  };

  const handleCreateAlgo = async () => {
    try {
      const name = `algo_${Date.now()}`;
      const algo = await invoke<Algo>("create_algo", {
        name,
        code: DEFAULT_ALGO,
        dependencies: "",
      });
      setAlgos((prev) => [algo, ...prev]);
      tabs.openTab(algo);
    } catch (e) {
      console.error("Failed to create algo:", e);
      toast.error("Failed to create algo: " + e);
    }
  };

  const handleSaveAlgo = async () => {
    const activeId = tabs.activeTabId;
    if (activeId === null) return;
    const algo = algos.find((a) => a.id === activeId);
    if (!algo) return;
    try {
      await invoke("update_algo", {
        id: algo.id,
        name: algo.name,
        code: tabs.activeCode,
        dependencies: tabs.activeDeps,
      });
      tabs.markActiveSaved();
      await loadAlgos();
    } catch (e) {
      console.error("Failed to save algo:", e);
      toast.error("Failed to save: " + e);
    }
  };

  const handleRenameAlgo = async (id: number, newName: string) => {
    const algo = algos.find((a) => a.id === id);
    if (!algo) return;
    try {
      await invoke("update_algo", {
        id,
        name: newName,
        code: algo.code,
        dependencies: algo.dependencies,
      });
      await loadAlgos();
    } catch (e) {
      console.error("Failed to rename algo:", e);
    }
  };

  const handleRenameActiveAlgo = () => {
    // Rename is inline in AlgoManager; from the tab-strip menu we jump the user to
    // the sidebar item and let them trigger inline rename there. Simplest in v1:
    // toast the user with a hint. (A focused rename modal is a follow-up.)
    const activeId = tabs.activeTabId;
    if (activeId === null) return;
    const algo = algos.find((a) => a.id === activeId);
    if (!algo) return;
    const newName = window.prompt("Rename algo", algo.name);
    if (newName && newName.trim() && newName.trim() !== algo.name) {
      handleRenameAlgo(activeId, newName.trim());
    }
  };

  const handleDeleteAlgo = (id: number) => {
    setConfirmDialog({
      message: "Are you sure you want to delete this algo?",
      confirmLabel: "Delete",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await invoke("delete_algo", { id });
          tabs.onAlgoDeleted(id);
          await loadAlgos();
        } catch (e) {
          console.error("Failed to delete algo:", e);
        }
      },
    });
  };

  const handleCreateAlgoWithAi = useCallback(async () => {
    try {
      const name = `algo_${Date.now()}`;
      const algo = await invoke<Algo>("create_algo", {
        name,
        code: DEFAULT_ALGO,
        dependencies: "",
      });
      setAlgos((prev) => [algo, ...prev]);
      tabs.openTab(algo);
      setAiTerminalAlgoIds((prev) => new Set(prev).add(algo.id));
    } catch (e) {
      console.error("Failed to create algo:", e);
      toast.error("Failed to create algo: " + e);
    }
  }, [tabs]);

  const handleOpenAiTerminal = useCallback((algoId: number) => {
    if (aiTerminalAlgoIds.has(algoId)) return;
    setAiTerminalAlgoIds((prev) => new Set(prev).add(algoId));
  }, [aiTerminalAlgoIds]);

  const handleCloseAiTerminal = useCallback((algoId: number) => {
    setAiTerminalAlgoIds((prev) => {
      const next = new Set(prev);
      next.delete(algoId);
      return next;
    });
  }, []);

  const handleStartAlgo = async (id: number, mode: "live" | "shadow", account: string, dataSourceId: string) => {
    let instanceId: string | null = null;
    try {
      const instance = await invoke<{ id: string }>("create_algo_instance", {
        algoId: id,
        dataSourceId: dataSourceId,
        account,
        mode,
      });
      instanceId = instance.id;
      setActiveRuns((prev) => [...prev, {
        algo_id: id, status: "installing", mode, account,
        data_source_id: dataSourceId, instance_id: instanceId!,
      }]);
      await invoke("start_algo_instance", { instanceId });
      setActiveRuns((prev) => prev.map((r) =>
        r.instance_id === instanceId ? { ...r, status: "running" } : r
      ));
    } catch (e) {
      console.error("Failed to start algo:", e);
      if (instanceId) {
        setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
      }
      toast.error("Failed to start algo: " + e);
    }
  };

  const handleStopAlgo = async (instanceId: string) => {
    try {
      await invoke("stop_algo_instance", { instanceId });
    } catch (e) {
      console.error("Failed to stop algo:", e);
    }
    setActiveRuns((prev) => prev.filter((r) => r.instance_id !== instanceId));
    clearErrors(instanceId);
    clearLogs(instanceId);
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <TitleBar title="Wolf Den" />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          connectionStatus={connectionStatus}
        />

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

        {activeView === "editor" && (
          <EditorView
            algos={algos}
            tabs={tabs}
            aiTerminalAlgoIds={aiTerminalAlgoIds}
            onSelectAlgo={handleSelectAlgo}
            onCreateAlgo={handleCreateAlgo}
            onCreateAlgoWithAi={handleCreateAlgoWithAi}
            onOpenAiTerminal={handleOpenAiTerminal}
            onRequestCloseTab={handleRequestCloseTab}
            onDeleteAlgo={handleDeleteAlgo}
            onRenameAlgo={handleRenameAlgo}
            onSaveAlgo={handleSaveAlgo}
            onRenameActiveAlgo={handleRenameActiveAlgo}
          />
        )}

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

        {activeView === "trading" && (
          <TradingView
            simulation={simulation}
            algos={algos}
            activeRuns={activeRuns}
            initialContext={pendingNavContext}
            onContextConsumed={clearPendingNavContext}
          />
        )}

        {aiTerminalAlgos.length > 0 && (
          <AiTerminalPanel
            tabs={aiTerminalAlgos.map((a) => ({ algoId: a.id, algoName: a.name }))}
            selectedAlgoId={tabs.activeTabId}
            onSelectAlgo={(id) => {
              const algo = algos.find((a) => a.id === id);
              if (algo) tabs.openTab(algo);
            }}
            onClose={handleCloseAiTerminal}
            onSpawnError={(algoId, error) => {
              handleCloseAiTerminal(algoId);
              if (error.includes("not found")) {
                toast.error("Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code");
              } else {
                toast.error("Failed to start AI terminal: " + error);
              }
            }}
          />
        )}
      </div>

      {venvReady === false && (
        <VenvSetupModal onComplete={() => setVenvReady(true)} />
      )}

      {confirmDialog !== null && (
        <ConfirmDialog
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      <ToastContainer />
    </div>
  );
};
```

Notable deltas vs. today's `App.tsx`:
- Removed: `selectedAlgoId`, `selectedAlgoIdRef`, `editorCode`, `editorDeps`, `hasUnsavedChanges`, the `selectedAlgo`-→-editor-state `useEffect`, the unsaved-guard branches in `handleNavigate` and `handleSelectAlgo`.
- Added: `const tabs = useEditorTabs()`, `tabsRef`, `algosRef` (used by the `algo-code-updated` listener to read latest state without re-subscribing).
- `algo-code-updated` listener now routes to `tabs.onAlgoExternallyUpdated` and toasts on conflict instead of stomping the editor buffer.
- `handleRequestCloseTab` is the new route for tab-close clicks — it uses the existing `ConfirmDialog` pattern.
- `handleRenameActiveAlgo` uses `window.prompt` as a minimal inline path. Hand-rolled rename modal is a follow-up.
- `AiTerminalPanel.selectedAlgoId` now reflects `tabs.activeTabId`; clicking an AI-terminal tab calls `tabs.openTab(algo)`.

- [ ] **Step 4: Type-check**

```bash
npm run build
```

Expected: zero TypeScript errors. If any errors surface, they are almost certainly prop-shape mismatches between the three files edited in this task — re-read the three overwrites in this task and confirm the types line up.

- [ ] **Step 5: Smoke — full matrix**

```bash
npm run tauri dev
```

Walk the full matrix from the spec:

1. **Home view** renders. Left rail is 52px icon-only. Connection dot visible bottom-right.
2. **Navigate to Editor** — empty state ("Create an algo to get started" or "Select an algo to edit") because no tab is open.
3. Open **3 algos** in sequence from the sidebar — each opens a new tab and becomes active.
4. **Switch between tabs** — editor shows each algo's buffer; active tab highlighted; no confirm dialog.
5. **Edit tab A**, switch to B, switch back to A — A's edits are preserved, A still shows the yellow dirty dot in tab strip, in the sidebar list, and in the status bar.
6. **Press ⌘S** on the dirty tab — status bar transitions to "Saved" (green dot); dirty dots clear in tab strip + sidebar + status bar.
7. **Click the status bar "Unsaved · ⌘S" chip** on a dirty tab — saves identically to ⌘S.
8. **Click the deps chip** in the status bar — deps strip reveals above the editor; click again — collapses.
9. **Close a clean tab** via the tab's `×` — tab closes silently; right neighbor activates.
10. **Close a dirty tab** via the tab's `×` — confirm dialog fires ("Close ALGO? Unsaved changes will be lost."). Cancel → tab stays dirty. Confirm → tab closes.
11. **Close the active tab** — right neighbor activates; if no right neighbor, left neighbor; if neither, empty state.
12. **Delete an algo** with its tab open (sidebar `⋯` → Delete) — one delete confirm only; on confirm the algo is deleted and the tab closes.
13. **Rename an algo** inline from the sidebar `⋯` → Rename — tab label updates live.
14. **Rename from the tab-strip `⋯`** — `window.prompt` opens; confirm → updates name.
15. **Navigate Editor → Home → Editor** — tab list and dirty state survive; no prompt fires.
16. **Create-with-AI** from the sidebar sparkles button — new algo opens as a tab AND an AI terminal spawns in the right panel.
17. **Click an AI-terminal tab** in the right panel — that algo's editor tab becomes active (opens one if not open).
18. **Monaco theme** — editor background matches `--bg-panel`, selection is translucent blue, keywords purple, strings green, comments italic grey. No `vs-dark` charcoal showing through.
19. **Regression**: Algos view loads; Trading view loads; Guide button still opens the guide window.

If any step fails, fix inline in one of the three edited files (do **not** re-touch the hook or the Task 1–6 files). Re-run `npm run build` and re-walk the affected area of the matrix.

- [ ] **Step 6: Commit**

Stage all three files and commit as one:

```bash
git add src/components/AlgoEditor.tsx src/views/EditorView.tsx src/App.tsx
git commit -m "feat(editor): multi-tab workspace with useEditorTabs hook

Rewire AlgoEditor to receive controlled code/deps props, EditorView to
orchestrate tabs + editor + status bar, and App to adopt useEditorTabs
in place of singleton editor state. Removes the view-nav unsaved-changes
dialog (buffers now persist in the hook), fixes the algo-code-updated
handler to avoid stomping unsaved edits, and wires the wolf-den-dark
Monaco theme."
```

---

### Task 8: Final smoke walk-through and polish

- [ ] **Step 1: Fresh smoke**

Close any dev server. Pull a fresh build from a clean state:

```bash
npm run build && npm run tauri dev
```

Re-walk items 1–19 from Task 7 Step 5 end-to-end, this time without making changes. This catches anything broken only in the production-build path (Tailwind purging, etc.).

- [ ] **Step 2: Visual check against the prototype**

Open the Variant B prototype side-by-side with the running app and spot-compare:

```bash
open /Users/hypawolf/code/wolf-den/prototypes/editor-view/variant-b-workspace.html
```

Look at: tab strip height/colors, active-tab top border, lang tag rendering, dirty/AI indicator placement, status bar density, Monaco syntax colors. Minor pixel nudges are fine; structural differences should have been caught earlier.

- [ ] **Step 3: Commit any polish fixes**

If you made adjustments:

```bash
git add -p
git commit -m "fix(editor): polish after full smoke walk-through"
```

If no changes — skip the commit.

- [ ] **Step 4: Announce completion**

The project is done. The branch is ready for PR review.

---

## Spec-to-task coverage check

| Spec section | Task(s) |
|---|---|
| `useEditorTabs` hook (state + API) | 1 |
| `src/lib/monacoTheme.ts` | 2 |
| `EditorStatusBar.tsx` | 3 |
| `EditorTabs.tsx` | 4 |
| `Sidebar.tsx` restyle | 5 |
| `AlgoManager.tsx` refresh (filter, dirty dot, overflow) | 6 |
| `AlgoEditor.tsx` slim-down | 7 |
| `EditorView.tsx` orchestrator | 7 |
| `App.tsx` state migration | 7 |
| Behavior change: no nav unsaved-guard | 7 (`handleNavigate` simplified) |
| Behavior change: no tab-switch prompt | 1 (`switchTab` never prompts) |
| External-update rule (clean-sync / dirty-keep + toast) | 1 (hook) + 7 (caller toast) |
| Close-active-tab neighbor rule | 1 (`pickNextActive`) |
| Save-failure toast + no-mark-saved-on-throw | 7 (`handleSaveAlgo` catch block) |
| Open-tab for stale id no-op | 1 (`openTab` initializes from algo arg, no DB fetch — stale caller protected) + 7 (`handleSelectAlgo` looks up in `algos` before calling) |
| `onAlgoDeleted` / `forceCloseTab` / non-open no-op | 1 |
| External update for non-open algo | 1 (buffer lookup short-circuits) |
| Verification plan (build + smoke) | 7 Step 5 + 8 |
| Monaco theme palette | 2 |
| Mouse-clickable save affordance in status bar | 3 |
| Confirm dispatch via `App`'s existing `ConfirmDialog` | 7 (`handleRequestCloseTab`) |

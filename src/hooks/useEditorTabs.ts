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

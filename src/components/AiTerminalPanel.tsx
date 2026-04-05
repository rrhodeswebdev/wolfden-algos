import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

type AiTerminalTab = {
  algoId: number;
  algoName: string;
};

type AiTerminalPanelProps = {
  tabs: AiTerminalTab[];
  selectedAlgoId?: number | null;
  onSelectAlgo?: (algoId: number) => void;
  onClose: (algoId: number) => void;
  onSpawnError?: (algoId: number, error: string) => void;
};

const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 700;
const MAX_WIDTH_RATIO = 0.6;

const TERM_THEME = {
  background: "#0a0a0f",
  foreground: "#e0e0e8",
  cursor: "#4d9fff",
  selectionBackground: "#4d9fff40",
  black: "#0a0a0f",
  red: "#ff4d6a",
  green: "#00d68f",
  yellow: "#ffc107",
  blue: "#4d9fff",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e0e0e8",
  brightBlack: "#8888a0",
  brightRed: "#ff4d6a",
  brightGreen: "#00d68f",
  brightYellow: "#ffc107",
  brightBlue: "#4d9fff",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
};

type TermSession = {
  term: Terminal;
  fit: FitAddon;
  spawned: boolean;
  unlisten: Promise<() => void>;
};

export const AiTerminalPanel = ({ tabs, selectedAlgoId, onSelectAlgo, onClose, onSpawnError }: AiTerminalPanelProps) => {
  const [activeAlgoId, setActiveAlgoId] = useState<number>(tabs[0]?.algoId);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Map of algoId -> terminal session (survives tab switches)
  const sessions = useRef<Map<number, TermSession>>(new Map());
  // The div where the active terminal is attached
  const containerRef = useRef<HTMLDivElement>(null);
  // Track which algoId is currently attached to the DOM
  const attachedId = useRef<number | null>(null);

  // Switch to selected algo's tab if it has an open terminal
  useEffect(() => {
    if (selectedAlgoId != null && tabs.some((t) => t.algoId === selectedAlgoId)) {
      setActiveAlgoId(selectedAlgoId);
    }
  }, [selectedAlgoId, tabs]);

  // If the active tab was closed, switch to the first available
  useEffect(() => {
    if (!tabs.some((t) => t.algoId === activeAlgoId) && tabs.length > 0) {
      setActiveAlgoId(tabs[0].algoId);
    }
  }, [tabs, activeAlgoId]);

  // When a new tab is added, switch to it
  const prevTabCount = useRef(tabs.length);
  useEffect(() => {
    if (tabs.length > prevTabCount.current) {
      setActiveAlgoId(tabs[tabs.length - 1].algoId);
    }
    prevTabCount.current = tabs.length;
  }, [tabs.length]);

  // Create a terminal session for a given algoId (does not attach to DOM)
  const getOrCreateSession = useCallback((algoId: number): TermSession => {
    const existing = sessions.current.get(algoId);
    if (existing) return existing;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: TERM_THEME,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    term.onData((data) => {
      invoke("write_ai_terminal", { algoId, input: data }).catch((e) =>
        console.error("Failed to write to AI terminal:", e)
      );
    });

    const unlisten = listen<string>(`ai-terminal-output-${algoId}`, (event) => {
      term.write(event.payload);
    });

    const session: TermSession = { term, fit, spawned: false, unlisten };
    sessions.current.set(algoId, session);
    return session;
  }, []);

  // Attach the active terminal to the container div
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeAlgoId == null) return;

    const session = getOrCreateSession(activeAlgoId);
    const { term, fit } = session;

    // Detach previous terminal's DOM element (but keep the Terminal instance alive)
    if (attachedId.current !== null && attachedId.current !== activeAlgoId) {
      const prevSession = sessions.current.get(attachedId.current);
      if (prevSession) {
        // xterm renders into container.querySelector('.xterm')
        // We just remove the element from the DOM without disposing
        const xtermEl = prevSession.term.element;
        if (xtermEl && xtermEl.parentElement === container) {
          container.removeChild(xtermEl);
        }
      }
    }

    // If this terminal hasn't been opened yet, open it
    if (!term.element) {
      term.open(container);
    } else if (term.element.parentElement !== container) {
      // Re-attach the existing xterm element
      container.appendChild(term.element);
    }

    attachedId.current = activeAlgoId;

    // Fit and spawn after attachment
    requestAnimationFrame(() => {
      fit.fit();

      if (!session.spawned) {
        invoke("spawn_ai_terminal", {
          algoId: activeAlgoId,
          rows: term.rows,
          cols: term.cols,
        }).then(() => {
          session.spawned = true;
        }).catch((e) => {
          const msg = String(e);
          if (msg.includes("already active")) {
            session.spawned = true;
            invoke("resize_ai_terminal", {
              algoId: activeAlgoId,
              rows: term.rows,
              cols: term.cols,
            }).catch(() => {});
          } else {
            onSpawnError?.(activeAlgoId, msg);
          }
        });
      } else {
        // Force a resize to make Claude redraw
        invoke("resize_ai_terminal", {
          algoId: activeAlgoId,
          rows: term.rows,
          cols: term.cols,
        }).catch(() => {});
      }

      term.focus();
    });
  }, [activeAlgoId, getOrCreateSession, onSpawnError]);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      if (attachedId.current != null) {
        const session = sessions.current.get(attachedId.current);
        if (session) {
          session.fit.fit();
          if (session.spawned) {
            invoke("resize_ai_terminal", {
              algoId: attachedId.current,
              rows: session.term.rows,
              cols: session.term.cols,
            }).catch(() => {});
          }
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Cleanup removed tabs
  useEffect(() => {
    const activeIds = new Set(tabs.map((t) => t.algoId));
    for (const [algoId, session] of sessions.current) {
      if (!activeIds.has(algoId)) {
        session.unlisten.then((f) => f());
        session.term.dispose();
        sessions.current.delete(algoId);
      }
    }
  }, [tabs]);

  // Cleanup all on unmount
  useEffect(() => {
    const sessionsRef = sessions;
    return () => {
      for (const [, session] of sessionsRef.current) {
        session.unlisten.then((f) => f());
        session.term.dispose();
      }
      sessionsRef.current.clear();
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - ev.clientX;
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, dragStartWidth.current + delta));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

  const handleClose = useCallback((algoId: number) => {
    invoke("close_ai_terminal", { algoId }).catch((e) =>
      console.error("Failed to close AI terminal:", e)
    );
    onClose(algoId);
  }, [onClose]);

  return (
    <div
      className="flex flex-col border-l border-[var(--border)] bg-[var(--bg-primary)] h-full"
      style={{ width: panelWidth, flexShrink: 0 }}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border)] select-none overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.algoId}
            className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-[var(--border)] min-w-0 ${
              tab.algoId === activeAlgoId
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]"
            }`}
            onClick={() => { setActiveAlgoId(tab.algoId); onSelectAlgo?.(tab.algoId); }}
          >
            <span className="text-[11px] truncate max-w-[120px]">{tab.algoName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose(tab.algoId);
              }}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs leading-none ml-1"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex-1" />
        <span className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider px-3">
          AI Terminal
        </span>
      </div>

      {/* Drag handle + Terminal container */}
      <div className="flex flex-1 min-h-0">
        <div
          className="w-1 cursor-ew-resize hover:bg-[var(--accent-blue)]/30 transition-colors flex-shrink-0"
          onMouseDown={handleMouseDown}
        />
        <div ref={containerRef} className="flex-1 min-w-0 px-1 py-1" />
      </div>
    </div>
  );
};

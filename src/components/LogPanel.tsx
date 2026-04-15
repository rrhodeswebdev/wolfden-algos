import { useState, useEffect, useRef } from "react";
import type { LogEntry, LogEventType } from "../hooks/useAlgoLogs";
import type { AlgoHealth } from "../hooks/useAlgoHealth";

const EVENT_TYPE_COLORS: Record<LogEventType, string> = {
  BAR: "#60a5fa",
  ORDER: "#fbbf24",
  FILL: "#4ade80",
  SIGNAL: "#c084fc",
  ERROR: "#f87171",
  POSITION: "#60a5fa",
  TRADE: "#4ade80",
  HEARTBEAT: "#334155",
  LOG: "#888888",
};

const DEFAULT_FILTERS: Record<LogEventType, boolean> = {
  BAR: true,
  ORDER: true,
  FILL: true,
  SIGNAL: true,
  ERROR: true,
  POSITION: true,
  TRADE: true,
  HEARTBEAT: false,
  LOG: true,
};

const formatTimestamp = (ts: number) => {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
};

const HealthDot = ({ label, ok }: { label: string; ok: boolean }) => (
  <div className="flex items-center gap-1">
    <div
      className="w-1.5 h-1.5 rounded-full"
      style={{ background: ok ? "#4ade80" : "#f87171" }}
    />
    <span className="text-[10px] text-[var(--text-secondary)]">{label}</span>
  </div>
);

type LogPanelProps = {
  logs: LogEntry[];
  health: AlgoHealth | undefined;
  onClear: () => void;
};

export const LogPanel = ({ logs, health, onClear }: LogPanelProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [filters, setFilters] = useState<Record<LogEventType, boolean>>(DEFAULT_FILTERS);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((l) => filters[l.eventType] !== false);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (autoScroll && !atBottom) setAutoScroll(false);
    if (!autoScroll && atBottom) setAutoScroll(true);
  };

  const toggleFilter = (type: LogEventType) => {
    setFilters((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="border-t border-[var(--border)] flex flex-col">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-secondary)]/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-secondary)]">
            {collapsed ? "\u25B6" : "\u25BC"}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Logs
          </span>
          <span className="text-[10px] text-[var(--text-secondary)]">
            {filteredLogs.length}
          </span>
        </div>
        {health && (
          <div className="flex items-center gap-3">
            <HealthDot label="WS" ok={health.wsConnected} />
            <HealthDot label="ZMQ" ok={health.zmqActive} />
            <HealthDot label="Process" ok={health.processAlive} />
            {health.barsPerSec > 0 && (
              <span className="text-[10px] text-[var(--text-secondary)]">
                {health.barsPerSec.toFixed(0)} bars/s
              </span>
            )}
            {health.lastHeartbeatSecsAgo >= 0 && (
              <span className="text-[10px] text-[var(--text-secondary)]">
                HB {health.lastHeartbeatSecsAgo}s ago
              </span>
            )}
          </div>
        )}
      </button>

      {!collapsed && (
        <>
          {/* Log Stream */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed max-h-64 min-h-32 bg-[var(--bg-primary)]"
          >
            {filteredLogs.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-[var(--text-secondary)]">
                No log events yet
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <div key={entry.id} className="flex gap-2 px-3 py-0.5 hover:bg-[var(--bg-secondary)]/50">
                  <span className="text-[var(--text-secondary)] shrink-0">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span
                    className="shrink-0 font-medium uppercase text-[10px] min-w-[60px]"
                    style={{ color: EVENT_TYPE_COLORS[entry.eventType] }}
                  >
                    {entry.eventType}
                  </span>
                  <span className="text-[var(--text-secondary)] truncate">
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
            {(Object.keys(EVENT_TYPE_COLORS) as LogEventType[]).map((type) => (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                className="text-[10px] px-1.5 py-0.5 rounded transition-opacity"
                style={{
                  color: EVENT_TYPE_COLORS[type],
                  background: `${EVENT_TYPE_COLORS[type]}15`,
                  opacity: filters[type] !== false ? 1 : 0.3,
                }}
              >
                {type}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={onClear}
              className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Clear
            </button>
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`text-[10px] ${autoScroll ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
            >
              ↓ Auto
            </button>
          </div>
        </>
      )}
    </div>
  );
};

import { useEffect, useState } from "react";
import type { Algo, AlgoRun } from "../types";
import type { DataSource } from "../hooks/useTradingSimulation";

type Mode = "live" | "shadow";

type RunAlgoSlideOverProps = {
  open: boolean;
  algos: Algo[];
  dataSources: DataSource[];
  activeRuns: AlgoRun[];
  prefill: { algoId?: number; chartId?: string } | null;
  onClose: () => void;
  onStart: (algoId: number, mode: Mode, account: string, dataSourceId: string) => void;
};

export const RunAlgoSlideOver = ({
  open,
  algos,
  dataSources,
  activeRuns,
  prefill,
  onClose,
  onStart,
}: RunAlgoSlideOverProps) => {
  const [algoId, setAlgoId] = useState<number | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("shadow");
  const [accountOverride, setAccountOverride] = useState<string>("");

  // Reset on open, respecting prefill.
  useEffect(() => {
    if (!open) return;
    setAlgoId(prefill?.algoId ?? null);
    setChartId(prefill?.chartId ?? null);
    setMode("shadow");
    setAccountOverride("");
  }, [open, prefill]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const chart = dataSources.find((d) => d.id === chartId) ?? null;
  const algo = algos.find((a) => a.id === algoId) ?? null;
  const effectiveAccount = accountOverride.trim() || chart?.account || "";
  const duplicate =
    algo &&
    chart &&
    activeRuns.some((r) => r.algo_id === algo.id && r.data_source_id === chart.id);

  const canSubmit = !!algo && !!chart && !!effectiveAccount && !duplicate;

  const handleSubmit = () => {
    if (!canSubmit || !algo || !chart) return;
    onStart(algo.id, mode, effectiveAccount, chart.id);
    onClose();
  };

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/30 z-20"
        aria-hidden
      />

      {/* Panel */}
      <aside
        className="absolute top-0 right-0 bottom-0 w-[380px] bg-[var(--bg-panel)] border-l border-[var(--border)] z-30 flex flex-col shadow-2xl"
        role="dialog"
        aria-label="Run a new algo"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold">Run a new algo</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
          <Field label="Algo">
            <select
              value={algoId ?? ""}
              onChange={(e) => setAlgoId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="">Select an algo…</option>
              {algos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chart">
            <select
              value={chartId ?? ""}
              onChange={(e) => setChartId(e.target.value || null)}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            >
              <option value="">Select a chart…</option>
              {dataSources.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.instrument} {d.timeframe} · {d.account}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mode">
            <div className="grid grid-cols-2 gap-2">
              <ModeChip
                tone="yellow"
                selected={mode === "shadow"}
                label="◐ Shadow"
                onClick={() => setMode("shadow")}
              />
              <ModeChip
                tone="green"
                selected={mode === "live"}
                label="● Live"
                onClick={() => setMode("live")}
              />
            </div>
          </Field>

          <Field label="Account override (optional)">
            <input
              type="text"
              value={accountOverride}
              onChange={(e) => setAccountOverride(e.target.value)}
              placeholder={chart ? `use chart's account · ${chart.account}` : "pick a chart first"}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
            />
          </Field>

          {duplicate && (
            <div className="text-[11px] text-[var(--accent-yellow)]">
              This algo is already running on the selected chart.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3.5 py-1.5 text-xs rounded-md font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start
          </button>
        </div>
      </aside>
    </>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">
      {label}
    </span>
    {children}
  </div>
);

const ModeChip = ({
  tone,
  selected,
  label,
  onClick,
}: {
  tone: "yellow" | "green";
  selected: boolean;
  label: string;
  onClick: () => void;
}) => {
  const base = "px-3 py-1.5 text-xs rounded-md font-medium border transition-colors";
  const toneClass =
    tone === "green"
      ? selected
        ? "bg-[var(--accent-green)]/15 border-[var(--accent-green)] text-[var(--accent-green)]"
        : "bg-transparent border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-green)]"
      : selected
        ? "bg-[var(--accent-yellow)]/15 border-[var(--accent-yellow)] text-[var(--accent-yellow)]"
        : "bg-transparent border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-yellow)]";
  return (
    <button type="button" onClick={onClick} className={`${base} ${toneClass}`}>
      {label}
    </button>
  );
};

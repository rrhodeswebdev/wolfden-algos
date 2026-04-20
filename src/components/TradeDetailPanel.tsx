import { useEffect } from "react";
import type { Roundtrip } from "../lib/tradingView";
import { formatDuration, formatPnl, pnlColorClass } from "../lib/tradingView";
import { formatPrice } from "../hooks/useTradingSimulation";

type TradeDetailPanelProps = {
  // TradesTab only mounts this panel when a roundtrip is selected, so the prop is
  // always non-null. Changing the prop to `Roundtrip | null` would require an
  // in-component empty state that would be unreachable in practice.
  roundtrip: Roundtrip;
  onClose: () => void;
};

const formatFullTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const CHART_W = 320;
const CHART_H = 80;

const samplePoints = (
  samples: { t: number; pnl: number }[],
  width: number,
  height: number,
): { zeroY: number; path: string } => {
  if (samples.length < 2) return { zeroY: height / 2, path: "" };
  const tMin = samples[0].t;
  const tMax = samples[samples.length - 1].t;
  const tRange = Math.max(tMax - tMin, 1);
  const pnls = samples.map((s) => s.pnl);
  const vMin = Math.min(0, ...pnls);
  const vMax = Math.max(0, ...pnls);
  const vRange = vMax - vMin || 1;
  const pad = vRange * 0.1;
  const toX = (t: number) => ((t - tMin) / tRange) * width;
  const toY = (v: number) => height - ((v - vMin + pad) / (vRange + pad * 2)) * height;
  const path = samples
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(s.t).toFixed(1)},${toY(s.pnl).toFixed(1)}`)
    .join(" ");
  return { zeroY: toY(0), path };
};

export const TradeDetailPanel = ({ roundtrip, onClose }: TradeDetailPanelProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const r = roundtrip;
  const sideColor = r.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";
  const { zeroY, path } = samplePoints(r.maeMfeSamples, CHART_W, CHART_H);
  const strokeColor = r.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)";

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden h-full">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-sm font-semibold truncate">{r.symbol}</h2>
            <span className={`text-xs font-medium ${sideColor}`}>{r.side}</span>
            {r.isShadow && (
              <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] font-semibold">
                Shadow
              </span>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] font-mono">
            {formatFullTime(r.openTimestamp)} → {formatFullTime(r.closeTimestamp)} · {r.algo || "—"} ·{" "}
            {r.account}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg leading-none"
          title="Close (Esc)"
          aria-label="Close trade detail"
        >
          ×
        </button>
      </div>

      <div className="overflow-auto p-3 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[var(--bg-elevated)] rounded-md p-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">
              P&L
            </div>
            <div className={`text-base font-semibold font-mono tabular-nums ${pnlColorClass(r.pnl)}`}>
              {formatPnl(r.pnl)}
            </div>
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-md p-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">
              R
            </div>
            <div className="text-base font-semibold font-mono tabular-nums">
              {r.rMultiple !== null ? r.rMultiple.toFixed(2) : "—"}
            </div>
          </div>
          <div className="bg-[var(--bg-elevated)] rounded-md p-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-0.5">
              Dur
            </div>
            <div className="text-base font-semibold font-mono tabular-nums">
              {formatDuration(r.openTimestamp, r.closeTimestamp)}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Execution
          </div>
          <div className="text-sm space-y-1 font-mono">
            <div>
              <span className={r.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}>
                {r.side === "Long" ? "Buy" : "Sell"} {r.qty} @ {formatPrice(r.symbol, r.entryPrice)}
              </span>{" "}
              <span className="text-[var(--text-muted)]">· {formatFullTime(r.openTimestamp)}</span>
            </div>
            <div>
              <span className={r.side === "Long" ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"}>
                {r.side === "Long" ? "Sell" : "Buy"} {r.qty} @ {formatPrice(r.symbol, r.exitPrice)}
              </span>{" "}
              <span className="text-[var(--text-muted)]">· {formatFullTime(r.closeTimestamp)}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Excursion
          </div>
          <div className="text-sm space-y-1 font-mono">
            <div>
              <span className="text-[var(--text-secondary)]">MAE:</span>{" "}
              <span className="text-[var(--accent-red)]">
                {r.mae >= 0 ? "$0.00" : formatPnl(r.mae)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">MFE:</span>{" "}
              <span className="text-[var(--accent-green)]">
                {r.mfe <= 0 ? "$0.00" : formatPnl(r.mfe)}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            Unrealized P&L over hold
          </div>
          {path ? (
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              preserveAspectRatio="none"
              width="100%"
              height={CHART_H}
              className="bg-[var(--bg-elevated)] rounded"
            >
              <line
                x1={0}
                y1={zeroY}
                x2={CHART_W}
                y2={zeroY}
                stroke="rgba(136,136,160,0.3)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <path d={path} fill="none" stroke={strokeColor} strokeWidth={1.5} />
            </svg>
          ) : (
            <div className="text-[var(--text-muted)] text-xs">Not enough samples</div>
          )}
        </div>
      </div>
    </div>
  );
};

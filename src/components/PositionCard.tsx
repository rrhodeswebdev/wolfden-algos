import type { Position } from "../hooks/useTradingSimulation";
import { formatPrice } from "../hooks/useTradingSimulation";
import { formatDuration, formatPnl, pnlColorClass } from "../lib/tradingView";

type PositionCardProps = {
  position: Position;
  openSinceTs: number | null;
};

export const PositionCard = ({ position, openSinceTs }: PositionCardProps) => {
  const isShadow = position.account === "shadow";
  const sideColor = position.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";
  const now = Date.now();
  const held = openSinceTs ? formatDuration(openSinceTs, now) : "--";

  return (
    <div className="flex-1 min-w-[240px] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold">{position.symbol}</div>
        <span
          className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold ${
            isShadow
              ? "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
              : "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
          }`}
        >
          {isShadow ? "Shadow" : "Live"}
        </span>
      </div>
      <div className="text-[10px] text-[var(--text-secondary)] mb-2 truncate">
        {position.algo || "—"} · {position.account}
      </div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-medium ${sideColor}`}>
          {position.side} {position.qty}
        </span>
        <span className={`text-sm font-semibold font-mono tabular-nums ${pnlColorClass(position.pnl)}`}>
          {formatPnl(position.pnl)}
        </span>
      </div>
      <div className="text-[10px] text-[var(--text-secondary)] font-mono">
        entry {formatPrice(position.symbol, position.avgPrice)} · held {held}
      </div>
    </div>
  );
};

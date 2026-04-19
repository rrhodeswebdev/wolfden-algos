import type { DistributionBucket } from "../lib/tradingView";

type TradeDistributionProps = {
  buckets: DistributionBucket[];
  totalTrades: number;
};

export const TradeDistribution = ({ buckets, totalTrades }: TradeDistributionProps) => {
  if (buckets.length === 0 || totalTrades === 0) {
    return (
      <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
        <div className="px-4 py-2.5 border-b border-[var(--border)]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Trade P&L Distribution
          </h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
          No completed trades yet
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Trade P&L Distribution
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">{totalTrades} trades</span>
      </div>
      <div className="flex-1 px-4 py-3 flex flex-col">
        <div className="flex-1 flex items-end gap-[2px]">
          {buckets.map((b, i) => {
            const height = `${(b.count / maxCount) * 100}%`;
            const isNegative = b.hi <= 0;
            const color = isNegative
              ? "bg-[var(--accent-red)]"
              : b.lo >= 0
                ? "bg-[var(--accent-green)]"
                : "bg-[var(--text-muted)]";
            return (
              <div
                key={i}
                className={`flex-1 rounded-t ${color}`}
                style={{ height, minHeight: b.count > 0 ? "2px" : "0" }}
                title={`${b.count} trades · ${b.lo.toFixed(2)} to ${b.hi.toFixed(2)}`}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-2 font-mono">
          <span>{buckets[0].lo.toFixed(0)}</span>
          <span>0</span>
          <span>+{buckets[buckets.length - 1].hi.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
};

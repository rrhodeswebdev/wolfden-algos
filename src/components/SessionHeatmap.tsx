import type { HeatCell } from "../lib/tradingView";

type SessionHeatmapProps = {
  grid: HeatCell[][];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const cellColor = (cell: HeatCell, absMax: number): string => {
  if (cell.trades === 0) return "var(--bg-elevated)";
  const intensity = Math.min(1, Math.abs(cell.pnl) / (absMax || 1));
  const alpha = 0.15 + intensity * 0.75;
  return cell.pnl >= 0
    ? `rgba(0, 214, 143, ${alpha.toFixed(2)})`
    : `rgba(255, 77, 106, ${alpha.toFixed(2)})`;
};

export const SessionHeatmap = ({ grid }: SessionHeatmapProps) => {
  const totalTrades = grid.reduce((s, row) => s + row.reduce((a, c) => a + c.trades, 0), 0);
  const absMax = Math.max(
    1,
    ...grid.flatMap((row) => row.map((c) => Math.abs(c.pnl))),
  );

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Hour × Day Heatmap <span className="font-normal normal-case tracking-normal text-[var(--text-muted)]">· P&L</span>
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">{totalTrades} trades</span>
      </div>
      <div className="flex-1 px-4 py-3 overflow-auto">
        {totalTrades === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-[var(--text-secondary)]">
            No completed trades yet
          </div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            <div className="flex gap-[2px] pl-[40px] text-[9px] text-[var(--text-muted)] font-mono">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center">
                  {h % 3 === 0 ? h : ""}
                </div>
              ))}
            </div>
            {grid.map((row, d) => (
              <div key={d} className="flex gap-[2px] items-center">
                <div className="w-[36px] text-[10px] text-[var(--text-secondary)] font-mono">
                  {DAY_LABELS[d]}
                </div>
                {row.map((cell, h) => (
                  <div
                    key={h}
                    className="flex-1 h-[16px] rounded-sm"
                    style={{ backgroundColor: cellColor(cell, absMax) }}
                    title={
                      cell.trades === 0
                        ? "No trades"
                        : `${cell.trades} trades · ${cell.winRate}% win · ${cell.pnl >= 0 ? "+" : "-"}$${Math.abs(cell.pnl).toFixed(2)}`
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

import type { BreakdownRow } from "../lib/tradingView";
import { formatPnl, pnlColorClass, sparklinePoints } from "../lib/tradingView";

type BreakdownTableProps = {
  title: string;
  rows: BreakdownRow[];
  labelHeader: string;
  emptyMessage?: string;
  onRowDeepLink?: (row: BreakdownRow) => void;
  deepLinkLabel?: string;
};

const SPARK_W = 80;
const SPARK_H = 20;

export const BreakdownTable = ({
  title,
  rows,
  labelHeader,
  emptyMessage,
  onRowDeepLink,
  deepLinkLabel,
}: BreakdownTableProps) => {
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {title}
        </h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          {emptyMessage ?? "No data yet"}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
              <th className="text-left px-4 py-2 font-medium">{labelHeader}</th>
              <th className="text-right px-4 py-2 font-medium">Trades</th>
              <th className="text-right px-4 py-2 font-medium">Win %</th>
              <th className="text-right px-4 py-2 font-medium">P&L</th>
              <th className="text-right px-4 py-2 font-medium">Sharpe</th>
              <th className="text-right px-4 py-2 font-medium">Avg Win</th>
              <th className="text-right px-4 py-2 font-medium">Avg Loss</th>
              <th className="text-right px-4 py-2 font-medium">Profit Factor</th>
              <th className="text-right px-4 py-2 font-medium">Trend</th>
              {onRowDeepLink && <th className="text-right px-4 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const strokeColor = row.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)";
              const points = sparklinePoints(row.sparkline, SPARK_W, SPARK_H);
              return (
                <tr key={row.key} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {row.label === "shadow" ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
                        shadow
                      </span>
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.trades}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.winRate}%</td>
                  <td className={`px-4 py-2 text-right font-mono tabular-nums font-medium ${pnlColorClass(row.pnl)}`}>
                    {formatPnl(row.pnl)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.sharpe}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--accent-green)]">
                    {formatPnl(row.avgWin)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--accent-red)]">
                    {formatPnl(row.avgLoss)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{row.profitFactor}</td>
                  <td className="px-4 py-2 text-right">
                    {points ? (
                      <svg
                        className="inline-block"
                        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                        preserveAspectRatio="none"
                        width={SPARK_W}
                        height={SPARK_H}
                        aria-hidden
                      >
                        <polyline fill="none" stroke={strokeColor} strokeWidth="1.2" points={points} />
                      </svg>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  {onRowDeepLink && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onRowDeepLink(row)}
                        className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] transition-colors"
                        title={deepLinkLabel}
                      >
                        →
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

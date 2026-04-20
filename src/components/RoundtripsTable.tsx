import type { Roundtrip } from "../lib/tradingView";
import { formatDuration, formatPnl, pnlColorClass } from "../lib/tradingView";

type RoundtripsTableProps = {
  roundtrips: Roundtrip[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const formatHm = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
};

export const RoundtripsTable = ({
  roundtrips,
  selectedId,
  onSelect,
}: RoundtripsTableProps) => {
  const sorted = [...roundtrips].sort((a, b) => b.closeTimestamp - a.closeTimestamp);

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden h-full">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Roundtrips
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">{sorted.length}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] px-4 py-6">
          No completed trades yet
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-panel)] z-10">
              <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
                <th className="text-left px-3 py-2 font-medium">Opened</th>
                <th className="text-left px-3 py-2 font-medium">Closed</th>
                <th className="text-left px-3 py-2 font-medium">Symbol</th>
                <th className="text-left px-3 py-2 font-medium">Side</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-right px-3 py-2 font-medium">Dur</th>
                <th className="text-right px-3 py-2 font-medium">R</th>
                <th className="text-right px-3 py-2 font-medium">P&L</th>
                <th className="text-left px-3 py-2 font-medium">Algo</th>
                <th className="text-left px-3 py-2 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const isSelected = selectedId === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    className={`border-b border-[var(--border)] last:border-0 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[var(--accent-blue)]/10 border-l-2 border-l-[var(--accent-blue)]"
                        : "hover:bg-[var(--bg-secondary)]"
                    }`}
                  >
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-[11px]">
                      {formatHm(r.openTimestamp)}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-[11px]">
                      {formatHm(r.closeTimestamp)}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.symbol}</td>
                    <td
                      className={`px-3 py-2 ${
                        r.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"
                      }`}
                    >
                      {r.side}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.qty}</td>
                    <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-mono tabular-nums">
                      {formatDuration(r.openTimestamp, r.closeTimestamp)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.rMultiple !== null ? r.rMultiple.toFixed(1) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums font-medium ${pnlColorClass(r.pnl)}`}>
                      {formatPnl(r.pnl)}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-[120px]">
                      {r.algo || "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">
                      {r.isShadow ? (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
                          Shadow
                        </span>
                      ) : (
                        r.account
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

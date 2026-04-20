import type { LiveShadowPair } from "../lib/tradingView";
import { formatPnl, pnlColorClass } from "../lib/tradingView";

type LiveShadowDeltaProps = {
  pairs: LiveShadowPair[];
};

export const LiveShadowDelta = ({ pairs }: LiveShadowDeltaProps) => {
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Live vs. Shadow
        </h2>
      </div>
      {pairs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
          No paired trades yet · run the same algo live and shadow to compare
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
              <th className="text-left px-4 py-2 font-medium">Algo</th>
              <th className="text-right px-4 py-2 font-medium">Live P&L</th>
              <th className="text-right px-4 py-2 font-medium">Shadow P&L</th>
              <th className="text-right px-4 py-2 font-medium">Δ</th>
              <th className="text-right px-4 py-2 font-medium">Live Win %</th>
              <th className="text-right px-4 py-2 font-medium">Shadow Win %</th>
              <th className="text-right px-4 py-2 font-medium">Slippage est.</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.algoId} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2 font-medium">{p.algoName}</td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums ${pnlColorClass(p.live?.pnl ?? 0)}`}>
                  {p.live ? formatPnl(p.live.pnl) : "—"}
                </td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums ${pnlColorClass(p.shadow?.pnl ?? 0)}`}>
                  {p.shadow ? formatPnl(p.shadow.pnl) : "—"}
                </td>
                <td className={`px-4 py-2 text-right font-mono tabular-nums font-semibold ${pnlColorClass(p.delta)}`}>
                  {formatPnl(p.delta)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {p.live ? `${p.live.winRate}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {p.shadow ? `${p.shadow.winRate}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                  {p.live && p.shadow ? `${formatPnl(p.slippagePerTrade)}/trade` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

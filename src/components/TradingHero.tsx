import type { HeroKpis, EquityPoint, DrawdownPoint } from "../lib/tradingView";
import { pnlColorClass } from "../lib/tradingView";
import { EquityChart } from "./EquityChart";

type TradingHeroProps = {
  kpis: HeroKpis;
  equityLive: EquityPoint[];
  equityShadow: EquityPoint[];
  drawdown: DrawdownPoint[];
};

const Kpi = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="flex-1 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
      {label}
    </div>
    <div className={`text-lg font-semibold font-mono tabular-nums truncate ${tone ?? ""}`}>
      {value}
    </div>
  </div>
);

const formatDollars = (v: number): string => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

export const TradingHero = ({ kpis, equityLive, equityShadow, drawdown }: TradingHeroProps) => {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
        <Kpi label="Realized" value={formatDollars(kpis.realizedPnl)} tone={pnlColorClass(kpis.realizedPnl)} />
        <Kpi label="Unrealized" value={formatDollars(kpis.unrealizedPnl)} tone={pnlColorClass(kpis.unrealizedPnl)} />
        <Kpi label="Total" value={formatDollars(kpis.totalPnl)} tone={pnlColorClass(kpis.totalPnl)} />
        <Kpi label="Win Rate" value={kpis.trades > 0 ? `${kpis.winRate}%` : "--"} />
        <Kpi label="Trades" value={`${kpis.trades}`} />
        <Kpi label="Sharpe" value={kpis.sharpe} />
        <Kpi
          label="Max DD"
          value={kpis.maxDrawdown > 0 ? `-$${kpis.maxDrawdown.toFixed(2)}` : "--"}
          tone={kpis.maxDrawdown > 0 ? "text-[var(--accent-red)]" : ""}
        />
      </div>

      <div className="bg-[var(--bg-panel)] rounded-lg p-4 flex flex-col h-[220px]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Equity
            <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
              · with drawdown overlay
            </span>
          </h2>
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-[2px] bg-[var(--accent-green)]" />
              Live
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-3 h-[2px]"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, var(--accent-yellow) 50%, transparent 50%)",
                  backgroundSize: "4px 2px",
                }}
              />
              Shadow
            </span>
          </div>
        </div>
        <EquityChart live={equityLive} shadow={equityShadow} drawdown={drawdown} />
      </div>
    </div>
  );
};

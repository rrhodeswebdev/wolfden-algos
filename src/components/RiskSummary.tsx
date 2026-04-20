import type { Position } from "../hooks/useTradingSimulation";

type AccountSummary = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

type RiskSummaryProps = {
  positions: Position[];
  accounts: Record<string, AccountSummary>;
};

const Cell = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="flex-1 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
      {label}
    </div>
    <div className={`text-base font-semibold font-mono tabular-nums ${tone ?? ""}`}>{value}</div>
  </div>
);

const formatDollars = (v: number): string =>
  `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const RiskSummary = ({ positions, accounts }: RiskSummaryProps) => {
  const liveAccounts = Object.entries(accounts).filter(([name]) => name !== "shadow");
  const totalBuyingPower = liveAccounts.reduce((s, [, a]) => s + a.buying_power, 0);

  // Risk / exposure is reported against live accounts only: shadow has no buying power
  // and its drawdown doesn't risk real capital, so including it would inflate the heat %
  // against a denominator that excludes it.
  const livePositions = positions.filter((p) => p.account !== "shadow");
  const openPositions = livePositions.length;

  // Open risk: sum of currently-underwater unrealized P&L across live positions (how much
  // is already drawn down at current prices). A rough gauge of "how much am I holding onto").
  const openRisk = livePositions.reduce((s, p) => s + (p.pnl < 0 ? Math.abs(p.pnl) : 0), 0);

  // Open exposure: total notional value at work (qty × avgPrice). Different quantity than
  // open risk — shows how much capital the strategies are actively committing.
  const openExposure = livePositions.reduce((s, p) => s + p.qty * p.avgPrice, 0);

  const portfolioHeat =
    totalBuyingPower > 0 ? ((openRisk / totalBuyingPower) * 100).toFixed(2) : "—";

  return (
    <div className="grid grid-cols-5 gap-4 p-3 bg-[var(--bg-panel)] rounded-lg">
      <Cell
        label="Open Risk"
        value={openRisk > 0 ? `-${formatDollars(openRisk)}` : "$0"}
        tone={openRisk > 0 ? "text-[var(--accent-yellow)]" : ""}
      />
      <Cell
        label="Portfolio Heat"
        value={portfolioHeat === "—" ? "—" : `${portfolioHeat}%`}
      />
      <Cell
        label="Buying Power"
        value={totalBuyingPower > 0 ? formatDollars(totalBuyingPower) : "—"}
      />
      <Cell
        label="Open Exposure"
        value={openExposure > 0 ? formatDollars(openExposure) : "$0"}
      />
      <Cell label="Open Positions" value={`${openPositions}`} />
    </div>
  );
};

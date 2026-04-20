import type { Position, SimOrder } from "../hooks/useTradingSimulation";
import { RiskSummary } from "./RiskSummary";
import { PositionCard } from "./PositionCard";
import { OrderTape } from "./OrderTape";

type AccountSummary = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
};

type LiveTabProps = {
  positions: Position[];
  orders: SimOrder[];
  accounts: Record<string, AccountSummary>;
  // Map posKey ("dataSourceId:symbol:account") → open-since timestamp; maintained by the
  // parent (TradingView's `useOpenSinceMap`) so position cards can render "held Xm"
  // consistently. If a card has no entry in the map, fallback to "--" via null.
  openSinceByPosKey: Map<string, number>;
};

export const LiveTab = ({ positions, orders, accounts, openSinceByPosKey }: LiveTabProps) => {
  const hasAnything = positions.length > 0 || orders.length > 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <RiskSummary positions={positions} accounts={accounts} />

      <div className="bg-[var(--bg-panel)] rounded-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Open Positions
          </h2>
          <span className="text-[10px] text-[var(--text-muted)]">{positions.length}</span>
        </div>
        {positions.length === 0 ? (
          <div className="text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg p-6 text-center">
            {hasAnything ? "No matching open positions" : "No open positions"}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {positions.map((p) => {
              const posKey = `${p.dataSourceId}:${p.symbol}:${p.account}`;
              return (
                <PositionCard
                  key={posKey}
                  position={p}
                  openSinceTs={openSinceByPosKey.get(posKey) ?? null}
                />
              );
            })}
          </div>
        )}
      </div>

      <OrderTape orders={orders} />
    </div>
  );
};

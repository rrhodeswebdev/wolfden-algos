type TradingViewProps = {
  connectionStatus: "waiting" | "connected" | "error";
};

export const TradingView = ({ connectionStatus }: TradingViewProps) => {
  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
      {/* Top Row: P&L + Stats */}
      <div className="flex gap-3">
        <div className="flex-1 grid grid-cols-3 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
          <PnlCard label="Realized P&L" value="$0.00" />
          <PnlCard label="Unrealized P&L" value="$0.00" />
          <PnlCard label="Total P&L" value="$0.00" />
        </div>
        <div className="flex-1 grid grid-cols-4 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
          <StatCell label="Win Rate" value="--" />
          <StatCell label="Trades" value="0" />
          <StatCell label="Drawdown" value="--" />
          <StatCell label="Sharpe" value="--" />
        </div>
      </div>

      {/* Middle: Chart Area */}
      <div className="flex-1 bg-[var(--bg-panel)] rounded-lg p-4 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            P&L Chart
          </h2>
          <div className="flex gap-1.5">
            <TimeButton label="1H" />
            <TimeButton label="4H" />
            <TimeButton label="1D" active />
            <TimeButton label="1W" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
          {connectionStatus === "connected"
            ? "P&L chart will render here (uPlot)"
            : "Connect NinjaTrader to see live P&L"}
        </div>
      </div>

      {/* Bottom Row: Positions + Orders */}
      <div className="flex gap-3 h-56">
        <div className="flex-1 bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--border)]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Open Positions
            </h2>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5 font-medium">Symbol</th>
                  <th className="text-left px-4 py-2.5 font-medium">Side</th>
                  <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                  <th className="text-right px-4 py-2.5 font-medium">Avg Price</th>
                  <th className="text-right px-4 py-2.5 font-medium">P&L</th>
                  <th className="text-left px-4 py-2.5 font-medium">Algo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={6} className="px-4 py-5 text-center text-[var(--text-secondary)]">
                    {connectionStatus === "connected"
                      ? "No open positions"
                      : "Waiting for NinjaTrader..."}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex-1 bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--border)]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Recent Orders
            </h2>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5 font-medium">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium">Symbol</th>
                  <th className="text-left px-4 py-2.5 font-medium">Side</th>
                  <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                  <th className="text-right px-4 py-2.5 font-medium">Price</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={6} className="px-4 py-5 text-center text-[var(--text-secondary)]">
                    No orders yet
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const PnlCard = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
      {label}
    </div>
    <div className="text-lg font-semibold">{value}</div>
  </div>
);

const StatCell = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
      {label}
    </div>
    <div className="text-base font-semibold">{value}</div>
  </div>
);

const TimeButton = ({ label, active }: { label: string; active?: boolean }) => (
  <button
    className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
      active
        ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
    }`}
  >
    {label}
  </button>
);

import type { SimOrder } from "../hooks/useTradingSimulation";

type OrderTapeProps = {
  orders: SimOrder[];
};

const statusTone = (status: SimOrder["status"]): string => {
  switch (status) {
    case "Filled":
      return "bg-[var(--accent-green)]/15 text-[var(--accent-green)]";
    case "Working":
      return "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]";
    case "Cancelled":
      return "bg-[var(--accent-red)]/15 text-[var(--accent-red)]";
  }
};

export const OrderTape = ({ orders }: OrderTapeProps) => {
  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Order Tape
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">
          {orders.length > 0 ? `${orders.length} recent` : "live-updating"}
        </span>
      </div>
      <div className="flex-1 overflow-auto max-h-[260px]">
        {orders.length === 0 ? (
          <div className="px-4 py-5 text-center text-sm text-[var(--text-secondary)]">
            No orders yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border)]">
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">Symbol</th>
                <th className="text-left px-4 py-2 font-medium">Side</th>
                <th className="text-right px-4 py-2 font-medium">Qty</th>
                <th className="text-right px-4 py-2 font-medium">Price</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Algo</th>
                <th className="text-left px-4 py-2 font-medium">Account</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--text-secondary)] font-mono text-[11px]">
                    {o.time}
                  </td>
                  <td className="px-4 py-2 font-medium">{o.symbol}</td>
                  <td
                    className={`px-4 py-2 ${
                      o.side === "Buy" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"
                    }`}
                  >
                    {o.side}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{o.qty}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{o.price}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded ${statusTone(o.status)}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{o.algo || "—"}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">
                    {o.account === "shadow" ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]">
                        shadow
                      </span>
                    ) : (
                      o.account
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

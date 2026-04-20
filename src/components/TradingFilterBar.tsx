import type { ReactNode } from "react";
import type { Filters, Roundtrip } from "../lib/tradingView";
import { formatChartLabel } from "../lib/tradingView";
import type { Algo, AlgoRun } from "../types";
import type { DataSource, Position, SimOrder } from "../hooks/useTradingSimulation";

type TradingFilterBarProps = {
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
  algos: Algo[];
  activeRuns: AlgoRun[];
  dataSources: DataSource[];
  positions: Position[];
  orders: SimOrder[];
  roundtrips: Roundtrip[];
};

// Build the union of every chart / account / algo that has appeared this session:
//   connected charts + accounts seen on positions/orders/roundtrips + algos seen on runs/roundtrips.
const deriveFilterPools = (
  algos: Algo[],
  activeRuns: AlgoRun[],
  dataSources: DataSource[],
  positions: Position[],
  orders: SimOrder[],
  roundtrips: Roundtrip[],
): { charts: string[]; accounts: string[]; algos: { id: number; name: string }[] } => {
  const chartIds = new Set<string>();
  for (const ds of dataSources) chartIds.add(ds.id);
  for (const p of positions) chartIds.add(p.dataSourceId);
  for (const o of orders) chartIds.add(o.dataSourceId);
  for (const r of roundtrips) chartIds.add(r.dataSourceId);

  const accountSet = new Set<string>();
  for (const p of positions) accountSet.add(p.account);
  for (const o of orders) accountSet.add(o.account);
  for (const r of roundtrips) accountSet.add(r.account);
  for (const run of activeRuns) accountSet.add(run.account);

  const algoMap = new Map<number, string>();
  for (const run of activeRuns) {
    const a = algos.find((x) => x.id === run.algo_id);
    algoMap.set(run.algo_id, a?.name ?? `algo ${run.algo_id}`);
  }
  for (const r of roundtrips) {
    if (r.algoId !== 0) algoMap.set(r.algoId, r.algo || `algo ${r.algoId}`);
  }

  return {
    charts: [...chartIds].sort(),
    accounts: [...accountSet].sort(),
    algos: [...algoMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

type ChipProps = { active: boolean; onClick: () => void; children: ReactNode };

const Chip = ({ active, onClick, children }: ChipProps) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
      active
        ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
    }`}
  >
    {children}
  </button>
);

export const TradingFilterBar = ({
  filters,
  onFiltersChange,
  algos,
  activeRuns,
  dataSources,
  positions,
  orders,
  roundtrips,
}: TradingFilterBarProps) => {
  const { charts, accounts, algos: algoPool } = deriveFilterPools(
    algos,
    activeRuns,
    dataSources,
    positions,
    orders,
    roundtrips,
  );

  if (charts.length === 0 && accounts.length === 0 && algoPool.length === 0) {
    return null;
  }

  const setChart = (v: string | null) => onFiltersChange({ ...filters, chart: v });
  const setAccount = (v: string | null) => onFiltersChange({ ...filters, account: v });
  const setAlgo = (v: number | null) => onFiltersChange({ ...filters, algo: v });

  return (
    <div className="flex items-center gap-4 px-2 flex-wrap">
      {charts.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">
            Chart
          </span>
          <Chip active={filters.chart === null} onClick={() => setChart(null)}>
            All
          </Chip>
          {charts.map((id) => (
            <Chip
              key={id}
              active={filters.chart === id}
              onClick={() => setChart(filters.chart === id ? null : id)}
            >
              {formatChartLabel(id)}
            </Chip>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <>
          <div className="w-px h-5 bg-[var(--border)]" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">
              Account
            </span>
            <Chip active={filters.account === null} onClick={() => setAccount(null)}>
              All
            </Chip>
            {accounts.map((acc) => (
              <Chip
                key={acc}
                active={filters.account === acc}
                onClick={() => setAccount(filters.account === acc ? null : acc)}
              >
                {acc}
              </Chip>
            ))}
          </div>
        </>
      )}

      {algoPool.length > 0 && (
        <>
          <div className="w-px h-5 bg-[var(--border)]" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">
              Algo
            </span>
            <Chip active={filters.algo === null} onClick={() => setAlgo(null)}>
              All
            </Chip>
            {algoPool.map((a) => (
              <Chip
                key={a.id}
                active={filters.algo === a.id}
                onClick={() => setAlgo(filters.algo === a.id ? null : a.id)}
              >
                {a.name}
              </Chip>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

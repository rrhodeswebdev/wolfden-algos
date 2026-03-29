import { useState } from "react";
import { type AlgoStats, ACCOUNTS } from "../hooks/useTradingSimulation";

type Algo = {
  id: number;
  name: string;
  code: string;
  config: string | null;
  dependencies: string;
  deps_hash: string;
  created_at: string;
  updated_at: string;
};

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
  account: string;
};

type AlgosViewProps = {
  algos: Algo[];
  activeRuns: AlgoRun[];
  algoStats: Record<number, AlgoStats>;
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string) => void;
  onStopAlgo: (id: number, account: string) => void;
};

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">{label}</div>
    <div className={`text-sm font-medium ${color ?? ""}`}>{value}</div>
  </div>
);

const PerformanceStats = ({ stats }: { stats: AlgoStats }) => {
  const pnlColor = stats.pnl >= 0 ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";

  return (
    <div className="grid grid-cols-4 gap-x-6 gap-y-3 px-6 pb-4 pt-2">
      <Stat label="P&L" value={`${stats.pnl >= 0 ? "+" : ""}$${Math.abs(stats.pnl).toFixed(2)}`} color={pnlColor} />
      <Stat label="Win Rate" value={stats.totalTrades > 0 ? `${stats.winRate}%` : "--"} />
      <Stat label="Sharpe" value={stats.sharpe} />
      <Stat label="Profit Factor" value={stats.profitFactor} />
      <Stat label="Total Trades" value={`${stats.totalTrades}`} />
      <Stat label="Avg Win" value={stats.totalTrades > 0 ? `+$${stats.avgWin.toFixed(2)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined} />
      <Stat label="Avg Loss" value={stats.totalTrades > 0 ? `-$${Math.abs(stats.avgLoss).toFixed(2)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined} />
      <Stat label="Max Drawdown" value={stats.totalTrades > 0 ? `-$${Math.abs(stats.maxDrawdown).toFixed(2)}` : "--"} color={stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined} />
    </div>
  );
};

const AvailableAlgoRow = ({
  algo,
  availableAccounts,
  onStartAlgo,
}: {
  algo: Algo;
  availableAccounts: string[];
  onStartAlgo: (id: number, mode: "live" | "shadow", account: string) => void;
}) => {
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set([availableAccounts[0]]));

  // Keep selection in sync — remove accounts that are no longer available
  const validSelected = new Set([...selectedAccounts].filter((a) => availableAccounts.includes(a)));
  if (validSelected.size === 0 && availableAccounts.length > 0) {
    validSelected.add(availableAccounts[0]);
  }

  const toggleAccount = (account: string) => {
    const next = new Set(validSelected);
    if (next.has(account)) {
      if (next.size > 1) next.delete(account);
    } else {
      next.add(account);
    }
    setSelectedAccounts(next);
  };

  const startOnSelected = (mode: "live" | "shadow") => {
    for (const account of validSelected) {
      onStartAlgo(algo.id, mode, account);
    }
  };

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{algo.name}</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => startOnSelected("shadow")}
            className="px-4 py-2 text-xs bg-[var(--accent-yellow)] text-black rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Shadow
          </button>
          <button
            onClick={() => startOnSelected("live")}
            className="px-4 py-2 text-xs bg-[var(--accent-green)] text-black rounded-md hover:opacity-90 transition-opacity font-medium"
          >
            Live
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">Accounts</span>
        {availableAccounts.map((account) => (
          <button
            key={account}
            onClick={() => toggleAccount(account)}
            className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
              validSelected.has(account)
                ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] border border-[var(--border)]"
            }`}
          >
            {account}
          </button>
        ))}
      </div>
    </div>
  );
};

const RunningAlgoRow = ({
  algo,
  run,
  stats,
  onStopAlgo,
}: {
  algo: Algo;
  run: AlgoRun;
  stats: AlgoStats | undefined;
  onStopAlgo: (id: number, account: string) => void;
}) => (
  <div>
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <div>
          <div className="text-sm font-medium">{algo.name}</div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">{run.account}</div>
        </div>
      </div>
      <button
        onClick={() => onStopAlgo(algo.id, run.account)}
        className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
      >
        Stop
      </button>
    </div>
    {stats && <PerformanceStats stats={stats} />}
  </div>
);

const Section = ({
  title,
  count,
  color,
  children,
  onStopAll,
}: {
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
  onStopAll?: () => void;
}) => (
  <div className="bg-[var(--bg-panel)] rounded-lg overflow-hidden flex flex-col min-h-0">
    <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`} />
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {title}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">{count}</span>
      </div>
      {onStopAll && count > 0 && (
        <button
          onClick={onStopAll}
          className="px-3 py-1.5 text-[11px] bg-[var(--accent-red)]/15 text-[var(--accent-red)] rounded-md hover:bg-[var(--accent-red)]/25 transition-colors font-medium"
        >
          Stop All
        </button>
      )}
    </div>
    {count > 0 ? (
      <div className="divide-y divide-[var(--border)] overflow-auto flex-1 min-h-0">{children}</div>
    ) : (
      <div className="px-6 py-4 text-xs text-[var(--text-secondary)]">
        No algos
      </div>
    )}
  </div>
);

export const AlgosView = ({
  algos,
  activeRuns,
  algoStats,
  onStartAlgo,
  onStopAlgo,
}: AlgosViewProps) => {
  const liveRuns = activeRuns.filter((r) => r.mode === "live");
  const shadowRuns = activeRuns.filter((r) => r.mode === "shadow");

  // An algo is "available" if it has at least one account without a run
  const getAvailableAccounts = (algoId: number) =>
    ACCOUNTS.filter((account) => !activeRuns.some((r) => r.algo_id === algoId && r.account === account));

  const availableAlgos = algos.filter((a) => getAvailableAccounts(a.id).length > 0);

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
      <Section title="Available" count={availableAlgos.length} color="bg-[var(--accent-blue)]">
        {availableAlgos.map((algo) => (
          <AvailableAlgoRow
            key={algo.id}
            algo={algo}
            availableAccounts={getAvailableAccounts(algo.id)}
            onStartAlgo={onStartAlgo}
          />
        ))}
      </Section>

      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        <Section
          title="Shadow"
          count={shadowRuns.length}
          color="bg-[var(--accent-yellow)]"
          onStopAll={() => shadowRuns.forEach((r) => onStopAlgo(r.algo_id, r.account))}
        >
          {shadowRuns.map((run) => {
            const algo = algos.find((a) => a.id === run.algo_id);
            if (!algo) return null;
            return (
              <RunningAlgoRow
                key={`${run.algo_id}:${run.account}`}
                algo={algo}
                run={run}
                stats={algoStats[run.algo_id]}
                onStopAlgo={onStopAlgo}
              />
            );
          })}
        </Section>

        <Section
          title="Live"
          count={liveRuns.length}
          color="bg-[var(--accent-green)]"
          onStopAll={() => liveRuns.forEach((r) => onStopAlgo(r.algo_id, r.account))}
        >
          {liveRuns.map((run) => {
            const algo = algos.find((a) => a.id === run.algo_id);
            if (!algo) return null;
            return (
              <RunningAlgoRow
                key={`${run.algo_id}:${run.account}`}
                algo={algo}
                run={run}
                stats={algoStats[run.algo_id]}
                onStopAlgo={onStopAlgo}
              />
            );
          })}
        </Section>
      </div>
    </div>
  );
};

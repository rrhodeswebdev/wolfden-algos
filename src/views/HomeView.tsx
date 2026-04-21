import { useMemo, useState, type MouseEvent } from "react";
import UplotReact from "uplot-react";
import "uplot/dist/uPlot.min.css";
import type uPlot from "uplot";
import type { Algo, AlgoRun, NavOptions, View } from "../types";
import type { AlgoStats } from "../hooks/useTradingSimulation";

type Position = {
  symbol: string;
  side: "Long" | "Short";
  qty: number;
  avgPrice: number;
  pnl: number;
  targetPnl: number;
  algo: string;
  algoId: number;
  account: string;
};

type SessionStats = {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  maxDrawdown: number;
  sharpe: string;
  profitFactor: string;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  openPositions: number;
  avgTradeDuration: string;
  consecutiveWins: number;
  consecutiveLosses: number;
};

type AccountData = {
  buying_power: number;
  cash: number;
  realized_pnl: number;
  unrealized_pnl: number;
};

type HomeViewProps = {
  connectionStatus: "waiting" | "connected" | "error";
  accounts: Record<string, AccountData>;
  algos: Algo[];
  activeRuns: AlgoRun[];
  stats: SessionStats;
  positions: Position[];
  pnlHistory: number[];
  runPnlHistories: Record<string, number[]>;
  algoStats: Record<string, AlgoStats>;
  onNavigate: (view: View, options?: NavOptions) => void;
  onStopAlgo: (instanceId: string) => void;
};

export const HomeView = (props: HomeViewProps) => {
  const accountCount = Object.keys(props.accounts).length;
  const runningCount = props.activeRuns.length;
  const accountNames = Object.keys(props.accounts);
  const accountPositionCount = (accountName: string) =>
    props.positions.filter((p) => p.account === accountName).length;
  const accountIsActive = (accountName: string) =>
    props.activeRuns.some((r) => r.account === accountName);
  const connectionLabel =
    props.connectionStatus === "connected"
      ? `Connected to NinjaTrader · ${accountCount} account${accountCount === 1 ? "" : "s"} · ${runningCount} algo${runningCount === 1 ? "" : "s"} running`
      : props.connectionStatus === "error"
        ? "Connection error"
        : "Waiting for NinjaTrader…";
  const statusColor =
    props.connectionStatus === "connected"
      ? "bg-[var(--accent-green)]"
      : props.connectionStatus === "error"
        ? "bg-[var(--accent-red)]"
        : "bg-[var(--accent-yellow)] animate-pulse";

  const hasActivity = props.activeRuns.length > 0 || props.stats.totalTrades > 0;
  const liveCount = props.activeRuns.filter((r) => r.mode === "live").length;
  const shadowCount = props.activeRuns.filter((r) => r.mode === "shadow").length;
  const positionSymbols = [...new Set(props.positions.map((p) => p.symbol))];
  const positionSymbolsLabel =
    positionSymbols.length === 0
      ? "—"
      : positionSymbols.length <= 3
        ? positionSymbols.join(" · ")
        : `${positionSymbols.slice(0, 3).join(" · ")} +${positionSymbols.length - 3}`;

  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [hiddenInstanceIds, setHiddenInstanceIds] = useState<Set<string>>(() => new Set());

  const toggleInstanceVisibility = (instanceId: string) => {
    setHiddenInstanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-[var(--bg-primary)]">
      <div className="max-w-[1400px] w-full mx-auto p-5 flex flex-col gap-4">
        {/* Section 0: Compact header */}
        <div id="home-section-header" className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Wolf Den</h1>
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span>{connectionLabel}</span>
          </div>
        </div>

        {/* Section 1: Account strip */}
        <div id="home-section-accounts">
          {accountNames.length === 0 ? (
            <div className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)] text-sm text-[var(--text-secondary)]">
              No accounts connected
            </div>
          ) : (
            <div className={`grid gap-3 ${
              accountNames.length === 1 ? "grid-cols-1" :
              accountNames.length === 2 ? "grid-cols-2" :
              accountNames.length === 3 ? "grid-cols-3" :
              "grid-cols-4 overflow-x-auto"
            }`}>
              {accountNames.map((name) => {
                const data = props.accounts[name];
                const balance = data.cash || data.buying_power;
                // Day P&L comes straight from NT: RealizedProfitLoss (daily) + the
                // account-wide UnrealizedProfitLoss aggregate. Matches NT's Control
                // Center account row without us summing individual positions.
                const dayPnl = data.realized_pnl + data.unrealized_pnl;
                return (
                  <AccountCard
                    key={name}
                    name={name}
                    balance={balance}
                    dayPnl={dayPnl}
                    positionCount={accountPositionCount(name)}
                    isActive={accountIsActive(name)}
                    onClick={() => props.onNavigate("trading", { accountFilter: name })}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: KPI row */}
        <div id="home-section-kpis" className="grid grid-cols-4 gap-3">
          <KpiCard
            label="Total P&L"
            value={hasActivity ? formatPnl(props.stats.totalPnl) : "$0.00"}
            valueColor={hasActivity ? pnlColorClass(props.stats.totalPnl) : undefined}
            detail={hasActivity ? `Realized ${formatPnl(props.stats.realizedPnl)} · Unrealized ${formatPnl(props.stats.unrealizedPnl)}` : undefined}
            sparkline={props.pnlHistory.length > 1 ? props.pnlHistory : undefined}
            onClick={() => props.onNavigate("trading")}
          />
          <KpiCard
            label="Win Rate"
            value={props.stats.totalTrades > 0 ? `${props.stats.winRate}%` : "—"}
            detail={props.stats.totalTrades > 0 ? `${props.stats.wins} W · ${props.stats.losses} L` : undefined}
            onClick={() => props.onNavigate("trading", { scrollTo: "history" })}
          />
          <KpiCard
            label="Active Algos"
            value={`${props.activeRuns.length}`}
            detail={props.activeRuns.length > 0 ? `${liveCount} live · ${shadowCount} shadow` : undefined}
            onClick={() => props.onNavigate("algos")}
          />
          <KpiCard
            label="Open Positions"
            value={`${props.stats.openPositions}`}
            detail={positionSymbolsLabel !== "—" ? positionSymbolsLabel : undefined}
            onClick={() => props.onNavigate("trading", { scrollTo: "positions" })}
          />
        </div>

        {/* Section 3: Hero P&L chart */}
        <div id="home-section-chart" className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => props.onNavigate("trading")}
              className="group text-[11px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold hover:text-[var(--accent-blue)] transition-colors"
            >
              Session P&L
              <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
            </button>
            <TimeRangeSegmented value={timeRange} onChange={setTimeRange} />
          </div>
          <SessionPnlChart
            pnlHistory={props.pnlHistory}
            runPnlHistories={props.runPnlHistories}
            activeRuns={props.activeRuns}
            algos={props.algos}
            hiddenInstanceIds={hiddenInstanceIds}
            onToggleInstance={toggleInstanceVisibility}
          />
        </div>

        {/* Section 4: Bottom split (algos tape + performance) — filled in Tasks 8 & 9 */}
        <div id="home-section-bottom" className="grid grid-cols-3 gap-4">
          <div id="home-section-algos" className="col-span-2 p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">Active Algos</span>
              <button
                onClick={() => props.onNavigate("algos")}
                className="text-[11px] text-[var(--accent-blue)] hover:underline"
              >
                View all →
              </button>
            </div>
            {props.activeRuns.length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)] py-6 text-center">
                No algos running — start one from the Algos view
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Algo</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Mode</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Account</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">P&L</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Trades</th>
                    <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Win %</th>
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-medium">Trend</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {props.activeRuns.map((run) => {
                    const algo = props.algos.find((a) => a.id === run.algo_id);
                    const stats = props.algoStats[run.instance_id];
                    const history = props.runPnlHistories[run.instance_id] ?? [];
                    return (
                      <AlgoTapeRow
                        key={run.instance_id}
                        instanceId={run.instance_id}
                        algoName={algo?.name ?? `algo ${run.algo_id}`}
                        mode={run.mode}
                        account={run.account}
                        pnl={stats?.pnl ?? 0}
                        trades={stats?.totalTrades ?? 0}
                        winRate={stats?.winRate ?? 0}
                        history={history}
                        onClickRow={() => props.onNavigate("algos", { instanceId: run.instance_id })}
                        onStop={() => props.onStopAlgo(run.instance_id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div id="home-section-performance" className="col-span-1 p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">Performance</span>
              <button
                onClick={() => props.onNavigate("trading", { scrollTo: "stats" })}
                className="text-[11px] text-[var(--accent-blue)] hover:underline"
              >
                Full stats →
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-1">Quality</div>
                <StatRow label="Profit Factor" value={props.stats.profitFactor} />
                <StatRow label="Sharpe" value={props.stats.sharpe} />
                <StatRow
                  label="Max Drawdown"
                  value={props.stats.totalTrades > 0 ? formatPnl(props.stats.maxDrawdown) : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
                />
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-1">Trades</div>
                <StatRow
                  label="Avg Win"
                  value={props.stats.totalTrades > 0 ? formatPnl(props.stats.avgWin) : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined}
                />
                <StatRow
                  label="Avg Loss"
                  value={props.stats.totalTrades > 0 ? formatPnl(props.stats.avgLoss) : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
                />
                <StatRow label="Avg Duration" value={props.stats.avgTradeDuration || "—"} />
              </div>
              <div className="border-t border-[var(--border)] pt-3">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold mb-1">Streaks</div>
                <StatRow
                  label="Consecutive W"
                  value={props.stats.totalTrades > 0 ? `${props.stats.consecutiveWins}` : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-green)]" : undefined}
                />
                <StatRow
                  label="Consecutive L"
                  value={props.stats.totalTrades > 0 ? `${props.stats.consecutiveLosses}` : "—"}
                  valueColor={props.stats.totalTrades > 0 ? "text-[var(--accent-red)]" : undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const formatPnl = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const pnlColorClass = (value: number): string =>
  value > 0 ? "text-[var(--accent-green)]" : value < 0 ? "text-[var(--accent-red)]" : "text-[var(--text-primary)]";

type AccountCardProps = {
  name: string;
  balance: number;
  dayPnl: number;
  positionCount: number;
  isActive: boolean;
  onClick: () => void;
};

const AccountCard = ({ name, balance, dayPnl, positionCount, isActive, onClick }: AccountCardProps) => (
  <button
    onClick={onClick}
    className="group text-left p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--accent-blue)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
  >
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[var(--accent-green)]" : "bg-[var(--border)]"}`} />
        <span className="text-sm font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase text-[var(--text-secondary)] tracking-wider">NinjaTrader</span>
        <span className="text-[var(--accent-blue)] text-sm opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Balance</div>
        <div className="text-sm font-medium">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Day P&L</div>
        <div className={`text-sm font-medium ${pnlColorClass(dayPnl)}`}>{dayPnl !== 0 ? formatPnl(dayPnl) : "$0.00"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Positions</div>
        <div className="text-sm font-medium">{positionCount}</div>
      </div>
    </div>
  </button>
);

type KpiCardProps = {
  label: string;
  value: string;
  valueColor?: string;
  detail?: string;
  sparkline?: number[];
  onClick: () => void;
};

const KpiCard = ({ label, value, valueColor, detail, sparkline, onClick }: KpiCardProps) => (
  <button
    onClick={onClick}
    className="group relative text-left p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--accent-blue)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer overflow-hidden"
  >
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">{label}</span>
      <span className="text-[var(--accent-blue)] text-sm opacity-0 group-hover:opacity-100 transition-opacity">→</span>
    </div>
    <div className={`text-[22px] font-bold tracking-tight leading-tight ${valueColor ?? ""}`}>{value}</div>
    {detail ? <div className="text-[11px] text-[var(--text-secondary)] mt-1">{detail}</div> : null}
    {sparkline && sparkline.length > 1 ? (() => {
      const min = Math.min(...sparkline);
      const max = Math.max(...sparkline);
      const range = max - min || 1;
      const points = sparkline.map((v, i) => `${i},${18 - ((v - min) / range) * 16}`).join(" ");
      return (
        <svg
          viewBox={`0 0 ${sparkline.length} 20`}
          preserveAspectRatio="none"
          className={`absolute right-3 bottom-3 w-16 h-5 opacity-40 pointer-events-none ${valueColor ?? ""}`}
        >
          <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
        </svg>
      );
    })() : null}
  </button>
);

const CHART_PALETTE = ["#e5e7eb", "#22c55e", "#60a5fa", "#f59e0b", "#a78bfa", "#f472b6", "#34d399", "#fb923c"];

type SessionPnlChartProps = {
  pnlHistory: number[];
  runPnlHistories: Record<string, number[]>;
  activeRuns: AlgoRun[];
  algos: Algo[];
  hiddenInstanceIds: Set<string>;
  onToggleInstance: (instanceId: string) => void;
};

const SessionPnlChart = ({ pnlHistory, runPnlHistories, activeRuns, algos, hiddenInstanceIds, onToggleInstance }: SessionPnlChartProps) => {
  const instances = useMemo(
    () => activeRuns.filter((r) => runPnlHistories[r.instance_id]?.length),
    [activeRuns, runPnlHistories]
  );

  const data = useMemo<uPlot.AlignedData>(() => {
    const length = Math.max(pnlHistory.length, ...instances.map((r) => runPnlHistories[r.instance_id]?.length ?? 0), 1);
    const x = Array.from({ length }, (_, i) => i);
    const totalSeries = Array.from({ length }, (_, i) => pnlHistory[i] ?? pnlHistory[pnlHistory.length - 1] ?? 0);
    const perRun = instances.map((r) => {
      const h = runPnlHistories[r.instance_id] ?? [];
      return Array.from({ length }, (_, i) => h[i] ?? h[h.length - 1] ?? 0);
    });
    return [x, totalSeries, ...perRun] as uPlot.AlignedData;
  }, [pnlHistory, runPnlHistories, instances]);

  const options = useMemo<uPlot.Options>(() => ({
    width: 800,
    height: 220,
    cursor: { drag: { x: false, y: false } },
    legend: { show: false },
    scales: { x: { time: false } },
    axes: [
      { stroke: "#6b7280", grid: { stroke: "#1a1b1f", width: 1 } },
      { stroke: "#6b7280", grid: { stroke: "#1a1b1f", width: 1 } },
    ],
    series: [
      {},
      { label: "Total", stroke: CHART_PALETTE[0], width: 2, fill: "rgba(229,231,235,0.08)" },
      ...instances.map((r, i) => ({
        label: algos.find((a) => a.id === r.algo_id)?.name ?? `algo ${r.algo_id}`,
        stroke: CHART_PALETTE[(i + 1) % CHART_PALETTE.length],
        width: 1.5,
        show: !hiddenInstanceIds.has(r.instance_id),
      })),
    ],
  }), [instances, algos, hiddenInstanceIds]);

  if (pnlHistory.length <= 1) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
        No session activity yet
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-3">
        <LegendItem color={CHART_PALETTE[0]} label="Total" visible={true} onClick={() => undefined} disabledToggle />
        {instances.map((r, i) => {
          const algoName = algos.find((a) => a.id === r.algo_id)?.name ?? `algo ${r.algo_id}`;
          return (
            <LegendItem
              key={r.instance_id}
              color={CHART_PALETTE[(i + 1) % CHART_PALETTE.length]}
              label={algoName}
              visible={!hiddenInstanceIds.has(r.instance_id)}
              onClick={() => onToggleInstance(r.instance_id)}
            />
          );
        })}
      </div>
      <div className="w-full overflow-hidden">
        <UplotReact options={options} data={data} />
      </div>
    </>
  );
};

type LegendItemProps = {
  color: string;
  label: string;
  visible: boolean;
  onClick: () => void;
  disabledToggle?: boolean;
};

const LegendItem = ({ color, label, visible, onClick, disabledToggle }: LegendItemProps) => (
  <button
    onClick={disabledToggle ? undefined : onClick}
    disabled={disabledToggle}
    className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-opacity ${disabledToggle ? "cursor-default" : "hover:bg-[var(--bg-panel)]"} ${visible ? "opacity-100" : "opacity-40 line-through"}`}
  >
    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
    <span className="text-[var(--text-primary)]">{label}</span>
  </button>
);

type TimeRange = "1h" | "today" | "week" | "mtd";

type SegmentedProps = {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
};

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; enabled: boolean }[] = [
  { value: "1h", label: "1h", enabled: false },
  { value: "today", label: "Today", enabled: true },
  { value: "week", label: "Week", enabled: false },
  { value: "mtd", label: "MTD", enabled: false },
];

const TimeRangeSegmented = ({ value, onChange }: SegmentedProps) => (
  <div className="flex bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md overflow-hidden">
    {TIME_RANGE_OPTIONS.map((opt) => (
      <button
        key={opt.value}
        disabled={!opt.enabled}
        onClick={() => opt.enabled && onChange(opt.value)}
        className={`px-2.5 py-1 text-[11px] transition-colors ${
          value === opt.value
            ? "bg-[var(--bg-panel)] text-[var(--text-primary)]"
            : opt.enabled
              ? "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]"
              : "text-[var(--text-secondary)] opacity-40 cursor-not-allowed"
        }`}
        title={opt.enabled ? "" : "Coming soon"}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

type AlgoTapeRowProps = {
  instanceId: string;
  algoName: string;
  mode: string;
  account: string;
  pnl: number;
  trades: number;
  winRate: number;
  history: number[];
  onClickRow: () => void;
  onStop: () => void;
};

const AlgoTapeRow = ({ instanceId: _id, algoName, mode, account, pnl, trades, winRate, history, onClickRow, onStop }: AlgoTapeRowProps) => {
  const modePill =
    mode === "live"
      ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
      : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]";

  const handleStop = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onStop();
  };

  const sparkline = (() => {
    if (history.length <= 1) return null;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;
    const points = history.map((v, i) => `${i},${16 - ((v - min) / range) * 14}`).join(" ");
    return (
      <svg viewBox={`0 0 ${history.length} 18`} preserveAspectRatio="none" className="w-16 h-4">
        <polyline
          fill="none"
          stroke={pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)"}
          strokeWidth="1.2"
          points={points}
        />
      </svg>
    );
  })();

  return (
    <tr
      onClick={onClickRow}
      className="group border-t border-[var(--border)] hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
    >
      <td className="px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${mode === "live" ? "bg-[var(--accent-green)]" : "bg-[var(--accent-yellow)]"}`} />
          <span className="font-medium">{algoName}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${modePill}`}>{mode}</span>
      </td>
      <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">{account}</td>
      <td className={`px-3 py-2 text-sm text-right font-medium tabular-nums ${pnlColorClass(pnl)}`}>{formatPnl(pnl)}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{trades}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">{trades > 0 ? `${winRate}%` : "—"}</td>
      <td className="px-3 py-2">
        {sparkline ?? <span className="text-[var(--text-secondary)] text-xs">—</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={handleStop}
          className="opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent-red)] hover:text-[var(--accent-red)] transition-all"
          title="Stop this algo"
        >
          Stop
        </button>
      </td>
    </tr>
  );
};

type StatRowProps = {
  label: string;
  value: string;
  valueColor?: string;
};

const StatRow = ({ label, value, valueColor }: StatRowProps) => (
  <div className="flex items-center justify-between py-1 text-sm">
    <span className="text-[var(--text-secondary)]">{label}</span>
    <span className={`font-medium tabular-nums ${valueColor ?? ""}`}>{value}</span>
  </div>
);

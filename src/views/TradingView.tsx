import { useState, useEffect, useRef, useCallback } from "react";
import { type TradingSimulation, type Position, formatPrice } from "../hooks/useTradingSimulation";

type Algo = {
  id: number;
  name: string;
};

type AlgoRun = {
  algo_id: number;
  status: string;
  mode: string;
  account: string;
  data_source_id: string;
  instance_id: string;
};

type TradingViewProps = {
  simulation: TradingSimulation;
  algos: Algo[];
  activeRuns: AlgoRun[];
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Hook: smoothly interpolate position P&L toward targets using RAF
const useSmoothedPositions = (positions: Position[]) => {
  const displayRef = useRef<Position[]>(positions);
  const [display, setDisplay] = useState(positions);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      const current = displayRef.current;
      let changed = false;
      const next = positions.map((p) => {
        const existing = current.find((d) => d.symbol === p.symbol && d.algoId === p.algoId);
        if (!existing) return p;
        const smoothed = lerp(existing.pnl, p.targetPnl, 0.08);
        if (Math.abs(smoothed - existing.pnl) > 0.01) changed = true;
        return { ...p, pnl: smoothed };
      });
      if (changed || next.length !== current.length) {
        displayRef.current = next;
        setDisplay(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [positions]);

  return display;
};

// Hook: smoothly count toward a target number
const useAnimatedNumber = (target: number, speed = 0.08) => {
  const currentRef = useRef(target);
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let running = true;
    const tick = () => {
      if (!running) return;
      const next = lerp(currentRef.current, target, speed);
      if (Math.abs(next - currentRef.current) > 0.005) {
        currentRef.current = next;
        setDisplay(next);
      } else if (currentRef.current !== target) {
        currentRef.current = target;
        setDisplay(target);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, speed]);

  return display;
};

type TradingMode = "live" | "shadow";

export const TradingView = ({ simulation, algos, activeRuns }: TradingViewProps) => {
  const { positions, orders, pnlHistory, shadowPnlHistory, runPnlHistories, stats, shadowStats } = simulation;
  const [selectedAlgoId, setSelectedAlgoId] = useState<number | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedChart, setSelectedChart] = useState<string | null>(null);
  const [tradingMode, setTradingMode] = useState<TradingMode>("live");

  // Clear algo selection if the selected algo stops running
  useEffect(() => {
    if (selectedAlgoId !== null && !activeRuns.some((r) => r.algo_id === selectedAlgoId)) {
      setSelectedAlgoId(null);
    }
  }, [activeRuns, selectedAlgoId]);

  const runningAlgos = algos.filter((a) => activeRuns.some((r) => r.algo_id === a.id));

  // Derive active accounts and charts from active runs
  const activeAccounts = [...new Set([
    ...positions.map((p) => p.account),
    ...orders.map((o) => o.account),
  ])].sort();

  const activeCharts = [...new Set(activeRuns.map((r) => r.data_source_id))].sort();

  const formatChartLabel = (dsId: string) => {
    const [instrument, tf] = dsId.split(":");
    return `${instrument.split(" ")[0]} ${tf}`;
  };

  // Filter data based on mode and all selections
  const applyFilters = <T extends { algoId: number; account: string; dataSourceId: string }>(items: T[]): T[] => {
    let result = tradingMode === "shadow"
      ? items.filter((i) => i.account === "shadow")
      : items.filter((i) => i.account !== "shadow");
    if (selectedAlgoId !== null) result = result.filter((i) => i.algoId === selectedAlgoId);
    if (selectedAccount !== null) result = result.filter((i) => i.account === selectedAccount);
    if (selectedChart !== null) result = result.filter((i) => i.dataSourceId === selectedChart);
    return result;
  };

  const filteredPositions = applyFilters(positions);
  const filteredOrders = applyFilters(orders);

  // Select data based on trading mode
  const modeStats = tradingMode === "shadow" ? shadowStats : stats;
  const modePnlHistory = tradingMode === "shadow" ? shadowPnlHistory : pnlHistory;

  // P&L history: sum relevant run histories based on filters
  const filteredPnlHistory = (() => {
    if (selectedAlgoId === null && selectedAccount === null && selectedChart === null) return modePnlHistory;

    // Find matching run keys (instance_ids)
    const matchingKeys = Object.keys(runPnlHistories).filter((instanceId) => {
      const run = activeRuns.find((r) => r.instance_id === instanceId);
      if (!run) return false;
      if (selectedAlgoId !== null && run.algo_id !== selectedAlgoId) return false;
      if (selectedAccount !== null && run.account !== selectedAccount) return false;
      if (selectedChart !== null && run.data_source_id !== selectedChart) return false;
      return true;
    });

    if (matchingKeys.length === 0) return [0];

    // Sum the matching histories point by point
    const maxLen = Math.max(...matchingKeys.map((k) => runPnlHistories[k].length));
    const summed: number[] = [];
    for (let i = 0; i < maxLen; i++) {
      let sum = 0;
      for (const key of matchingKeys) {
        const hist = runPnlHistories[key];
        sum += hist[i] ?? (hist[hist.length - 1] ?? 0);
      }
      summed.push(Math.round(sum * 100) / 100);
    }
    return summed;
  })();

  const filteredStats = modeStats;

  const smoothedPositions = useSmoothedPositions(filteredPositions);

  const animatedRealized = useAnimatedNumber(filteredStats.realizedPnl);
  const animatedUnrealized = useAnimatedNumber(filteredStats.unrealizedPnl);
  const animatedTotal = useAnimatedNumber(filteredStats.totalPnl);

  const hasActivity = filteredPositions.length > 0 || filteredOrders.length > 0;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
      {/* Mode Toggle + View-Level Filters */}
      {(runningAlgos.length > 0 || activeAccounts.length > 0) && (
        <div className="flex items-center gap-4 px-2 flex-wrap">
          {/* Mode Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">Mode</span>
            {(["live", "shadow"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setTradingMode(mode)}
                className={`px-3 py-1.5 text-[11px] rounded-md transition-colors flex items-center gap-1.5 ${
                  tradingMode === mode
                    ? mode === "live"
                      ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                      : "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  mode === "live" ? "bg-[var(--accent-green)]" : "bg-[var(--accent-yellow)]"
                }`} />
                {mode === "live" ? "Live" : "Shadow"}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-[var(--border)]" />

          {/* Chart Filters */}
          {activeCharts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">Chart</span>
              <button
                onClick={() => setSelectedChart(null)}
                className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
                  selectedChart === null
                    ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }`}
              >
                All
              </button>
              {activeCharts.map((dsId) => (
                <button
                  key={dsId}
                  onClick={() => setSelectedChart(dsId === selectedChart ? null : dsId)}
                  className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
                    selectedChart === dsId
                      ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  {formatChartLabel(dsId)}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          {activeCharts.length > 0 && activeAccounts.length > 0 && (
            <div className="w-px h-5 bg-[var(--border)]" />
          )}

          {/* Account Filters */}
          {activeAccounts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">Account</span>
              <button
                onClick={() => setSelectedAccount(null)}
                className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
                  selectedAccount === null
                    ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }`}
              >
                All
              </button>
              {activeAccounts.map((account) => (
                <button
                  key={account}
                  onClick={() => setSelectedAccount(account === selectedAccount ? null : account)}
                  className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
                    selectedAccount === account
                      ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  {account}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          {activeAccounts.length > 0 && runningAlgos.length > 0 && (
            <div className="w-px h-5 bg-[var(--border)]" />
          )}

          {/* Algo Filters */}
          {runningAlgos.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mr-1">Algo</span>
              <button
                onClick={() => setSelectedAlgoId(null)}
                className={`px-3 py-1.5 text-[11px] rounded-md transition-colors ${
                  selectedAlgoId === null
                    ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }`}
              >
                All
              </button>
              {runningAlgos.map((algo) => {
                const run = activeRuns.find((r) => r.algo_id === algo.id);
                const modeColor = run?.mode === "live" ? "accent-green" : "accent-yellow";
                return (
                  <button
                    key={algo.id}
                    onClick={() => setSelectedAlgoId(algo.id === selectedAlgoId ? null : algo.id)}
                    className={`px-3 py-1.5 text-[11px] rounded-md transition-colors flex items-center gap-1.5 ${
                      selectedAlgoId === algo.id
                        ? `bg-[var(--${modeColor})]/15 text-[var(--${modeColor})]`
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full bg-[var(--${modeColor})]`} />
                    {algo.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Top Row: P&L + Stats */}
      <div className="flex gap-3">
        <div className="flex-1 grid grid-cols-3 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
          <PnlCard label="Realized P&L" value={animatedRealized} />
          <PnlCard label="Unrealized P&L" value={animatedUnrealized} />
          <PnlCard label="Total P&L" value={animatedTotal} />
        </div>
        <div className="flex-1 grid grid-cols-4 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
          <StatCell label="Win Rate" value={filteredStats.totalTrades > 0 ? `${filteredStats.winRate}%` : "--"} />
          <StatCell label="Trades" value={`${filteredStats.totalTrades}`} />
          <StatCell label="Drawdown" value={filteredStats.totalTrades > 0 ? `$${Math.abs(filteredStats.maxDrawdown).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"} />
          <StatCell label="Sharpe" value={filteredStats.sharpe} />
        </div>
      </div>

      {/* Middle: Chart Area */}
      <div className="flex-1 bg-[var(--bg-panel)] rounded-lg p-4 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            {tradingMode === "shadow" ? "Shadow P&L" : "Session P&L"}
          </h2>
        </div>
        {filteredPnlHistory.length > 1 ? (
          <PnlChart data={filteredPnlHistory} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
            {tradingMode === "shadow" ? "No shadow trades yet" : "Start an algo to see live P&L"}
          </div>
        )}
      </div>

      {/* Bottom Row: Positions + Orders */}
      <div className="flex gap-3 flex-1 min-h-0">
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
                  <th className="text-left px-4 py-2.5 font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {smoothedPositions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-5 text-center text-[var(--text-secondary)]">
                      {hasActivity ? "No open positions" : "Start an algo to see positions"}
                    </td>
                  </tr>
                ) : (
                  smoothedPositions.map((p) => (
                    <tr key={`${p.algoId}-${p.symbol}`} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 font-medium">{p.symbol}</td>
                      <td className={`px-4 py-2.5 ${p.side === "Long" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>
                        {p.side}
                      </td>
                      <td className="px-4 py-2.5 text-right">{p.qty}</td>
                      <td className="px-4 py-2.5 text-right">{formatPrice(p.symbol, p.avgPrice)}</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${p.pnl >= 0 ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>
                        {p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.algo}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.account}</td>
                    </tr>
                  ))
                )}
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
                  <th className="text-left px-4 py-2.5 font-medium">Algo</th>
                  <th className="text-left px-4 py-2.5 font-medium">Account</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-5 text-center text-[var(--text-secondary)]">
                      No orders yet
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.time}</td>
                      <td className="px-4 py-2.5 font-medium">{o.symbol}</td>
                      <td className={`px-4 py-2.5 ${o.side === "Buy" ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>
                        {o.side}
                      </td>
                      <td className="px-4 py-2.5 text-right">{o.qty}</td>
                      <td className="px-4 py-2.5 text-right">{o.price}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          o.status === "Filled"
                            ? "bg-[var(--accent-green)]/15 text-[var(--accent-green)]"
                            : o.status === "Working"
                              ? "bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]"
                              : "bg-[var(--accent-red)]/15 text-[var(--accent-red)]"
                        }`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.algo}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{o.account}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const PnlCard = ({ label, value }: { label: string; value: number }) => {
  const color = value >= 0 ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
        {label}
      </div>
      <div className={`text-lg font-semibold ${color}`}>
        {value >= 0 ? "+" : ""}${Math.abs(value).toFixed(2)}
      </div>
    </div>
  );
};

const StatCell = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
      {label}
    </div>
    <div className="text-base font-semibold">{value}</div>
  </div>
);


const PnlChart = ({ data }: { data: number[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animatedDataRef = useRef<number[]>(data);
  const rafRef = useRef<number>(0);
  const targetDataRef = useRef<number[]>(data);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    targetDataRef.current = data;
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const handleLeave = () => {
      mouseRef.current = null;
    };

    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseleave", handleLeave);
    return () => {
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const target = targetDataRef.current;
    const current = animatedDataRef.current;

    if (current.length < target.length) {
      // New points: snap all existing points to their targets, animate only the new one
      for (let i = 0; i < current.length; i++) {
        current[i] = target[i];
      }
      for (let i = current.length; i < target.length; i++) {
        current.push(current.length > 0 ? current[current.length - 1] : target[i]);
      }
    } else if (current.length > target.length) {
      current.length = target.length;
    }

    // Only animate the last point; all others are locked
    for (let i = 0; i < target.length - 1; i++) {
      current[i] = target[i];
    }
    if (target.length > 0) {
      const last = target.length - 1;
      current[last] = lerp(current[last], target[last], 0.06);
    }

    const animData = animatedDataRef.current;
    if (animData.length < 2) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Anchor Y-axis at $0
    const dataMin = Math.min(...animData, 0);
    const dataMax = Math.max(...animData, 0);
    const range = dataMax - dataMin || 1;
    const padding = range * 0.1;

    const minPoints = 60;
    const xScale = Math.max(animData.length - 1, minPoints);
    const toX = (i: number) => (i / xScale) * w;
    const toY = (v: number) => h - ((v - dataMin + padding) / (range + padding * 2)) * h;

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = "rgba(136, 136, 160, 0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    const lastVal = animData[animData.length - 1];

    // Build the step-line path (horizontal then vertical at each point)
    const traceStepLine = () => {
      ctx.moveTo(toX(0), toY(animData[0]));
      for (let i = 1; i < animData.length; i++) {
        // Horizontal segment to the next x position at the previous y
        ctx.lineTo(toX(i), toY(animData[i - 1]));
        // Vertical segment to the new y
        ctx.lineTo(toX(i), toY(animData[i]));
      }
    };

    // Draw fill and line for each region using clipping
    const regions: { clipY: number; clipH: number; color: string; gradientStops: [string, string] }[] = [
      {
        clipY: 0,
        clipH: zeroY,
        color: "#00d68f",
        gradientStops: ["rgba(0, 214, 143, 0.2)", "rgba(0, 214, 143, 0)"],
      },
      {
        clipY: zeroY,
        clipH: h - zeroY,
        color: "#ff4d6a",
        gradientStops: ["rgba(255, 77, 106, 0)", "rgba(255, 77, 106, 0.2)"],
      },
    ];

    for (const region of regions) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, region.clipY, w, region.clipH);
      ctx.clip();

      // Fill
      const grad = ctx.createLinearGradient(0, region.clipY, 0, region.clipY + region.clipH);
      grad.addColorStop(0, region.gradientStops[0]);
      grad.addColorStop(1, region.gradientStops[1]);

      ctx.beginPath();
      ctx.moveTo(toX(0), zeroY);
      traceStepLine();
      ctx.lineTo(toX(animData.length - 1), zeroY);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      traceStepLine();
      ctx.strokeStyle = region.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    }

    // Hover crosshair + tooltip
    const mouse = mouseRef.current;
    if (mouse) {
      // Find nearest data index
      const idx = Math.round((mouse.x / w) * xScale);
      const clampedIdx = Math.max(0, Math.min(animData.length - 1, idx));
      const val = animData[clampedIdx];
      const pointX = toX(clampedIdx);
      const pointY = toY(val);
      const valColor = val >= 0 ? "#00d68f" : "#ff4d6a";

      // Vertical crosshair line
      ctx.strokeStyle = "rgba(136, 136, 160, 0.3)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pointX, 0);
      ctx.lineTo(pointX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      // Horizontal crosshair line
      ctx.strokeStyle = "rgba(136, 136, 160, 0.2)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, pointY);
      ctx.lineTo(w, pointY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dot on the line
      ctx.beginPath();
      ctx.arc(pointX, pointY, 5, 0, Math.PI * 2);
      ctx.fillStyle = valColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pointX, pointY, 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#1a1a28";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Tooltip
      const label = `${val >= 0 ? "+" : ""}$${Math.abs(val).toFixed(2)}`;
      ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, sans-serif";
      const metrics = ctx.measureText(label);
      const tooltipW = metrics.width + 16;
      const tooltipH = 24;
      const tooltipPad = 10;

      // Position tooltip to avoid edges
      let tx = pointX + tooltipPad;
      if (tx + tooltipW > w) tx = pointX - tooltipW - tooltipPad;
      let ty = pointY - tooltipH - tooltipPad;
      if (ty < 0) ty = pointY + tooltipPad;

      // Background
      ctx.fillStyle = "rgba(26, 26, 40, 0.92)";
      ctx.beginPath();
      ctx.roundRect(tx, ty, tooltipW, tooltipH, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(42, 42, 58, 0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Text
      ctx.fillStyle = valColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, tx + tooltipW / 2, ty + tooltipH / 2);
    }

    // Pulsing dot (only when not hovering)
    if (!mouse) {
      const lastX = toX(animData.length - 1);
      const lastY = toY(lastVal);
      const dotColor = lastVal >= 0 ? "#00d68f" : "#ff4d6a";
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      const pulse = 0.3 + Math.sin(Date.now() / 400) * 0.2;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = pulse;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    rafRef.current = requestAnimationFrame(drawFrame);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return (
    <div ref={containerRef} className="flex-1 min-h-0">
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: "crosshair" }} />
    </div>
  );
};

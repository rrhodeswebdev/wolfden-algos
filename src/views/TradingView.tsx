import { useState, useEffect, useRef, useCallback } from "react";
import { type TradingSimulation, type Position, formatPrice } from "../hooks/useTradingSimulation";

type TradingViewProps = {
  simulation: TradingSimulation;
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

export const TradingView = ({ simulation }: TradingViewProps) => {
  const { positions, orders, pnlHistory, stats } = simulation;

  const smoothedPositions = useSmoothedPositions(positions);

  const animatedRealized = useAnimatedNumber(stats.realizedPnl);
  const animatedUnrealized = useAnimatedNumber(stats.unrealizedPnl);
  const animatedTotal = useAnimatedNumber(stats.totalPnl);

  const hasActivity = positions.length > 0 || orders.length > 0;

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
      {/* Top Row: P&L + Stats */}
      <div className="flex gap-3">
        <div className="flex-1 grid grid-cols-3 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
          <PnlCard label="Realized P&L" value={animatedRealized} />
          <PnlCard label="Unrealized P&L" value={animatedUnrealized} />
          <PnlCard label="Total P&L" value={animatedTotal} />
        </div>
        <div className="flex-1 grid grid-cols-4 gap-4 p-4 bg-[var(--bg-panel)] rounded-lg">
          <StatCell label="Win Rate" value={stats.totalTrades > 0 ? `${stats.winRate}%` : "--"} />
          <StatCell label="Trades" value={`${stats.totalTrades}`} />
          <StatCell label="Drawdown" value={stats.totalTrades > 0 ? `$${Math.abs(Math.round(stats.maxDrawdown)).toLocaleString()}` : "--"} />
          <StatCell label="Sharpe" value={stats.sharpe} />
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
        {pnlHistory.length > 1 ? (
          <PnlChart data={pnlHistory} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
            Start an algo to see live P&L
          </div>
        )}
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
                {smoothedPositions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-5 text-center text-[var(--text-secondary)]">
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
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-5 text-center text-[var(--text-secondary)]">
                      No orders yet
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
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

const PnlChart = ({ data }: { data: number[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animatedDataRef = useRef<number[]>(data);
  const rafRef = useRef<number>(0);
  const targetDataRef = useRef<number[]>(data);

  useEffect(() => {
    targetDataRef.current = data;
  }, [data]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const target = targetDataRef.current;
    const current = animatedDataRef.current;

    if (current.length !== target.length) {
      animatedDataRef.current = [...target];
    } else {
      for (let i = 0; i < target.length; i++) {
        current[i] = lerp(current[i], target[i], 0.06);
      }
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

    const min = Math.min(...animData);
    const max = Math.max(...animData);
    const range = max - min || 1;
    const padding = range * 0.1;

    const toX = (i: number) => (i / (animData.length - 1)) * w;
    const toY = (v: number) => h - ((v - min + padding) / (range + padding * 2)) * h;

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
    const isPositive = lastVal >= 0;
    const lineColor = isPositive ? "#00d68f" : "#ff4d6a";

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    if (isPositive) {
      gradient.addColorStop(0, "rgba(0, 214, 143, 0.15)");
      gradient.addColorStop(1, "rgba(0, 214, 143, 0)");
    } else {
      gradient.addColorStop(0, "rgba(255, 77, 106, 0)");
      gradient.addColorStop(1, "rgba(255, 77, 106, 0.15)");
    }

    const tension = 0.3;
    const getControlPoints = (i: number) => {
      const p0 = i > 0 ? animData[i - 1] : animData[0];
      const p1 = animData[i];
      const p2 = i < animData.length - 1 ? animData[i + 1] : animData[animData.length - 1];
      const p3 = i < animData.length - 2 ? animData[i + 2] : p2;

      const cp1x = toX(i) + (toX(i + 1) - toX(Math.max(0, i - 1))) / 6 * tension * 3;
      const cp1y = toY(p1) + (toY(p2) - toY(p0)) / 6 * tension * 3;
      const cp2x = toX(i + 1) - (toX(Math.min(animData.length - 1, i + 2)) - toX(i)) / 6 * tension * 3;
      const cp2y = toY(p2) - (toY(p3) - toY(p1)) / 6 * tension * 3;

      return { cp1x, cp1y, cp2x, cp2y };
    };

    // Fill area
    ctx.beginPath();
    ctx.moveTo(toX(0), zeroY);
    ctx.lineTo(toX(0), toY(animData[0]));
    for (let i = 0; i < animData.length - 1; i++) {
      const { cp1x, cp1y, cp2x, cp2y } = getControlPoints(i);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toX(i + 1), toY(animData[i + 1]));
    }
    ctx.lineTo(toX(animData.length - 1), zeroY);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(animData[0]));
    for (let i = 0; i < animData.length - 1; i++) {
      const { cp1x, cp1y, cp2x, cp2y } = getControlPoints(i);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toX(i + 1), toY(animData[i + 1]));
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pulsing dot
    const lastX = toX(animData.length - 1);
    const lastY = toY(lastVal);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();

    const pulse = 0.3 + Math.sin(Date.now() / 400) * 0.2;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = pulse;
    ctx.stroke();
    ctx.globalAlpha = 1;

    rafRef.current = requestAnimationFrame(drawFrame);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return (
    <div ref={containerRef} className="flex-1 min-h-0">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};

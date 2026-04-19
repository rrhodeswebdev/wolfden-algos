import { useState, useEffect, useRef } from "react";
import type { RollingMetric, RollingPoint } from "../hooks/useRollingMetrics";

type RollingMetricsChartProps = {
  sharpe: RollingPoint[];
  winRate: RollingPoint[];
  expectancy: RollingPoint[];
};

const PICKERS: { id: RollingMetric; label: string }[] = [
  { id: "sharpe", label: "Sharpe" },
  { id: "winRate", label: "Win %" },
  { id: "expectancy", label: "Expectancy" },
];

export const RollingMetricsChart = ({ sharpe, winRate, expectancy }: RollingMetricsChartProps) => {
  const [metric, setMetric] = useState<RollingMetric>("sharpe");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const series = metric === "sharpe" ? sharpe : metric === "winRate" ? winRate : expectancy;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (series.length < 2) {
      ctx.fillStyle = "rgba(136, 136, 160, 0.5)";
      ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const msg =
        series.length === 0
          ? "No rolling data yet"
          : `Partial window · ${series[0].windowSize}/20 trades`;
      ctx.fillText(msg, w / 2, h / 2);
      return;
    }

    const values = series.map((p) => p.value);
    const vMin = Math.min(0, ...values);
    const vMax = Math.max(0, ...values);
    const vRange = vMax - vMin || 1;
    const pad = vRange * 0.1;
    const toX = (i: number) => (i / Math.max(series.length - 1, 1)) * w;
    const toY = (v: number) => h - ((v - vMin + pad) / (vRange + pad * 2)) * h;

    // Zero line
    const zeroY = toY(0);
    ctx.strokeStyle = "rgba(136, 136, 160, 0.2)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Line
    const lastVal = values[values.length - 1];
    ctx.strokeStyle = lastVal >= 0 ? "#00d68f" : "#ff4d6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = toX(i);
      const y = toY(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Last point dot
    const lx = toX(series.length - 1);
    const ly = toY(lastVal);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = lastVal >= 0 ? "#00d68f" : "#ff4d6a";
    ctx.fill();
  }, [series]);

  const partialWindowNotice =
    series.length > 0 && series[0].windowSize < 20
      ? ` · partial ${series[0].windowSize}/20`
      : "";

  return (
    <div className="bg-[var(--bg-panel)] rounded-lg flex flex-col h-[220px]">
      <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Rolling Metrics
          <span className="font-normal normal-case tracking-normal text-[var(--text-muted)]">
            {" "}
            · 20-trade window{partialWindowNotice}
          </span>
        </h2>
        <div className="flex gap-1">
          {PICKERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setMetric(p.id)}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                metric === p.id
                  ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 px-4 py-3">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
};

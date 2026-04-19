import { useEffect, useRef } from "react";
import type { EquityPoint, DrawdownPoint } from "../lib/tradingView";

type EquityChartProps = {
  live: EquityPoint[];
  shadow: EquityPoint[];
  drawdown: DrawdownPoint[];
};

const GREEN = "#00d68f";
const RED = "#ff4d6a";
const DD_FILL = "rgba(255, 77, 106, 0.10)";
const GRID = "rgba(136, 136, 160, 0.2)";
const SHADOW_COLOR = "rgba(255, 193, 7, 0.8)";
const TOOLTIP_BG = "rgba(26, 26, 40, 0.92)";
const TOOLTIP_BORDER = "rgba(42, 42, 58, 0.8)";

type DrawData = {
  t: number;
  pnl: number;
};

const formatValue = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

export const EquityChart = ({ live, shadow, drawdown }: EquityChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const liveRef = useRef(live);
  const shadowRef = useRef(shadow);
  const ddRef = useRef(drawdown);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  useEffect(() => {
    shadowRef.current = shadow;
  }, [shadow]);
  useEffect(() => {
    ddRef.current = drawdown;
  }, [drawdown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const move = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const leave = () => {
      mouseRef.current = null;
    };
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseleave", leave);
    return () => {
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseleave", leave);
    };
  }, []);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const liveSeries = liveRef.current;
      const shadowSeries = shadowRef.current;
      const dd = ddRef.current;

      const all: DrawData[] = [...liveSeries, ...shadowSeries];
      if (all.length < 2) {
        ctx.fillStyle = "rgba(136, 136, 160, 0.5)";
        ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("No equity data yet", w / 2, h / 2);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Domain: time min/max across both series; value min/max anchored at 0.
      const tMin = Math.min(...all.map((p) => p.t));
      const tMax = Math.max(...all.map((p) => p.t));
      const tRange = Math.max(tMax - tMin, 1);
      const vMin = Math.min(0, ...all.map((p) => p.pnl));
      const vMax = Math.max(0, ...all.map((p) => p.pnl));
      const vRange = vMax - vMin || 1;
      const pad = vRange * 0.1;
      const toX = (t: number) => ((t - tMin) / tRange) * w;
      const toY = (v: number) => h - ((v - vMin + pad) / (vRange + pad * 2)) * h;

      // Zero line
      const zeroY = toY(0);
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(w, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Drawdown band (underwater area beneath live series)
      if (dd.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(toX(dd[0].t), toY(dd[0].peak));
        for (let i = 1; i < dd.length; i++) {
          ctx.lineTo(toX(dd[i].t), toY(dd[i].peak));
        }
        for (let i = dd.length - 1; i >= 0; i--) {
          ctx.lineTo(toX(dd[i].t), toY(dd[i].pnl));
        }
        ctx.closePath();
        ctx.fillStyle = DD_FILL;
        ctx.fill();
      }

      const traceStep = (series: DrawData[]) => {
        if (series.length === 0) return;
        ctx.moveTo(toX(series[0].t), toY(series[0].pnl));
        for (let i = 1; i < series.length; i++) {
          ctx.lineTo(toX(series[i].t), toY(series[i - 1].pnl));
          ctx.lineTo(toX(series[i].t), toY(series[i].pnl));
        }
      };

      // Live series — split by sign for green/red coloring via clip regions.
      if (liveSeries.length >= 2) {
        const regions = [
          { yStart: 0, yEnd: zeroY, color: GREEN, grad: ["rgba(0,214,143,0.2)", "rgba(0,214,143,0)"] },
          { yStart: zeroY, yEnd: h, color: RED, grad: ["rgba(255,77,106,0)", "rgba(255,77,106,0.2)"] },
        ];
        for (const r of regions) {
          if (r.yEnd - r.yStart <= 0) continue;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, r.yStart, w, r.yEnd - r.yStart);
          ctx.clip();
          const g = ctx.createLinearGradient(0, r.yStart, 0, r.yEnd);
          g.addColorStop(0, r.grad[0]);
          g.addColorStop(1, r.grad[1]);
          ctx.beginPath();
          ctx.moveTo(toX(liveSeries[0].t), zeroY);
          traceStep(liveSeries);
          ctx.lineTo(toX(liveSeries[liveSeries.length - 1].t), zeroY);
          ctx.closePath();
          ctx.fillStyle = g;
          ctx.fill();
          ctx.beginPath();
          traceStep(liveSeries);
          ctx.strokeStyle = r.color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Shadow series — dashed overlay
      if (shadowSeries.length >= 2) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = SHADOW_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        traceStep(shadowSeries);
        ctx.stroke();
        ctx.restore();
      }

      // Crosshair + tooltip for the live series
      const mouse = mouseRef.current;
      if (mouse && liveSeries.length >= 2) {
        // Nearest point by x
        let nearestIdx = 0;
        let nearestDx = Infinity;
        for (let i = 0; i < liveSeries.length; i++) {
          const dx = Math.abs(toX(liveSeries[i].t) - mouse.x);
          if (dx < nearestDx) {
            nearestDx = dx;
            nearestIdx = i;
          }
        }
        const point = liveSeries[nearestIdx];
        const px = toX(point.t);
        const py = toY(point.pnl);
        const color = point.pnl >= 0 ? GREEN : RED;

        ctx.strokeStyle = "rgba(136, 136, 160, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#1a1a28";
        ctx.lineWidth = 2;
        ctx.stroke();

        const label = formatValue(point.pnl);
        ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, sans-serif";
        const metrics = ctx.measureText(label);
        const tw = metrics.width + 16;
        const th = 24;
        const pad2 = 10;
        let tx = px + pad2;
        if (tx + tw > w) tx = px - tw - pad2;
        let ty = py - th - pad2;
        if (ty < 0) ty = py + pad2;
        ctx.fillStyle = TOOLTIP_BG;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, th, 4);
        ctx.fill();
        ctx.strokeStyle = TOOLTIP_BORDER;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, tx + tw / 2, ty + th / 2);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div ref={containerRef} className="flex-1 min-h-0">
      <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: "crosshair" }} />
    </div>
  );
};

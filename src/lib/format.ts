// Shared UI formatters used across Trading / Algos / Home views.
// Kept here so every view renders P&L / color / sparkline consistently.

export const formatPnl = (value: number): string => {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const pnlColorClass = (value: number): string =>
  value > 0
    ? "text-[var(--accent-green)]"
    : value < 0
      ? "text-[var(--accent-red)]"
      : "text-[var(--text-primary)]";

export const sparklinePoints = (history: number[], width: number, height: number): string => {
  if (history.length <= 1) return "";
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const stepX = width / (history.length - 1);
  return history
    .map((v, i) => `${(i * stepX).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`)
    .join(" ");
};

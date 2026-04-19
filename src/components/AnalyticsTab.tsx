import type { DistributionBucket, HeatCell } from "../lib/tradingView";
import type { RollingMetrics } from "../hooks/useRollingMetrics";
import { TradeDistribution } from "./TradeDistribution";
import { SessionHeatmap } from "./SessionHeatmap";
import { RollingMetricsChart } from "./RollingMetricsChart";

type AnalyticsTabProps = {
  distribution: DistributionBucket[];
  heatmap: HeatCell[][];
  rolling: RollingMetrics;
  totalTrades: number;
};

export const AnalyticsTab = ({
  distribution,
  heatmap,
  rolling,
  totalTrades,
}: AnalyticsTabProps) => {
  return (
    <div className="flex flex-col gap-3 p-3">
      <TradeDistribution buckets={distribution} totalTrades={totalTrades} />
      <div className="grid grid-cols-2 gap-3">
        <SessionHeatmap grid={heatmap} />
        <RollingMetricsChart
          sharpe={rolling.sharpe}
          winRate={rolling.winRate}
          expectancy={rolling.expectancy}
        />
      </div>
    </div>
  );
};

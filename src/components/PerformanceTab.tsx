import type { BreakdownRow, LiveShadowPair } from "../lib/tradingView";
import { BreakdownTable } from "./BreakdownTable";
import { LiveShadowDelta } from "./LiveShadowDelta";

type PerformanceTabProps = {
  byAlgo: BreakdownRow[];
  bySymbol: BreakdownRow[];
  byAccount: BreakdownRow[];
  liveVsShadow: LiveShadowPair[];
  onOpenAlgoInEditor: (algoId: number) => void;
  onViewAccountInAlgos: (account: string) => void;
};

export const PerformanceTab = ({
  byAlgo,
  bySymbol,
  byAccount,
  liveVsShadow,
  onOpenAlgoInEditor,
  onViewAccountInAlgos,
}: PerformanceTabProps) => {
  return (
    <div className="flex flex-col gap-3 p-3">
      <BreakdownTable
        title="By Algo"
        labelHeader="Algo"
        rows={byAlgo}
        emptyMessage="No completed trades yet — breakdowns appear after your first roundtrip"
        onRowDeepLink={(row) => {
          const id = Number(row.key);
          if (Number.isFinite(id) && id > 0) onOpenAlgoInEditor(id);
        }}
        deepLinkLabel="Open in Editor"
      />

      <div className="grid grid-cols-2 gap-3">
        <BreakdownTable
          title="By Symbol"
          labelHeader="Symbol"
          rows={bySymbol}
          emptyMessage="No completed trades yet"
        />
        <BreakdownTable
          title="By Account"
          labelHeader="Account"
          rows={byAccount}
          emptyMessage="No completed trades yet"
          onRowDeepLink={(row) => onViewAccountInAlgos(row.key)}
          deepLinkLabel="View algos for this account"
        />
      </div>

      <LiveShadowDelta pairs={liveVsShadow} />
    </div>
  );
};

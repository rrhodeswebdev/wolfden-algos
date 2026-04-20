import type { Roundtrip } from "../lib/tradingView";
import { RoundtripsTable } from "./RoundtripsTable";
import { TradeDetailPanel } from "./TradeDetailPanel";

type TradesTabProps = {
  roundtrips: Roundtrip[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export const TradesTab = ({ roundtrips, selectedId, onSelect }: TradesTabProps) => {
  const selected = selectedId ? roundtrips.find((r) => r.id === selectedId) ?? null : null;

  return (
    <div className="flex gap-3 p-3 h-full min-h-0">
      <div className={`flex-1 min-h-0 ${selected ? "basis-3/5" : ""}`}>
        <RoundtripsTable
          roundtrips={roundtrips}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
      {selected && (
        <div className="basis-2/5 min-h-0">
          <TradeDetailPanel roundtrip={selected} onClose={() => onSelect(null)} />
        </div>
      )}
    </div>
  );
};

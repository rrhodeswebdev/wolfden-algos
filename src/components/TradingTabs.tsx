export type TradingTab = "live" | "performance" | "analytics" | "trades";

type TradingTabsProps = {
  activeTab: TradingTab;
  onChange: (tab: TradingTab) => void;
};

const TABS: { id: TradingTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "performance", label: "Performance" },
  { id: "analytics", label: "Analytics" },
  { id: "trades", label: "Trades" },
];

export const TradingTabs = ({ activeTab, onChange }: TradingTabsProps) => (
  <div className="flex gap-1 border-b border-[var(--border)] px-2">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
          activeTab === tab.id
            ? "border-[var(--accent-blue)] text-[var(--accent-blue)]"
            : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

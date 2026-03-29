import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

type View = "home" | "editor" | "algos" | "trading";

type SidebarProps = {
  activeView: View;
  onNavigate: (view: View) => void;
  connectionStatus: "waiting" | "connected" | "error";
};

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: "home", label: "Home", icon: "⌂" },
  { view: "editor", label: "Editor", icon: "λ" },
  { view: "algos", label: "Algos", icon: "▶" },
  { view: "trading", label: "Trading", icon: "⇅" },
];

const openGuideWindow = async () => {
  const existing = await WebviewWindow.getByLabel("guide");
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow("guide", {
    title: "Wolf Den — Guide",
    url: "guide.html",
    width: 860,
    height: 700,
    resizable: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
};

export const Sidebar = ({ activeView, onNavigate, connectionStatus }: SidebarProps) => {
  return (
    <div className="flex flex-col w-20 bg-[var(--bg-secondary)] border-r border-[var(--border)] select-none">
      {/* Logo */}
      <div className="flex items-center justify-center h-20 border-b border-[var(--border)] p-1">
        <img src="/wolf-den-logo.svg" alt="Wolf Den" className="w-full h-full object-contain" />
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col items-center pt-6 gap-4">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button
            key={view}
            onClick={() => onNavigate(view)}
            className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-colors ${
              activeView === view
                ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
            }`}
            title={label}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span className="text-[9px] mt-1.5 font-medium uppercase tracking-wider">{label}</span>
          </button>
        ))}
      </nav>

      {/* Guide (bottom) */}
      <div className="flex flex-col items-center pb-4 gap-4">
        <button
          onClick={openGuideWindow}
          className="flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
          title="Guide"
        >
          <span className="text-lg leading-none">?</span>
          <span className="text-[9px] mt-1.5 font-medium uppercase tracking-wider">Guide</span>
        </button>
      </div>

      {/* Connection Status */}
      <div className="flex items-center justify-center pb-6">
        <div
          className={`w-3 h-3 rounded-full ${
            connectionStatus === "connected"
              ? "bg-[var(--accent-green)]"
              : connectionStatus === "error"
                ? "bg-[var(--accent-red)]"
                : "bg-[var(--accent-yellow)] animate-pulse"
          }`}
          title={
            connectionStatus === "connected"
              ? "NinjaTrader Connected"
              : connectionStatus === "error"
                ? "Connection Error"
                : "Waiting for NinjaTrader..."
          }
        />
      </div>
    </div>
  );
};

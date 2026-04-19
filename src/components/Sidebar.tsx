import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { View } from "../types";

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
    width: 1200,
    height: 900,
    resizable: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
};

export const Sidebar = ({ activeView, onNavigate, connectionStatus }: SidebarProps) => {
  const statusTitle =
    connectionStatus === "connected"
      ? "NinjaTrader Connected"
      : connectionStatus === "error"
        ? "Connection Error"
        : "Waiting for NinjaTrader...";

  return (
    <div className="flex flex-col w-[52px] bg-[var(--bg-secondary)] border-r border-[var(--border)] select-none">
      {/* Logo */}
      <div className="flex items-center justify-center h-12 border-b border-[var(--border)] p-1.5">
        <img src="/wolf-den-logo.svg" alt="Wolf Den" className="w-8 h-8 object-contain" />
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col items-center pt-3 gap-1">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button
            key={view}
            onClick={() => onNavigate(view)}
            title={label}
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              activeView === view
                ? "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="text-base leading-none">{icon}</span>
          </button>
        ))}
      </nav>

      {/* Guide + Connection Status (bottom, centered) */}
      <div className="flex flex-col items-center pb-3 gap-2">
        <button
          onClick={openGuideWindow}
          title="Guide"
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]"
        >
          <span className="text-base leading-none">?</span>
        </button>
        <div
          title={statusTitle}
          className={`w-2 h-2 rounded-full ${
            connectionStatus === "connected"
              ? "bg-[var(--accent-green)]"
              : connectionStatus === "error"
                ? "bg-[var(--accent-red)]"
                : "bg-[var(--accent-yellow)] animate-pulse"
          }`}
        />
      </div>
    </div>
  );
};

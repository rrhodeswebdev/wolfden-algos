import { getCurrentWindow } from "@tauri-apps/api/window";

type TitleBarProps = {
  title: string;
};

export const TitleBar = ({ title }: TitleBarProps) => (
  <div
    onMouseDown={() => getCurrentWindow().startDragging()}
    className="h-8 flex-shrink-0 flex items-center justify-center bg-[var(--bg-secondary)] border-b border-[var(--border)] select-none cursor-default"
  >
    <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] pointer-events-none">
      {title}
    </span>
  </div>
);

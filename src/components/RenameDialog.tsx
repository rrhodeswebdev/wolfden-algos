import { useEffect, useRef, useState } from "react";

type RenameDialogProps = {
  currentName: string;
  onRename: (newName: string) => void;
  onCancel: () => void;
};

export const RenameDialog = ({ currentName, onRename, onCancel }: RenameDialogProps) => {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentName) {
      onCancel();
      return;
    }
    onRename(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <label className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold block mb-2">
          Rename algo
        </label>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") onCancel();
          }}
          className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] mb-6"
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-md hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="px-4 py-2 text-xs bg-[var(--accent-blue)] text-white rounded-md hover:opacity-90 transition-opacity"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
};

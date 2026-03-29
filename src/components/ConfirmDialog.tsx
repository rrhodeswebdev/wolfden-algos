type ConfirmDialogProps = {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog = ({ message, confirmLabel = "Confirm", onConfirm, onCancel }: ConfirmDialogProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <p className="text-sm text-[var(--text-primary)] mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-md hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-xs bg-[var(--accent-red)] text-white rounded-md hover:opacity-90 transition-opacity"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type VenvSetupModalProps = {
  onComplete: () => void;
};

export const VenvSetupModal = ({ onComplete }: VenvSetupModalProps) => {
  const [status, setStatus] = useState<"installing" | "error">("installing");
  const [errorMessage, setErrorMessage] = useState("");

  const runSetup = async () => {
    setStatus("installing");
    setErrorMessage("");

    try {
      await invoke<string>("setup_venv");
      onComplete();
    } catch (e) {
      setErrorMessage(String(e));
      setStatus("error");
    }
  };

  useEffect(() => {
    runSetup();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl">
        <h2 className="text-base font-semibold mb-1">Setting Up Python Environment</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Installing required Python packages for algo execution...
        </p>

        {status === "installing" && (
          <div className="flex items-center gap-3 py-4">
            <div className="w-4 h-4 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--text-primary)]">Installing dependencies...</span>
          </div>
        )}

        {status === "error" && (
          <>
            <div className="mb-4">
              <div className="text-xs font-medium text-[var(--accent-red)] mb-2">Setup failed</div>
              <pre className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-md p-3 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                {errorMessage}
              </pre>
            </div>
            <div className="flex justify-end">
              <button
                onClick={runSetup}
                className="px-4 py-2 text-xs bg-[var(--accent-blue)] text-white rounded-md hover:opacity-90 transition-opacity font-medium"
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

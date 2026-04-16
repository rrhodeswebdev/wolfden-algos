import { useState, useEffect, useCallback, useRef } from "react";

type ToastMessage = {
  id: number;
  text: string;
  type: "error" | "info";
};

let nextId = 0;
let addToastGlobal: ((text: string, type?: "error" | "info") => void) | null = null;

/** Show a toast from anywhere (after ToastContainer mounts). */
export const toast = {
  error: (text: string) => addToastGlobal?.(text, "error"),
  info: (text: string) => addToastGlobal?.(text, "info"),
};

export const ToastContainer = () => {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const timeoutIds = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const addToast = useCallback((text: string, type: "error" | "info" = "error") => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, text, type }]);
    const timeoutId = setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      timeoutIds.current.delete(timeoutId);
    }, 5000);
    timeoutIds.current.add(timeoutId);
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  useEffect(() => {
    return () => {
      timeoutIds.current.forEach(clearTimeout);
    };
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`px-4 py-3 rounded-lg text-xs font-medium shadow-lg border animate-[fadeIn_0.2s_ease-out] ${
            msg.type === "error"
              ? "bg-[var(--accent-red)]/15 text-[var(--accent-red)] border-[var(--accent-red)]/30"
              : "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] border-[var(--accent-blue)]/30"
          }`}
        >
          {msg.text}
        </div>
      ))}
    </div>
  );
};

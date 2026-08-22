import { useEffect, useState } from "react";

const DISMISS_MS = 5000;

interface Toast {
  id: number;
  text: string;
  variant: "error" | "info";
  onClick?: () => void;
}

// Module-level subscriber list, same pattern as TooltipHost: any file can
// call showToast() without needing a context provider wrapped around it.
let nextId = 0;
let listeners: ((toast: Toast) => void)[] = [];

export function showToast(text: string, variant: Toast["variant"] = "error", onClick?: () => void) {
  const toast: Toast = { id: nextId++, text, variant, onClick };
  listeners.forEach((fn) => fn(toast));
}

// Mount once near the app root, alongside TooltipHost.
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(toast: Toast) {
      setToasts((prev) => [...prev, toast]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, DISMISS_MS);
    }
    listeners.push(onToast);
    return () => {
      listeners = listeners.filter((fn) => fn !== onToast);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[300] flex flex-col gap-2 items-end">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`text-[13px] text-text-primary bg-bg-tertiary border rounded-md px-3 py-2 shadow-[0_3px_10px_rgba(0,0,0,0.25)] cursor-default max-w-[320px] ${
            toast.variant === "error" ? "border-danger" : "border-border"
          }`}
          onClick={() => {
            toast.onClick?.();
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}

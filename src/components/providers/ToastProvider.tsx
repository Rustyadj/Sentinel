"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ToastKind = "success" | "error" | "warning" | "info";
type ToastInput = { title: string; description?: string; kind?: ToastKind };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback((toast: ToastInput) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-3), { ...toast, id }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => notify((event as CustomEvent<ToastInput>).detail);
    window.addEventListener("sentinel:toast", listener);
    return () => window.removeEventListener("sentinel:toast", listener);
  }, [notify]);

  const value = useMemo(() => notify, [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-white/10 bg-[#101722]/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur">
            <div className="font-semibold">{item.title}</div>
            {item.description ? <div className="mt-1 text-white/65">{item.description}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() { return useContext(ToastContext); }

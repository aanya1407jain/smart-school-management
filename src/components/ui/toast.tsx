"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ToastTone = "success" | "error" | "info";
interface ToastItem { id: number; title: string; description?: string; tone: ToastTone }
interface ToastApi { toast: (t: Omit<ToastItem, "id" | "tone"> & { tone?: ToastTone }) => void }

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastApi["toast"]>((t) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, tone: t.tone ?? "success", title: t.title, description: t.description }]);
    setTimeout(() => dismiss(id), 4800);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5">
        {items.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
          return (
            <div key={t.id} role="status" className="glass-strong pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-2xl p-4">
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", t.tone === "success" ? "text-lagoon" : t.tone === "error" ? "text-plum" : "text-sapphire")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-ink-muted">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded-md p-1 text-ink-muted hover:bg-sapphire/5 hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

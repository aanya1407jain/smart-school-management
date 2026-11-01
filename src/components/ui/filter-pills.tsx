"use client";
import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

/**
 * Frosted filter rail (tablist semantics) for list filters such as status or
 * category. The active background is one glass pill that slides between items;
 * an item's `count` shows as a small tabular badge.
 */
export function FilterPills<T extends string>({
  value, onChange, items, label, className,
}: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number | null }[]; label: string; className?: string }) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("scrollbar-thin flex max-w-full gap-1 relative overflow-x-auto rounded-xl bg-bg p-1 ring-1 ring-inset ring-line sm:w-fit", className)}
    >
      {items.map((i) => {
        const active = i.value === value;
        return (
          <button
            key={i.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(i.value)}
            className={cn(
              "relative isolate flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 active:scale-95 focus-visible:outline-none focus-visible:shadow-focus",
              active ? "text-lagoon" : "text-ink-muted hover:bg-white/50 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={`pills-${id}`}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
                className="absolute inset-0 -z-10 rounded-lg bg-white shadow-[0_1px_2px_rgb(16_24_40/0.08)] ring-1 ring-line"
              />
            )}
            <span>{i.label}</span>
            {i.count !== undefined && i.count !== null && (
              <span className={cn("figures rounded-full px-1.5 text-[11px] font-bold", active ? "bg-teal-soft text-lagoon" : "bg-heather/30 text-ink-soft")}>{i.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

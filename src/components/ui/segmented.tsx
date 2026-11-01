"use client";
import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

const SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;

/**
 * Accessible radio-group styled as a frosted segmented control. The active
 * background is one shared element that slides between options.
 *
 * `variant="chips"` renders separate tactile toggle chips (attendance
 * Present / Absent / Late) with the same radio semantics; an option's
 * `activeClass` sets its active colour (background + text) in either variant.
 */
export function Segmented<T extends string>({
  value, onChange, options, label, size = "md", className, variant = "pill",
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: string; activeClass?: string; short?: string; icon?: ReactNode }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
  variant?: "pill" | "chips";
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const chips = variant === "chips";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative inline-flex",
        chips ? "gap-1.5" : "rounded-xl bg-white/55 p-1 shadow-[inset_0_1px_2px_rgb(6_49_84/0.06)] ring-1 ring-inset ring-line/70 backdrop-blur-md",
        className,
      )}
    >
      {options.map((o) => {
        const active = value === o.value;
        // The option's own colour: its background goes on the sliding pill, its text colour on the label.
        const custom = o.activeClass?.split(" ") ?? [];
        const pillClass = custom.filter((c) => !c.startsWith("text-")).join(" ");
        const textClass = custom.filter((c) => c.startsWith("text-")).join(" ");
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-label={o.label}
            aria-checked={active}
            onClick={() => onChange(o.value)}
            whileTap={reduceMotion ? undefined : { scale: 0.94 }}
            className={cn(
              "relative isolate inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-focus",
              size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3.5 py-1.5 text-[13px]",
              chips
                ? cn("rounded-full ring-1 ring-inset", active ? "ring-transparent" : "bg-white/60 ring-line/80 hover:bg-white hover:ring-teal/30")
                : "rounded-lg",
              active ? (textClass || (chips ? "text-white" : "text-lagoon")) : "text-ink-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                aria-hidden
                layoutId={chips ? undefined : `seg-${id}`}
                initial={chips && !reduceMotion ? { scale: 0.7, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={reduceMotion ? { duration: 0 } : SPRING}
                className={cn(
                  "absolute inset-0 -z-10",
                  chips ? "rounded-full" : "rounded-lg",
                  pillClass || (chips
                    ? "bg-gradient-to-br from-teal to-aqua shadow-[0_4px_14px_-4px_rgb(var(--c-teal)/0.6)]"
                    : "bg-white shadow-[0_2px_10px_-3px_rgb(var(--c-cyan)/0.45)] ring-1 ring-teal/20"),
                )}
              />
            )}
            {o.icon}
            <span className={o.short ? "hidden sm:inline" : undefined}>{o.label}</span>
            {o.short && <span className="sm:hidden" aria-hidden>{o.short}</span>}
          </motion.button>
        );
      })}
    </div>
  );
}

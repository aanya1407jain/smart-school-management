"use client";
import { cn } from "@/lib/utils/cn";

/** Accessible radio-group styled as a segmented control. */
export function Segmented<T extends string>({
  value, onChange, options, label, size = "md", className,
}: { value: T | null; onChange: (v: T) => void; options: { value: T; label: string; activeClass?: string; short?: string }[]; label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-xl bg-alabaster p-1 ring-1 ring-line/80", className)}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-label={o.label}
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg font-medium transition-all",
              size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3.5 py-1.5 text-[13px]",
              active ? o.activeClass ?? "bg-white text-sapphire shadow-soft" : "text-ink-muted hover:text-ink",
            )}
          >
            <span className={o.short ? "hidden sm:inline" : undefined}>{o.label}</span>
            {o.short && <span className="sm:hidden" aria-hidden>{o.short}</span>}
          </button>
        );
      })}
    </div>
  );
}

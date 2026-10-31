"use client";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Glass search field: the border and a soft cyan glow expand on focus, and the
 * search icon lifts and turns teal (peer-focus).
 */
export function SearchInput({
  value, onChange, placeholder = "Search…", className, label = "Search",
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <div className={cn("relative", className)}>
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "peer h-10 w-full rounded-xl border border-line bg-white/80 pl-9 pr-9 text-sm text-ink placeholder:text-ink-muted/70 backdrop-blur-md",
          "shadow-[0_1px_2px_rgb(6_49_84_/_0.04)] transition-[border-color,box-shadow,background-color] duration-300 ease-out",
          "hover:border-teal/40 focus:border-teal focus:bg-white focus:shadow-focus focus:outline-none [&::-webkit-search-cancel-button]:hidden",
        )}
      />
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted transition-all duration-300 ease-out peer-focus:-translate-y-[calc(50%+1px)] peer-focus:scale-110 peer-focus:text-teal"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-ink-muted transition-colors hover:bg-teal-soft hover:text-lagoon active:scale-90">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

"use client";
import * as T from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export const Tabs = T.Root;
export const TabsContent = ({ value, children, className }: { value: string; children: ReactNode; className?: string }) => (
  <T.Content value={value} className={cn("mt-5 animate-fade-up focus-visible:outline-none", className)}>{children}</T.Content>
);

export function TabsList({ items, className }: { items: { value: string; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    // Frosted rail; the active tab is a raised glass pill with a teal hairline and cyan glow.
    <T.List className={cn("scrollbar-thin flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-white/50 p-1 shadow-[inset_0_1px_2px_rgb(6_49_84/0.06)] ring-1 ring-inset ring-line/70 backdrop-blur-md sm:w-fit", className)} aria-label="Sections">
      {items.map((i) => (
        <T.Trigger
          key={i.value}
          value={i.value}
          className={cn(
            "group inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-ink-muted transition-all duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:shadow-focus",
            "hover:bg-white/60 hover:text-ink data-[state=active]:bg-white data-[state=active]:text-lagoon data-[state=active]:shadow-[0_2px_10px_-3px_rgb(var(--c-cyan)/0.45)] data-[state=active]:ring-1 data-[state=active]:ring-teal/20",
          )}
        >
          {i.label}
          {i.count !== undefined && (
            <span className="figures rounded-full bg-heather/30 px-1.5 text-[11px] font-semibold text-ink-soft group-data-[state=active]:bg-teal-soft group-data-[state=active]:text-lagoon">{i.count}</span>
          )}
        </T.Trigger>
      ))}
    </T.List>
  );
}

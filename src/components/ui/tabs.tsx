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
    <T.List className={cn("scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1", className)} aria-label="Sections">
      {items.map((i) => (
        <T.Trigger
          key={i.value}
          value={i.value}
          className={cn(
            "group inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-ink-muted transition-colors",
            "hover:bg-white/70 hover:text-ink data-[state=active]:bg-white data-[state=active]:text-sapphire data-[state=active]:shadow-soft data-[state=active]:ring-1 data-[state=active]:ring-line/80",
          )}
        >
          {i.label}
          {i.count !== undefined && (
            <span className="rounded-full bg-heather/30 px-1.5 text-[11px] font-semibold text-ink-soft group-data-[state=active]:bg-teal-soft group-data-[state=active]:text-lagoon">{i.count}</span>
          )}
        </T.Trigger>
      ))}
    </T.List>
  );
}

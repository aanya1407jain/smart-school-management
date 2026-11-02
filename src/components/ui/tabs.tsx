"use client";
import * as T from "@radix-ui/react-tabs";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Tabs root. `min-w-0` lets it shrink inside grid/flex parents: without it the
 * (horizontally scrollable) tab list's full width becomes the column's minimum
 * and pushes the page wider than a phone screen.
 */
export function Tabs({ className, ...props }: ComponentProps<typeof T.Root>) {
  return <T.Root className={cn("min-w-0", className)} {...props} />;
}
export const TabsContent = ({ value, children, className }: { value: string; children: ReactNode; className?: string }) => (
  <T.Content value={value} className={cn("mt-5 animate-fade-up focus-visible:outline-none", className)}>{children}</T.Content>
);

export function TabsList({ items, className }: { items: { value: string; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    // Quiet grey rail; the active tab is a white chip with a hairline border.
    <T.List className={cn("scrollbar-thin flex max-w-full gap-1 relative overflow-x-auto rounded-xl bg-bg p-1 ring-1 ring-inset ring-line sm:w-fit", className)} aria-label="Sections">
      {items.map((i) => (
        <T.Trigger
          key={i.value}
          value={i.value}
          className={cn(
            "group inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-ink-muted transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
            "hover:bg-white/60 hover:text-ink data-[state=active]:bg-white data-[state=active]:text-lagoon data-[state=active]:shadow-[0_1px_2px_rgb(16_24_40/0.08)] data-[state=active]:ring-1 data-[state=active]:ring-line",
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

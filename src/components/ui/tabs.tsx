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

export function TabsList({ items, className, variant = "pills" }: { items: { value: string; label: ReactNode; count?: number }[]; className?: string; variant?: "pills" | "underline" }) {
  if (variant === "underline") {
    // Underline navigation (section-level workspaces): a full-width hairline with an emerald bar under the active tab.
    return (
      <T.List className={cn("scrollbar-thin relative flex max-w-full gap-1 overflow-x-auto border-b border-line", className)} aria-label="Sections">
        {items.map((i) => (
          <T.Trigger
            key={i.value}
            value={i.value}
            className={cn(
              "group -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-ink-muted transition-colors duration-150",
              "hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40",
              "data-[state=active]:border-brand-600 data-[state=active]:font-medium data-[state=active]:text-ink",
            )}
          >
            {i.label}
            {i.count !== undefined && (
              <span className="figures rounded-full bg-bg px-1.5 text-[11px] font-semibold text-ink-soft ring-1 ring-inset ring-line group-data-[state=active]:bg-brand-600 group-data-[state=active]:text-white group-data-[state=active]:ring-brand-600">{i.count}</span>
            )}
          </T.Trigger>
        ))}
      </T.List>
    );
  }
  return (
    // Quiet grey rail; the active tab is a white chip with a hairline border.
    <T.List className={cn("scrollbar-thin flex max-w-full gap-1 relative overflow-x-auto rounded-xl bg-ink/[0.045] p-1 sm:w-fit", className)} aria-label="Sections">
      {items.map((i) => (
        <T.Trigger
          key={i.value}
          value={i.value}
          className={cn(
            "group inline-flex shrink-0 items-center gap-2 rounded-[9px] px-3 py-1.5 text-[13.5px] font-medium text-ink-muted transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
            "hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-card",
          )}
        >
          {i.label}
          {i.count !== undefined && (
            <span className="figures rounded-full bg-ink/[0.06] px-1.5 text-[11px] font-medium text-ink-soft group-data-[state=active]:bg-brand-100 group-data-[state=active]:text-brand-700">{i.count}</span>
          )}
        </T.Trigger>
      ))}
    </T.List>
  );
}

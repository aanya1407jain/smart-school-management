"use client";
import * as DM from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export const DropdownMenu = DM.Root;
export const DropdownTrigger = DM.Trigger;

export function DropdownContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={8}
        className={cn("glass-strong z-50 min-w-[200px] max-w-[calc(100vw-1rem)] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl p-1.5 data-[state=open]:animate-scale-in", className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function DropdownItem({ children, onSelect, className, tone }: { children: ReactNode; onSelect?: () => void; className?: string; tone?: "danger" }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        // Highlighted item: teal wash with a slim accent bar on the left.
        "relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2 text-sm outline-none transition-colors",
        "before:absolute before:left-0.5 before:top-1/2 before:h-0 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:transition-all data-[highlighted]:before:h-4",
        tone === "danger" ? "text-plum before:bg-plum data-[highlighted]:bg-blush/50" : "text-ink-soft before:bg-primary data-[highlighted]:bg-teal-soft/70 data-[highlighted]:text-lagoon",
        className,
      )}
    >
      {children}
    </DM.Item>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{children}</DM.Label>;
}

export function DropdownSeparator() {
  return <DM.Separator className="my-1 h-px bg-line/70" />;
}

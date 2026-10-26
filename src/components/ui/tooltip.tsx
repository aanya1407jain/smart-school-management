"use client";
import { useId, useState, type ReactElement, type ReactNode, cloneElement } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Small glass tooltip on hover and keyboard focus. The trigger gets
 * aria-describedby, so screen readers announce the tip with it; Escape hides it.
 */
export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactElement<Record<string, unknown>>; side?: "top" | "bottom"; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => { if (e.key === "Escape") hide(); }}>
      {cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "glass-strong spatial pointer-events-none absolute left-1/2 z-50 w-max max-w-[16rem] -translate-x-1/2 rounded-lg bg-white/95 px-2.5 py-1.5 text-left text-[12px] font-medium leading-snug text-ink-soft transition-all duration-150",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          open ? "visible translate-y-0 opacity-100" : cn("invisible opacity-0", side === "top" ? "translate-y-1" : "-translate-y-1"),
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}

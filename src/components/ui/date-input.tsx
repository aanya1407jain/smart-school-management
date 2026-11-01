"use client";
/**
 * Date field: the native <input type="date"> stays the source of truth (value,
 * onChange, react-hook-form ref, typing, min/max), styled as glass, and the
 * browser's calendar popup is replaced by a themed glass calendar.
 *
 * Picking a day writes the native input's value with the native setter and
 * dispatches a real `input` event, so every existing onChange handler and form
 * binding behaves exactly as if the user had typed the date.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
};

/** Utility classes that size/position the field (go on the wrapper, not the input). */
const LAYOUT = /^(-?m[trblxy]?-|w-|min-w-|max-w-|basis-|grow|shrink|flex-|self-|col-|row-|order-|(sm|md|lg|xl):(-?m[trblxy]?-|w-|min-w-|max-w-|basis-|flex-|col-))/;

export const DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function DateInput({ className, ...props }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  const reduceMotion = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [inDialog, setInDialog] = useState(false);
  const [focusDay, setFocusDay] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<string>("");

  const min = typeof props.min === "string" ? props.min : undefined;
  const max = typeof props.max === "string" ? props.max : undefined;
  const outOfRange = (d: Date) => (!!min && iso(d) < min) || (!!max && iso(d) > max);
  const locked = props.disabled || props.readOnly;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  const openPanel = () => {
    if (locked) return;
    const current = inputRef.current?.value ?? "";
    setSelected(current);
    setFocusDay(parse(current) ?? parse(max && iso(new Date()) > max ? max : min && iso(new Date()) < min ? min : null) ?? new Date());
    setAnchor(inputRef.current?.getBoundingClientRect() ?? null);
    setInDialog(!!inputRef.current?.closest('[role="dialog"]'));
    setOpen(true);
  };

  const choose = (d: Date | null) => {
    const el = inputRef.current;
    if (!el) return;
    if (d && outOfRange(d)) return;
    // Native setter + real input event: React's onChange (and any form library) sees a normal edit.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, d ? iso(d) : "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  // Focus the active day whenever it changes while open.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>(`[data-day="${iso(focusDay)}"]`)?.focus({ preventScroll: true });
  }, [open, focusDay]);

  // Outside pointer-down closes; a portalled panel closes on page scroll and re-anchors on resize.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    // Follow the field on page scroll; close once it has scrolled out of view.
    const onScroll = (e: Event) => {
      if (inDialog || panelRef.current?.contains(e.target as Node)) return;
      const r = inputRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close(false);
      else setAnchor(r);
    };
    const onResize = () => setAnchor(inputRef.current?.getBoundingClientRect() ?? null);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, inDialog, close]);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, e.shiftKey ? 12 : 1),
      Home: () => addDays(focusDay, -((focusDay.getDay() + 6) % 7)),
      End: () => addDays(focusDay, 6 - ((focusDay.getDay() + 6) % 7)),
    };
    if (step[e.key]) { e.preventDefault(); setFocusDay(step[e.key]()); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  const parts = (className ?? "").split(/\s+/).filter(Boolean);
  const wrapperClass = parts.filter((c) => LAYOUT.test(c)).join(" ");
  const inputClass = parts.filter((c) => !LAYOUT.test(c) || /^(w-|min-w-|max-w-)/.test(c)).filter((c) => !/^-?m[trblxy]?-/.test(c)).join(" ");

  // Month grid starting on Monday.
  const first = new Date(focusDay.getFullYear(), focusDay.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = iso(new Date());
  const portalled = !inDialog && !!anchor && typeof document !== "undefined";
  const below = !anchor || typeof window === "undefined" || window.innerHeight - anchor.bottom > 340 || anchor.top < 340;

  const panel = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label="Choose date"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: below ? -4 : 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
          transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.6 }}
          style={{
            transformOrigin: below ? "top left" : "bottom left",
            ...(portalled && anchor ? { left: Math.min(anchor.left, window.innerWidth - 296), ...(below ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }) } : {}),
          }}
          className={cn(
            "glass-strong w-[280px] rounded-2xl p-3",
            portalled ? "fixed z-[60]" : cn("absolute left-0 z-50", below ? "top-full mt-1.5" : "bottom-full mb-1.5"),
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setFocusDay(addMonths(focusDay, -1))} className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-all hover:bg-teal-soft hover:text-lagoon active:scale-90">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <p className="text-sm font-semibold text-sapphire" aria-live="polite">{MONTHS[focusDay.getMonth()]} <span className="figures">{focusDay.getFullYear()}</span></p>
            <button type="button" aria-label="Next month" onClick={() => setFocusDay(addMonths(focusDay, 1))} className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-all hover:bg-teal-soft hover:text-lagoon active:scale-90">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5" onKeyDown={onGridKey}>
            {WEEKDAYS.map((w) => <span key={w} className="pb-1 text-center text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">{w}</span>)}
            {days.map((d) => {
              const key = iso(d);
              const inMonth = d.getMonth() === focusDay.getMonth();
              const isSel = key === selected;
              const isFocus = key === iso(focusDay);
              const disabled = outOfRange(d);
              return (
                <button
                  key={key}
                  type="button"
                  data-day={key}
                  tabIndex={isFocus ? 0 : -1}
                  disabled={disabled}
                  aria-pressed={isSel}
                  aria-label={d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  aria-current={key === today ? "date" : undefined}
                  onClick={() => choose(d)}
                  className={cn(
                    "figures relative grid h-9 place-items-center rounded-lg text-[13px] transition-all duration-150 focus-visible:outline-none focus-visible:shadow-focus active:scale-90",
                    isSel
                      ? "bg-primary font-semibold text-white"
                      : inMonth ? "text-ink hover:bg-teal-soft hover:text-lagoon" : "text-ink-muted/50 hover:bg-alabaster",
                    disabled && "cursor-not-allowed opacity-35 hover:bg-transparent",
                    key === today && !isSel && "font-semibold text-lagoon ring-1 ring-inset ring-teal/40",
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2">
            <button type="button" onClick={() => choose(new Date())} disabled={outOfRange(new Date())} className="rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-lagoon transition-all hover:bg-teal-soft active:scale-95 disabled:opacity-40">Today</button>
            {!props.required && <button type="button" onClick={() => choose(null)} className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-ink-muted transition-all hover:bg-alabaster hover:text-ink active:scale-95">Clear</button>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={cn("relative w-full", wrapperClass)}>
      <input ref={inputRef} type="date" className={cn(inputClass, "pr-10 max-sm:pl-3 max-sm:pr-9 [&::-webkit-calendar-picker-indicator]:hidden")} {...props} />
      <button
        ref={buttonRef}
        type="button"
        tabIndex={locked ? -1 : 0}
        disabled={locked}
        aria-label="Open calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openPanel())}
        className={cn(
          "absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-muted transition-all duration-200 hover:bg-teal-soft hover:text-lagoon active:scale-90 focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-40",
          open && "bg-teal-soft text-lagoon",
        )}
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
      </button>
      {portalled ? createPortal(panel, document.body) : panel}
    </div>
  );
});

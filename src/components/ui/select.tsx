"use client";
/**
 * Select — a drop-in replacement for the native <select> with a themed,
 * animated glass flyout.
 *
 * Same API as before: `value` / `defaultValue`, `onChange(event)` with
 * `event.target.value`, `<option>` children, `disabled`, `name`, `required`,
 * `id` (FormField label), `aria-*`, and a forwarded ref — so react-hook-form's
 * `register()` and every existing handler keep working unchanged.
 *
 * How: a real <select> stays in the DOM (visually hidden, out of the tab order)
 * as the single source of truth for value, forms and refs. The visible
 * control is an ARIA combobox button + listbox. Choosing an option writes the
 * native select's value and dispatches a real `change` event, so React's
 * `onChange` (and register's) fire exactly as they did with the native control.
 *
 * Keyboard: ↑/↓/Enter/Space open; ↑/↓/Home/End move; Enter/Space choose;
 * Esc/Tab close; typing jumps to the first matching option.
 */
import {
  Children, forwardRef, isValidElement, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState,
  type KeyboardEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Option = { value: string; label: string; disabled: boolean };

/** Text content of an <option>'s children ("Class ", "10-A" → "Class 10-A"). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** Flatten <option> elements out of children (fragments, arrays and conditionals included). */
function optionsOf(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (el.type === "option") {
      const label = textOf(el.props.children);
      out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label, disabled: !!el.props.disabled });
    } else if (el.props?.children) {
      out.push(...optionsOf(el.props.children));
    }
  });
  return out;
}

/** Utility classes that position the control in its parent (go on the wrapper, not the trigger). */
const LAYOUT = /^(-?m[trblxy]?-|w-|min-w-|max-w-|basis-|grow|shrink|flex-|self-|col-|row-|order-|sm:|md:|lg:|xl:)/;
const splitClasses = (className?: string) => {
  const parts = (className ?? "").split(/\s+/).filter(Boolean);
  return { wrapper: parts.filter((c) => LAYOUT.test(c)).join(" "), trigger: parts.filter((c) => !/^-?m[trblxy]?-/.test(c) && !/^(sm|md|lg|xl):-?m/.test(c)).join(" ") };
};

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    className, invalid, children, value, defaultValue, onChange, onBlur, disabled, id, name, required, style,
    "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-describedby": ariaDescribedBy, "aria-required": ariaRequired,
    multiple: _multiple, size: _size, form: _form, autoComplete: _autoComplete, ...rest // remaining props (data-*, title, onFocus …) go to the trigger
  },
  ref,
) {
  const nativeRef = useRef<HTMLSelectElement>(null);
  useImperativeHandle(ref, () => nativeRef.current as HTMLSelectElement);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;
  const reduceMotion = useReducedMotion();

  const options = useMemo(() => optionsOf(children), [children]);
  // Current value: controlled `value`, else the native select's own value (uncontrolled / react-hook-form).
  const [nativeValue, setNativeValue] = useState<string>(defaultValue !== undefined ? String(defaultValue) : "");
  const current = value !== undefined && value !== null ? String(value) : nativeValue;
  useEffect(() => { if (nativeRef.current && value === undefined) setNativeValue(nativeRef.current.value); }, [value, options]);
  const selected = options.find((o) => o.value === current) ?? (value === undefined ? options[0] : undefined);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const [maxH, setMaxH] = useState(288);
  // Where the menu renders: a portal on <body> (escapes glass cards' stacking contexts and overflow),
  // except inside a dialog, where it stays inline so the dialog does not treat clicks on it as "outside".
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [inDialog, setInDialog] = useState(false);
  const typeahead = useRef({ text: "", at: 0 });

  const openMenu = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect() ?? null;
    // Open toward the roomier side and never past the viewport edge (the list scrolls instead).
    const below = rect ? window.innerHeight - rect.bottom - 14 : 288;
    const above = rect ? rect.top - 14 : 0;
    const up = below < 200 && above > below;
    setDropUp(up);
    setMaxH(Math.min(288, Math.max(120, up ? above : below)));
    setAnchor(rect);
    setInDialog(!!triggerRef.current?.closest('[role="dialog"]'));
    const i = options.findIndex((o) => o.value === selected?.value);
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }, [disabled, options, selected]);
  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) triggerRef.current?.focus(); }, []);

  /** Write the native select and fire a real `change` event (React onChange / register see a normal event). */
  const choose = (o: Option) => {
    if (o.disabled) return;
    const el = nativeRef.current;
    if (el && el.value !== o.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(el, o.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (value === undefined) setNativeValue(o.value);
    close();
  };

  // Close on outside pointer-down.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  // A portalled menu follows its trigger on page scroll/resize (not when scrolling the menu itself),
  // and closes once the trigger has scrolled out of view.
  useEffect(() => {
    if (!open || inDialog) return;
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close(false);
      else setAnchor(r);
    };
    const onResize = () => setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onResize); };
  }, [open, inDialog, close]);

  // Keep the active option in view.
  useEffect(() => {
    if (open && active >= 0) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i;
    return from;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setActive((a) => move(a, 1)); break;
      case "ArrowUp": e.preventDefault(); setActive((a) => move(a, -1)); break;
      case "Home": e.preventDefault(); setActive(move(-1, 1)); break;
      case "End": e.preventDefault(); setActive(move(options.length, -1)); break;
      case "Enter": case " ": e.preventDefault(); if (options[active]) choose(options[active]); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": close(false); break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const now = Date.now();
          typeahead.current = { text: (now - typeahead.current.at < 600 ? typeahead.current.text : "") + e.key.toLowerCase(), at: now };
          const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typeahead.current.text));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  const classes = splitClasses(className);
  const portalled = !inDialog && !!anchor && typeof document !== "undefined";
  const menu = renderMenu(portalled);
  return (
    <div className={cn("relative", classes.wrapper)} style={style}>
      {/* Source of truth for value / forms / refs (react-hook-form). Hidden from users and assistive tech. */}
      <select
        ref={nativeRef}
        tabIndex={-1}
        aria-hidden
        name={name}
        required={required}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => { setNativeValue(e.target.value); onChange?.(e); }}
        onBlur={onBlur}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      >
        {children}
      </select>
      <button
        {...(rest as Record<string, unknown>)}
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          "group relative flex h-10 max-sm:h-11 w-full items-center gap-2 rounded-xl border bg-white pl-3.5 pr-9 text-left text-sm max-sm:text-base text-ink",
          "shadow-[0_1px_2px_rgb(6_49_84_/_0.04)] transition-[border-color,box-shadow,background-color] duration-200",
          "hover:border-teal/40 hover:bg-white focus:outline-none focus-visible:border-teal focus-visible:shadow-focus",
          open && "border-teal/60 bg-white shadow-focus",
          invalid ? "border-plum/60" : "border-line",
          "disabled:cursor-not-allowed disabled:bg-alabaster disabled:text-ink-muted",
          classes.trigger.replace(/\bw-\S+/g, ""),
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-ink-muted/70")}>{selected?.label || " "}</span>
        <ChevronDown aria-hidden className={cn("pointer-events-none absolute right-3 h-4 w-4 text-ink-muted transition-transform duration-200", open && "rotate-180 text-teal")} />
      </button>

      {portalled ? createPortal(menu, document.body) : menu}
    </div>
  );

  function renderMenu(fixed: boolean) {
    return (
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={triggerId}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: dropUp ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: dropUp ? 2 : -2, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.6 }}
            style={{
              transformOrigin: dropUp ? "bottom center" : "top center",
              maxHeight: maxH,
              ...(fixed && anchor ? { left: anchor.left, minWidth: anchor.width, ...(dropUp ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }) } : {}),
            }}
            className={cn(
              "glass-strong scrollbar-thin max-h-72 overflow-auto rounded-xl p-1.5",
              fixed ? "fixed z-[60]" : cn("absolute left-0 z-50 min-w-full", dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"),
            )}
          >
            {options.map((o, i) => {
              const isSelected = o.value === selected?.value;
              const isActive = i === active;
              return (
                <li
                  key={`${o.value}-${i}`}
                  id={`${listId}-${i}`}
                  data-index={i}
                  data-value={o.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => !o.disabled && setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 max-sm:py-2.5 pl-3 pr-8 text-sm max-sm:text-base transition-colors duration-150",
                    isActive && !o.disabled && "bg-teal-soft/70 text-ink",
                    isSelected ? "font-semibold text-lagoon" : "text-ink-soft",
                    o.disabled && "cursor-not-allowed opacity-45",
                  )}
                >
                  <span className="truncate">{o.label || " "}</span>
                  {isSelected && <Check aria-hidden className="absolute right-2.5 h-4 w-4 text-teal" />}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    );
  }
});

"use client";
/**
 * The dashboard's front door: one evergreen panel that says "type what you
 * need". Clicking it (or a chip) opens Ask Atrium, pre-filled. The placeholder
 * types out real requests for the user's role, and the floating module tiles
 * on the right take turns playing their icon motion so the panel feels awake.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { AppIcon, IconTile, type AppIconName } from "@/components/icons/app-icon";
import { ask, suggestions } from "@/lib/ask/intents";
import { cn } from "@/lib/utils/cn";
import { useAsk, useAskScope } from "./ask-provider";

function useTypewriter(lines: string[], enabled: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!enabled || lines.length === 0) { setText(lines[0] ?? ""); return; }
    let line = 0, i = 0, del = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = lines[line];
      if (!del) {
        i++;
        setText(full.slice(0, i));
        if (i === full.length) { del = true; t = setTimeout(tick, 1700); return; }
        t = setTimeout(tick, 55);
      } else {
        i = Math.max(0, i - 2);
        setText(full.slice(0, i));
        if (i === 0) { del = false; line = (line + 1) % lines.length; t = setTimeout(tick, 280); return; }
        t = setTimeout(tick, 20);
      }
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [lines, enabled]);
  return text;
}

/** Cycles 0..n-1 every `ms` (static under reduced motion). */
function useTurn(n: number, ms: number, enabled: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!enabled || n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, enabled]);
  return i;
}

const FLOAT: { pos: string; delay: string }[] = [
  { pos: "right-[300px] top-[44px] rotate-[-6deg]", delay: "0s" },
  { pos: "right-[196px] top-[100px] rotate-[4deg]", delay: "-1.2s" },
  { pos: "right-[92px] top-[36px] rotate-[8deg]", delay: "-2.4s" },
  { pos: "right-[262px] top-[196px] rotate-[3deg]", delay: "-3.1s" },
  { pos: "right-[56px] top-[168px] rotate-[-5deg]", delay: "-0.6s" },
];

export function AskHero({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  const { open } = useAsk();
  const { user, items, canSearchStudents } = useAskScope();
  const reduce = useReducedMotion();
  const chips = useMemo(() => (user ? suggestions(user.role, items) : []), [user, items]);
  const chipIcons = useMemo(
    () => chips.map((c) => ask(c, items, { canSearchStudents })[0]?.icon ?? "spark") as AppIconName[],
    [chips, items, canSearchStudents],
  );
  const lines = useMemo(() => chips.map((c) => c.toLowerCase()), [chips]);
  const typed = useTypewriter(lines, !reduce);
  const tiles = useMemo(() => {
    const own = items.map((i) => i.icon).filter((n) => n !== "dashboard" && n !== "profile" && n !== "notifications" && n !== "settings");
    return [...new Set(own)].slice(0, 5) as AppIconName[];
  }, [items]);
  const turn = useTurn(tiles.length, 1500, !reduce);

  return (
    <section aria-label="Ask Atrium" className="relative isolate overflow-hidden rounded-[26px] bg-brand-700 px-5 pb-5 pt-6 text-white sm:px-7 sm:pb-6 sm:pt-7 xl:min-h-[272px]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:20px_20px]" />
      {/* Floating module tiles (decorative): each takes a turn playing its motion. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[400px] xl:block">
        {tiles.map((name, k) => (
          <span key={name} className={cn("float-y absolute rounded-2xl bg-white p-2 shadow-[0_14px_30px_-12px_rgb(0_0_0/0.45)]", FLOAT[k]?.pos)} style={{ animationDelay: FLOAT[k]?.delay }}>
            <IconTile key={k === turn ? `${name}-on-${turn}` : name} name={name} size="lg" live={k === turn} />
          </span>
        ))}
      </div>

      <div className="relative min-w-0 xl:max-w-[calc(100%-400px)]">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.035em] sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-white/65">{subtitle}</p>}
      </div>

      <button
        type="button"
        onClick={() => open()}
        className="group relative mt-5 flex h-14 w-full items-center gap-3 rounded-2xl bg-white px-3 text-left text-ink shadow-[0_16px_40px_-14px_rgb(0_0_0/0.5)] transition-transform duration-150 active:scale-[.995] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marigold/60 xl:max-w-[calc(100%-400px)]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-marigold">
          <AppIcon name="spark" className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15.5px] text-ink-muted">
          {typed}
          <span aria-hidden className="ml-px inline-block h-[18px] w-[2px] translate-y-[3px] animate-[caret_1s_steps(1)_infinite] bg-brand-600 motion-reduce:hidden" />
        </span>
        <span className="kbd hidden sm:inline-flex">⌘K</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white transition-transform duration-150 group-hover:translate-x-0.5">
          <CornerDownLeft className="h-4 w-4" aria-hidden />
        </span>
      </button>

      {chips.length > 0 && (
        <div className="scrollbar-none relative -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0 xl:max-w-[calc(100%-380px)]">
          {chips.map((c, k) => (
            <button
              key={c}
              type="button"
              onClick={() => open(c)}
              className="group flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.1] py-1 pl-1 pr-3 text-[12.5px] font-medium text-white/90 ring-1 ring-inset ring-white/15 transition-colors duration-150 hover:bg-white/[0.18] hover:text-white"
            >
              <IconTile name={chipIcons[k]} size="xs" className="rounded-full" />
              {c}
            </button>
          ))}
        </div>
      )}

      {actions && <div className="relative mt-5 hidden flex-wrap gap-2 border-t border-white/10 pt-4 sm:flex">{actions}</div>}
    </section>
  );
}

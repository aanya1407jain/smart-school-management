"use client";
/** Small shared pieces for the landing page. All data shown is illustrative (demo school: Aster Academy). */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

/** Cycles through `lines`, typing each one out. Returns the typed text and the index of the current line. */
export function useTyping(lines: string[], { typeMs = 55, holdMs = 1700 } = {}) {
  const reduce = useReducedMotion();
  const [state, setState] = useState({ text: reduce ? lines[0] : "", index: 0 });
  useEffect(() => {
    if (reduce) { setState({ text: lines[0], index: 0 }); return; }
    let line = 0, i = 0, del = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = lines[line];
      if (!del) {
        i++;
        setState({ text: full.slice(0, i), index: line });
        if (i >= full.length) { del = true; t = setTimeout(tick, holdMs); return; }
        t = setTimeout(tick, typeMs);
      } else {
        i = Math.max(0, i - 2);
        setState({ text: full.slice(0, i), index: line });
        if (i === 0) { del = false; line = (line + 1) % lines.length; t = setTimeout(tick, 250); return; }
        t = setTimeout(tick, 18);
      }
    };
    t = setTimeout(tick, 700);
    return () => clearTimeout(t);
  }, [lines, reduce, typeMs, holdMs]);
  return state;
}

/** True once the element has scrolled into view (for one-time entrances). */
export function useInView<T extends HTMLElement>(margin = "-80px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return { ref, seen };
}

/** Section wrapper that rises in when scrolled into view. */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={cn("transition-[opacity,transform] duration-700 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none", seen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0", className)}>
      {children}
    </div>
  );
}

export function Caret({ className }: { className?: string }) {
  return <span aria-hidden className={cn("ml-px inline-block h-[1em] w-[2px] translate-y-[2px] animate-[caret_1s_steps(1)_infinite] bg-current align-baseline motion-reduce:hidden", className)} />;
}

/** Live local clock (for the footer status row). */
export function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const f = () => setNow(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="figures">{now || "--:--:--"}</span>;
}

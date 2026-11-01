import type { ReactNode } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Metric card: frosted glass with a hairline teal→cyan gradient border,
 * a gentle lift + icon glow on hover, and tabular figures that fade/slide in
 * (no count-up: the rendered value is always the real value).
 */
export function StatCard({
  label, value, hint, icon, tone = "teal", delta, href,
}: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: "teal" | "sapphire" | "purple" | "lavender"; delta?: number | null; href?: string }) {
  const iconTone = {
    teal: "bg-gradient-to-br from-teal-soft to-cyan/15 text-lagoon ring-teal/20",
    sapphire: "bg-gradient-to-br from-sapphire/[0.06] to-cyan/10 text-sapphire ring-sapphire/15",
    purple: "bg-gradient-to-br from-lavender/30 to-blush/40 text-plum ring-mauve/25",
    lavender: "bg-gradient-to-br from-blush/60 to-lavender/25 text-plum ring-mauve/25",
  }[tone];
  // Coloured ambient glow behind the icon (always on, brighter on hover).
  const glow = {
    teal: "from-teal/35 to-cyan/25",
    sapphire: "from-sapphire/25 to-cyan/20",
    purple: "from-purple/30 to-lavender/30",
    lavender: "from-mauve/30 to-blush/40",
  }[tone];
  const body = (
    <div
      className={cn(
        "gradient-border spatial group relative h-full overflow-hidden rounded-2xl p-5 backdrop-blur-md",
        "transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-ambient-lg",
      )}
    >
      {/* Soft accent wash in the corner, brighter on hover. */}
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gradient-to-br from-cyan/15 to-teal/5 opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-muted">{label}</p>
          <p className="figures mt-2 animate-fade-up text-[30px] font-bold leading-none tracking-tight text-sapphire">{value}</p>
        </div>
        <div className="relative shrink-0">
          <div aria-hidden className={cn("absolute -inset-2 rounded-3xl bg-gradient-to-br opacity-70 blur-lg transition-opacity duration-300 group-hover:opacity-100", glow)} />
          <div className={cn("relative grid h-11 w-11 place-items-center rounded-2xl bg-white/70 ring-1 ring-inset transition-[box-shadow,transform] duration-300 group-hover:scale-105 group-hover:shadow-glow", iconTone)}>{icon}</div>
        </div>
      </div>
      {(hint || delta !== undefined) && (
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
          {delta !== undefined && delta !== null && (
            <span className={cn("figures inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", delta >= 0 ? "bg-teal-soft text-lagoon" : "bg-blush/50 text-plum")}>
              {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(delta).toFixed(1)} pts
            </span>
          )}
          {hint}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus">{body}</Link> : body;
}

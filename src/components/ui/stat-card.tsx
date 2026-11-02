import type { ReactNode } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Metric card: a flat white surface with a hairline border, a softly tinted
 * icon tile and tabular figures that fade in (no count-up: the rendered value
 * is always the real value).
 */
export function StatCard({
  label, value, hint, icon, tone = "teal", delta, href,
}: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: "teal" | "sapphire" | "purple" | "lavender"; delta?: number | null; href?: string }) {
  const iconTone = {
    teal: "bg-teal-soft text-lagoon",
    sapphire: "bg-sapphire/[0.06] text-sapphire",
    purple: "bg-lavender/20 text-plum",
    lavender: "bg-blush/40 text-plum",
  }[tone];
  const body = (
    <div className={cn("relative h-full rounded-2xl border border-line bg-surface p-5 shadow-ambient", href && "transition-colors duration-150 hover:border-ink-muted/30")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-muted">{label}</p>
          <p className="figures mt-2 animate-fade-up break-words text-[26px] font-semibold leading-tight tracking-tight text-ink">{value}</p>
        </div>
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", iconTone)}>{icon}</div>
      </div>
      {(hint || delta !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
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

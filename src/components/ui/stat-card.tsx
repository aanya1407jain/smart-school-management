import type { ReactNode } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { GlassCard } from "./card";

export function StatCard({
  label, value, hint, icon, tone = "teal", delta, href,
}: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: "teal" | "sapphire" | "purple" | "lavender"; delta?: number | null; href?: string }) {
  const iconTone = {
    teal: "bg-teal-soft text-lagoon",
    sapphire: "bg-sapphire/[0.08] text-sapphire",
    purple: "bg-lavender/30 text-plum",
    lavender: "bg-blush/60 text-plum",
  }[tone];
  const body = (
    <GlassCard hover={!!href} className="relative h-full overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-muted">{label}</p>
          <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-sapphire">{value}</p>
        </div>
        <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", iconTone)}>{icon}</div>
      </div>
      {(hint || delta !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
          {delta !== undefined && delta !== null && (
            <span className={cn("inline-flex items-center gap-0.5 font-semibold", delta >= 0 ? "text-lagoon" : "text-plum")}>
              {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(delta).toFixed(1)} pts
            </span>
          )}
          {hint}
        </div>
      )}
    </GlassCard>
  );
  return href ? <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:shadow-focus">{body}</Link> : body;
}

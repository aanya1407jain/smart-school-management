import type { ReactNode } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { IconTile, type AppIconName } from "@/components/icons/app-icon";
import { liveIconFor } from "@/components/icons/from-lucide";

/**
 * Metric card: a flat white surface with a hairline border, a softly tinted
 * icon tile and tabular figures that fade in (no count-up: the rendered value
 * is always the real value).
 */
export function StatCard({
  label, value, hint, icon, tone = "teal", delta, href, accent,
}: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: "teal" | "sapphire" | "purple" | "lavender"; delta?: number | null; href?: string; accent?: AppIconName }) {
  const iconTone = {
    teal: "bg-brand-100 text-brand-700",
    sapphire: "bg-[#E5EDFF] text-[#2563EB]",
    purple: "bg-[#FFF0D3] text-[#B26A00]",
    lavender: "bg-[#EEE9FF] text-[#6D4AE0]",
  }[tone];
  const body = (
    <div className={cn("group relative h-full rounded-[22px] bg-surface p-4 shadow-card sm:p-5", href && "lift")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-muted">{label}</p>
          <p className="figures mt-2 animate-fade-up break-words text-[24px] font-semibold leading-tight tracking-[-0.04em] text-ink sm:text-[30px]">{value}</p>
        </div>
        {(accent ?? liveIconFor(icon)) ? <IconTile name={(accent ?? liveIconFor(icon))!} size="md" /> : <div className={cn("icon-anim grid h-9 w-9 shrink-0 place-items-center rounded-[11px] [&_svg]:h-[18px] [&_svg]:w-[18px]", iconTone)}>{icon}</div>}
      </div>
      {(hint || delta !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
          {delta !== undefined && delta !== null && (
            <span className={cn("figures inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", delta >= 0 ? "bg-pd-ok-soft text-pd-ok" : "bg-blush text-plum")}>
              {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(delta).toFixed(1)} pts
            </span>
          )}
          {hint}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="group block rounded-[22px] focus-visible:outline-none focus-visible:shadow-focus">{body}</Link> : body;
}

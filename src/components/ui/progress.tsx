import { cn } from "@/lib/utils/cn";
import { PALETTE } from "@/lib/constants/theme";

export function ProgressBar({ value, className, tone = "teal", label }: { value: number; className?: string; tone?: "teal" | "purple" | "sapphire" | "plum"; label?: string }) {
  const color = { teal: "bg-teal", purple: "bg-purple", sapphire: "bg-sapphire", plum: "bg-plum" }[tone];
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-heather/30", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Circular gauge for percentages (attendance, collection rate). */
export function ProgressRing({ value, size = 96, stroke = 9, label, sublabel, tone = "teal" }: { value: number | null; size?: number; stroke?: number; label?: string; sublabel?: string; tone?: "teal" | "purple" | "plum" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = { teal: PALETTE.teal, purple: PALETTE.purple, plum: PALETTE.plum }[tone];
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={PALETTE.heather} strokeOpacity={0.35} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (v / 100) * c} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="absolute text-center">
        <div className="text-lg font-semibold text-sapphire">{label ?? (value === null ? "—" : `${Math.round(v)}%`)}</div>
        {sublabel && <div className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">{sublabel}</div>}
      </div>
    </div>
  );
}

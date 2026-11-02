"use client";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import { PALETTE } from "@/lib/constants/theme";

type ProgressTone = "teal" | "purple" | "sapphire" | "plum";

const BAR_FILL: Record<ProgressTone, string> = {
  teal: "bg-primary",
  purple: "bg-purple",
  sapphire: "bg-sapphire",
  plum: "bg-plum",
};

/** Glass track with a gradient fill that animates to its value (and a soft sheen). */
export function ProgressBar({ value, className, tone = "teal", label }: { value: number; className?: string; tone?: ProgressTone; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-line/70", className)}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn("relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]", BAR_FILL[tone])} style={{ width: `${v}%` }}>
      </div>
    </div>
  );
}

const RING: Record<"teal" | "purple" | "plum", [string, string]> = {
  teal: [PALETTE.cyan, PALETTE.teal],
  purple: [PALETTE.mauve, PALETTE.purple],
  plum: [PALETTE.purple, PALETTE.plum],
};

/** Circular gauge for percentages (attendance, collection rate, exam scores). */
export function ProgressRing({ value, size = 96, stroke = 9, label, sublabel, tone = "teal" }: { value: number | null; size?: number; stroke?: number; label?: string; sublabel?: string; tone?: "teal" | "purple" | "plum" }) {
  const gid = `ring-${useId().replace(/:/g, "")}`;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const [from, to] = RING[tone];
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={PALETTE.heather} strokeOpacity={0.3} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)", filter: `drop-shadow(0 0 4px ${to}55)` }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="figures text-lg font-semibold text-sapphire">{label ?? (value === null ? "—" : `${Math.round(v)}%`)}</div>
        {sublabel && <div className="text-[10.5px] font-medium uppercase tracking-wide text-ink-muted">{sublabel}</div>}
      </div>
    </div>
  );
}

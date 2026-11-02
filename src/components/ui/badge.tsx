import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type Tone = "teal" | "sapphire" | "lavender" | "plum" | "neutral" | "blush" | "outline";

const tones: Record<Tone, string> = {
  teal: "bg-teal-soft text-lagoon ring-teal/20",
  sapphire: "bg-sapphire/[0.07] text-sapphire ring-sapphire/15",
  lavender: "bg-lavender/25 text-plum ring-mauve/30",
  plum: "bg-blush/70 text-plum ring-purple/25",
  blush: "bg-blush/50 text-plum ring-blush",
  neutral: "bg-heather/25 text-ink-soft ring-heather/40",
  outline: "bg-white/60 text-ink-soft ring-line",
};

/**
 * Monospace pill for identifiers: scholar numbers, roll numbers, serials,
 * codes. Teal by default; `tone="neutral"` / `"sapphire"` for secondary ids.
 */
export function BadgeChip({ children, tone = "teal", className, title }: { children: ReactNode; tone?: "teal" | "neutral" | "sapphire"; className?: string; title?: string }) {
  const tones = {
    teal: "bg-teal-soft/80 text-lagoon border-teal/25",
    neutral: "bg-alabaster text-ink-soft border-line",
    sapphire: "bg-sapphire/[0.05] text-sapphire border-sapphire/15",
  };
  return (
    <span title={title} className={cn("figures inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-semibold leading-none", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Badge({ tone = "neutral", children, className, dot, pulse }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset", tones[tone], className)}>
      {dot && (
        <span className="relative grid h-1.5 w-1.5 place-items-center" aria-hidden>
          {pulse && <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-current opacity-50 motion-reduce:hidden" />}
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

const ALERT_TINT = { teal: "var(--c-teal)", plum: "var(--c-plum)", lavender: "var(--c-purple)", sapphire: "var(--c-sapphire)" } as const;

/**
 * Action banner as a refined status pill: tinted glass border, icon, message
 * and an arrow that slides on hover. Renders a link when `href` is given.
 */
export function AlertPill({ href, icon, children, tone = "teal", className }: { href?: string; icon?: ReactNode; children: ReactNode; tone?: keyof typeof ALERT_TINT; className?: string }) {
  const cls = cn(
    "tint-glass group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-ink-soft transition-colors duration-150",
    href && "hover:bg-[rgb(var(--tint)/0.11)] focus-visible:outline-none focus-visible:shadow-focus",
    className,
  );
  const body = (
    <>
      {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white ring-1 ring-inset ring-[rgb(var(--tint)/0.25)] [color:rgb(var(--tint))]">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
      {href && <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink" aria-hidden />}
    </>
  );
  const style = { ["--tint" as string]: ALERT_TINT[tone] };
  return href ? <Link href={href} className={cls} style={style}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}

/**
 * One mapping from domain status → label + tone, used everywhere so the same
 * status always looks the same.
 */
const STATUS: Record<string, { label: string; tone: Tone }> = {
  // students / staff
  active: { label: "Active", tone: "teal" },
  inactive: { label: "Inactive", tone: "neutral" },
  transferred: { label: "Transferred", tone: "lavender" },
  alumni: { label: "Alumni", tone: "sapphire" },
  on_leave: { label: "On leave", tone: "lavender" },
  // attendance
  present: { label: "Present", tone: "teal" },
  absent: { label: "Absent", tone: "plum" },
  late: { label: "Late", tone: "lavender" },
  // fees
  paid: { label: "Paid", tone: "teal" },
  clear: { label: "Up to date", tone: "teal" },
  due_soon: { label: "Due soon", tone: "lavender" },
  due: { label: "Due", tone: "lavender" },
  partial: { label: "Part paid", tone: "lavender" },
  overdue: { label: "Overdue", tone: "plum" },
  upcoming: { label: "Upcoming", tone: "neutral" },
  not_assigned: { label: "Not assigned", tone: "neutral" },
  // exams
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "sapphire" },
  in_progress: { label: "In progress", tone: "lavender" },
  marks_entry: { label: "Marks entry", tone: "lavender" },
  published: { label: "Published", tone: "teal" },
  // homework
  pending: { label: "Pending", tone: "lavender" },
  submitted: { label: "Submitted", tone: "teal" },
  reviewed: { label: "Reviewed", tone: "sapphire" },
  closed: { label: "Closed", tone: "neutral" },
  // leave
  approved: { label: "Approved", tone: "teal" },
  rejected: { label: "Rejected", tone: "plum" },
  archived: { label: "Archived", tone: "neutral" },
  // priority
  urgent: { label: "Urgent", tone: "plum" },
  high: { label: "High", tone: "lavender" },
  normal: { label: "Normal", tone: "sapphire" },
  low: { label: "Low", tone: "neutral" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone} dot pulse={status === "overdue" || status === "urgent"} className={className}>{label ?? s.label}</Badge>;
}

import type { ReactNode } from "react";
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

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
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
  return <Badge tone={s.tone} dot className={className}>{label ?? s.label}</Badge>;
}

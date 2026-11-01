import { CalendarDays, Megaphone, PartyPopper, Sun } from "lucide-react";
import type { Notice } from "@/types/core";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { formatDate, formatShortDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { NOTICE_TYPE_LABELS } from "@/lib/constants/labels";

type NoticeView = Notice & { audienceLabel: string; author?: string };

const TYPE_ICON = { notice: Megaphone, event: PartyPopper, holiday: Sun } as const;

export function NoticeListItem({ notice, compact, onClick, actions, className }: { notice: NoticeView; compact?: boolean; onClick?: () => void; actions?: React.ReactNode; className?: string }) {
  const Icon = TYPE_ICON[notice.type];
  const content = (
    <div className="flex min-w-0 flex-1 items-start gap-3.5">
      <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", notice.type === "holiday" ? "bg-blush/60 text-plum" : notice.type === "event" ? "bg-lavender/30 text-plum" : "bg-teal-soft text-lagoon")}>
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">{notice.title}</p>
          {(notice.priority === "urgent" || notice.priority === "high") && <StatusBadge status={notice.priority} />}
          {notice.status !== "published" && <StatusBadge status={notice.status} />}
        </div>
        {!compact && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-soft">{notice.body}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
          <span>{NOTICE_TYPE_LABELS[notice.type]}</span>
          <span aria-hidden>·</span>
          <Badge tone="outline" className="py-0">{notice.audienceLabel}</Badge>
          {notice.eventDate && (
            <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDate(notice.eventDate)}{notice.endDate && notice.endDate !== notice.eventDate ? ` – ${formatDate(notice.endDate)}` : ""}</span>
          )}
          <span className="ml-auto">
            Posted {formatShortDate(notice.publishDate)}
            {notice.author ? ` · ${notice.author}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
  return (
    <li className={cn("flex items-start gap-2", compact ? "py-3.5" : "", className)}>
      {onClick ? <button onClick={onClick} className="flex min-w-0 flex-1 rounded-xl text-left">{content}</button> : content}
      {actions}
    </li>
  );
}

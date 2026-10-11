import { Bell, BookOpenCheck, CalendarCheck2, ClipboardList, Megaphone, Wallet } from "lucide-react";
import type { NotificationCategory } from "@/types/domain";
import { cn } from "@/lib/utils/cn";

const MAP: Record<NotificationCategory, { Icon: typeof Bell; cls: string }> = {
  attendance: { Icon: CalendarCheck2, cls: "bg-teal-soft text-lagoon" },
  fees: { Icon: Wallet, cls: "bg-sapphire/[0.08] text-sapphire" },
  homework: { Icon: ClipboardList, cls: "bg-lavender/30 text-plum" },
  examination: { Icon: BookOpenCheck, cls: "bg-blush/60 text-plum" },
  notice: { Icon: Megaphone, cls: "bg-teal-soft text-lagoon" },
  general: { Icon: Bell, cls: "bg-heather/30 text-sapphire" },
};

export function CategoryIcon({ category, className }: { category: NotificationCategory; className?: string }) {
  const { Icon, cls } = MAP[category];
  return (
    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", cls, className)} aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

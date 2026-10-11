"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, ChevronRight, Trash2 } from "lucide-react";
import type { NotificationCategory } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Button, Card, EmptyState, PageHeader, QueryView, Segmented, useToast } from "@/components/ui";
import { NOTIFICATION_CATEGORY_LABELS } from "@/lib/constants/labels";
import { relativeTime, formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { CategoryIcon } from "./category-icon";
import { useUnreadCount } from "./use-unread-count";

export function NotificationCenter() {
  const router = useRouter();
  const { toast } = useToast();
  const unread = useUnreadCount();
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [onlyUnread, setOnlyUnread] = useState<"all" | "unread">("all");
  const q = useQuery(() => services.notifications.list({ category, unreadOnly: onlyUnread === "unread" }), [category, onlyUnread]);
  const cats: (NotificationCategory | "all")[] = ["all", "attendance", "fees", "homework", "examination", "notice", "general"];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Notifications"
        description={unread ? `You have ${unread} unread notification${unread > 1 ? "s" : ""}.` : "You're all caught up."}
        actions={unread > 0 && <Button variant="outline" onClick={async () => { const r = await services.notifications.markAllRead(); toast({ title: `${r.count} marked as read` }); }}><CheckCheck className="h-4 w-4" /> Mark all as read</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Category">
          {cats.map((c) => (
            <button key={c} role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
              className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors", category === c ? "bg-sapphire text-white" : "bg-white/70 text-ink-muted ring-1 ring-line hover:text-ink")}>
              {c === "all" ? "All" : NOTIFICATION_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <Segmented label="Show" size="sm" value={onlyUnread} onChange={setOnlyUnread} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />
      </div>
      <QueryView query={q} loading="table">
        {(items) => items.length === 0 ? <Card><EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Updates about attendance, fees, homework, exams and notices will appear here." /></Card> : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/60">
              <AnimatePresence initial={false}>
                {items.map((n) => (
                  <motion.li key={n.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className={cn("group flex items-start gap-3 px-4 py-3.5 sm:px-5", !n.read && "bg-teal-soft/30")}>
                    <CategoryIcon category={n.category} className="mt-0.5" />
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={async () => { if (!n.read) await services.notifications.markRead(n.id); if (n.href) router.push(n.href); }}
                    >
                      <div className="flex items-center gap-2">
                        <p className={cn("text-sm", n.read ? "font-medium text-ink-soft" : "font-semibold text-ink")}>{n.title}</p>
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-teal" aria-label="Unread" />}
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-muted">{n.message}</p>
                      <p className="mt-1 text-[11.5px] text-ink-muted" title={formatDateTime(n.createdAt)}>{NOTIFICATION_CATEGORY_LABELS[n.category]} · {relativeTime(n.createdAt)}</p>
                    </button>
                    <div className="flex items-center gap-1">
                      {n.href && <ChevronRight className="hidden h-4 w-4 text-ink-muted sm:block" aria-hidden />}
                      <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" aria-label="Delete notification" onClick={() => services.notifications.remove(n.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        )}
      </QueryView>
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, CheckCheck, ChevronRight, Trash2 } from "lucide-react";
import type { NotificationCategory } from "@/types/core";
import { requireDemo } from "@/lib/demo/runtime";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSession } from "@/features/auth/session-provider";
import { Badge, Button, Card, ConfirmDialog, EmptyState, FilterPills, PageHeader, QueryView, Segmented, useToast } from "@/components/ui";
import { NOTIFICATION_CATEGORY_LABELS } from "@/lib/constants/labels";
import { relativeTime, formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { isLiveRoute } from "@/lib/permissions/navigation";
import { CategoryIcon } from "./category-icon";
import { useUnreadCount } from "./use-unread-count";

const LIVE_CATEGORY_MAP: Record<string, NotificationCategory> = {
  attendance: "attendance",
  fees: "fees",
  homework: "homework",
  examination: "examination",
  exam: "examination",
  notice: "notice",
  general: "general",
  account: "general",
};

export function NotificationCenter() {
  const router = useRouter();
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const unread = useUnreadCount();
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [onlyUnread, setOnlyUnread] = useState<"all" | "unread">("all");

  // Real Convex queries & mutations
  const rawLiveList = useSchoolQuery(api.notifications.list, live ? { limit: 100 } : "skip");
  const markReadMutation = useSchoolMutation(api.notifications.markRead);
  const markAllReadMutation = useSchoolMutation(api.notifications.markAllRead);
  const removeMutation = useSchoolMutation(api.notifications.remove);
  const clearAllMutation = useSchoolMutation(api.notifications.clearAll);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Demo fallback queries
  const allItemsQuery = useQuery(() => (live ? Promise.resolve([]) : requireDemo().notifications.list({})), [live]);
  const q = useQuery(
    () => (live ? Promise.resolve([]) : requireDemo().notifications.list({ category, unreadOnly: onlyUnread === "unread" })),
    [live, category, onlyUnread]
  );

  const liveItems = useMemo(() => {
    if (!rawLiveList) return undefined;
    return rawLiveList.map((n) => ({
      id: n._id as string,
      title: n.title,
      message: n.message,
      read: n.isRead,
      category: (LIVE_CATEGORY_MAP[n.type] ?? "general") as NotificationCategory,
      createdAt: new Date(n._creationTime).toISOString(),
      href: n.href ?? null,
    }));
  }, [rawLiveList]);

  const allList = live ? liveItems : allItemsQuery.data;

  const items = useMemo(() => {
    const base = live ? liveItems : q.data;
    if (!base) return undefined;
    return base.filter((n) => {
      if (category !== "all" && n.category !== category) return false;
      if (onlyUnread === "unread" && n.read) return false;
      return true;
    });
  }, [live, liveItems, q.data, category, onlyUnread]);

  const unreadByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    (allList ?? []).forEach((n) => {
      if (!n.read) counts[n.category] = (counts[n.category] ?? 0) + 1;
    });
    return counts;
  }, [allList]);

  const queryState = useMemo<QueryState<NonNullable<typeof items>>>(
    () => ({
      isLoading: live ? liveItems === undefined : q.isLoading,
      isRefreshing: false,
      data: items,
      error: live ? null : q.error,
      refetch: live ? () => {} : q.refetch,
    }),
    [live, liveItems, items, q.isLoading, q.error, q.refetch]
  );

  const cats: (NotificationCategory | "all")[] = [
    "all",
    "attendance",
    "fees",
    "homework",
    "examination",
    "notice",
    "general",
  ];

  const fail = (e: unknown) => toast({ title: "That didn't work", description: e instanceof Error ? e.message : "Please try again.", tone: "error" });

  const handleMarkAllRead = async () => {
    try {
    if (live) {
      const r = await markAllReadMutation({});
      toast({
        title: "All notifications marked as read",
        description: `${r.updated} notification${r.updated === 1 ? "" : "s"} updated.`,
      });
    } else {
      const r = await requireDemo().notifications.markAllRead();
      toast({
        title: "All notifications marked as read",
        description: `${r.count} notification${r.count === 1 ? "" : "s"} updated.`,
      });
    }
    } catch (e) { fail(e); }
  };

  // LIVE: removes only the caller's own notification copies (server-scoped), in bounded batches.
  const handleClearAll = async () => {
    setClearing(true);
    try {
      let deleted = 0;
      for (let i = 0; i < 50; i++) {
        const r = await clearAllMutation({});
        deleted += r.deleted;
        if (!r.remaining) break;
      }
      toast({ title: "Notifications cleared", description: `${deleted} notification${deleted === 1 ? "" : "s"} removed.` });
      setConfirmClear(false);
    } catch (e) { fail(e); } finally { setClearing(false); }
  };

  const handleMarkRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (live) {
        await markReadMutation({ notificationId: id as Id<"notifications"> });
      } else {
        await requireDemo().notifications.markRead(id);
      }
      toast({ title: "Notification marked as read" });
    } catch (err) { fail(err); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (live) {
        await removeMutation({ notificationId: id as Id<"notifications"> });
      } else {
        await requireDemo().notifications.remove(id);
      }
      toast({ title: "Notification removed" });
    } catch (err) { fail(err); }
  };

  return (
    <div className="mx-auto max-w-4xl" data-testid={live ? "live-notifications" : undefined}>
      <PageHeader
        title="Notifications"
        description={
          unread
            ? `You have ${unread} unread notification${unread > 1 ? "s" : ""}.`
            : "You're all caught up with school updates."
        }
        actions={
          <>
            {unread > 0 && (
              <Button variant="outline" onClick={handleMarkAllRead}>
                <CheckCheck className="h-4 w-4" /> Mark all as read
              </Button>
            )}
            {live && (liveItems?.length ?? 0) > 0 && (
              <Button variant="outline" onClick={() => setConfirmClear(true)}>
                <Trash2 className="h-4 w-4" /> Clear all
              </Button>
            )}
          </>
        }
      />
      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Clear all notifications?" description="Every notification in your list will be removed. This only affects your own list — the notices, payments and results they point to are not touched." confirmLabel="Clear all" tone="danger" loading={clearing} onConfirm={handleClearAll} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterPills
          label="Category"
          value={category}
          onChange={setCategory}
          items={cats.map((c) => {
            const count = c === "all" ? unread : (unreadByCategory[c] ?? 0);
            return { value: c, label: c === "all" ? "All" : NOTIFICATION_CATEGORY_LABELS[c], count: count > 0 ? count : null };
          })}
        />
        <Segmented
          label="Show"
          size="sm"
          value={onlyUnread}
          onChange={setOnlyUnread}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread only" },
          ]}
        />
      </div>

      <QueryView query={queryState} loading="table">
        {(items) =>
          items.length === 0 ? (
            <Card>
              {onlyUnread === "unread" ? (
                <EmptyState
                  icon={<CheckCheck className="h-6 w-6 text-lagoon" />}
                  title="No unread notifications"
                  description={
                    category !== "all"
                      ? `You're all caught up on ${NOTIFICATION_CATEGORY_LABELS[category].toLowerCase()} updates.`
                      : "You have reviewed all incoming notifications."
                  }
                  action={
                    <Button variant="outline" onClick={() => setOnlyUnread("all")}>
                      View all notifications
                    </Button>
                  }
                />
              ) : category !== "all" ? (
                <EmptyState
                  icon={<Bell className="h-6 w-6" />}
                  title={`No ${NOTIFICATION_CATEGORY_LABELS[category].toLowerCase()} notifications`}
                  description="New updates in this category will appear here."
                  action={
                    <Button variant="outline" onClick={() => setCategory("all")}>
                      View all categories
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Bell className="h-6 w-6" />}
                  title="No notifications yet"
                  description="Updates about attendance, fees, homework, examinations, and school announcements will appear here."
                />
              )}
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line/60">
                <AnimatePresence initial={false}>
                  {items.map((n) => (
                    <motion.li
                      key={n.id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className={cn(
                        "group flex items-start gap-3.5 px-4 py-3.5 transition-colors sm:px-5",
                        !n.read ? "bg-teal-soft/30 hover:bg-teal-soft/45" : "hover:bg-paper-soft/40"
                      )}
                    >
                      <CategoryIcon category={n.category} className="mt-0.5" />
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={async () => {
                          if (!n.read) {
                            if (live) {
                              await markReadMutation({ notificationId: n.id as Id<"notifications"> });
                            } else {
                              await requireDemo().notifications.markRead(n.id);
                            }
                          }
                          // Live accounts only follow links to pages backed by real records.
                          if (n.href && (!live || isLiveRoute(n.href))) router.push(n.href);
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={cn("text-sm", n.read ? "font-medium text-ink-soft" : "font-semibold text-ink")}>
                            {n.title}
                          </p>
                          {!n.read && (
                            <Badge tone="teal" className="py-0 text-[10.5px]">
                              New
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{n.message}</p>
                        <p className="mt-1.5 text-[11.5px] text-ink-muted" title={formatDateTime(n.createdAt)}>
                          <span className="font-semibold text-ink-soft">{NOTIFICATION_CATEGORY_LABELS[n.category]}</span>
                          {" · "}
                          <span>{relativeTime(n.createdAt)}</span>
                        </p>
                      </button>

                      <div className="flex shrink-0 items-center gap-1 pt-1">
                        {!n.read && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-lagoon hover:bg-teal-soft/60"
                            aria-label="Mark notification as read"
                            title="Mark as read"
                            onClick={(e) => handleMarkRead(n.id, e)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-50 hover:text-plum group-hover:opacity-100"
                          aria-label="Delete notification"
                          title="Delete notification"
                          onClick={(e) => handleDelete(n.id, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        {n.href && (
                          <ChevronRight className="hidden h-4 w-4 text-ink-muted sm:block" aria-hidden />
                        )}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Card>
          )
        }
      </QueryView>
    </div>
  );
}

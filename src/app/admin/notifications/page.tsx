"use client";

import { useMemo, useState } from "react";
import { 
  Bell, 
  BellOff, 
  FileText, 
  GraduationCap, 
  UserCheck, 
  WalletCards, 
  Clock 
} from "lucide-react";
import { useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import { Card, PageHeader } from "@/components/ui";

// Principal portal: Homework excluded, administrative categories included
const PRINCIPAL_TABS = [
  { id: "all", label: "All" },
  { id: "attendance", label: "Attendance" },
  { id: "fees", label: "Fees" },
  { id: "examination", label: "Examination" },
  { id: "notice", label: "Notice" },
  { id: "approvals", label: "Approvals" },
  { id: "general", label: "General" },
] as const;

type FilterTab = (typeof PRINCIPAL_TABS)[number]["id"];

export default function AdminNotificationsPage() {
  const notifications = useSchoolQuery(api.notifications.list, {}) ?? [];

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);

  // 1. Role filtering: Homework notifications removed for principal
  const roleFiltered = useMemo(() => {
    return (notifications as any[]).filter((n) => {
      const cat = (n.category ?? n.type ?? "").toLowerCase();
      return cat !== "homework";
    });
  }, [notifications]);

  // 2. Unread count
  const unreadCount = useMemo(() => {
    return roleFiltered.filter((n) => !n.read && !n.isRead).length;
  }, [roleFiltered]);

  // 3. Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tab of PRINCIPAL_TABS) {
      if (tab.id === "all") {
        counts[tab.id] = roleFiltered.filter((n) => !n.read && !n.isRead).length;
      } else {
        counts[tab.id] = roleFiltered.filter(
          (n) => (!n.read && !n.isRead) && (n.category ?? n.type ?? "").toLowerCase().includes(tab.id)
        ).length;
      }
    }
    return counts;
  }, [roleFiltered]);

  // 4. Tab filtering logic
  const visibleItems = useMemo(() => {
    return roleFiltered.filter((item) => {
      const isUnreadItem = !item.read && !item.isRead;
      if (filterUnreadOnly && !isUnreadItem) return false;

      if (activeTab === "all") return true;
      const cat = (item.category ?? item.type ?? "").toLowerCase();
      if (activeTab === "approvals") return cat.includes("leave") || cat.includes("approval");
      return cat.includes(activeTab);
    });
  }, [roleFiltered, activeTab, filterUnreadOnly]);

  const getCategoryIcon = (category: string) => {
    const c = category.toLowerCase();
    if (c.includes("fee")) return <WalletCards className="h-4 w-4 text-emerald-600" />;
    if (c.includes("exam")) return <GraduationCap className="h-4 w-4 text-purple-600" />;
    if (c.includes("attendance")) return <UserCheck className="h-4 w-4 text-blue-600" />;
    if (c.includes("notice")) return <FileText className="h-4 w-4 text-amber-600" />;
    if (c.includes("leave") || c.includes("approval")) return <Clock className="h-4 w-4 text-indigo-600" />;
    return <Bell className="h-4 w-4 text-ink-muted" />;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={
          unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}.`
            : "You are all caught up."
        }
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-line/60 pb-3">
        {/* Navigation Tabs without Homework */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {PRINCIPAL_TABS.map((tab) => {
            const count = tabCounts[tab.id] ?? 0;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-sapphire text-white shadow-sm"
                    : "bg-surface hover:bg-subtle text-ink-soft hover:text-ink"
                }`}
              >
                <span>{tab.label}</span>
                {count > 0 && (
                  <span
                    className={`h-4 min-w-[1rem] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                      isActive ? "bg-white/20 text-white" : "bg-sapphire/10 text-sapphire"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Unread toggle */}
        <div className="flex items-center gap-1 bg-subtle p-0.5 rounded-lg text-xs shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setFilterUnreadOnly(false)}
            className={`px-2.5 py-1 rounded-md font-medium ${
              !filterUnreadOnly ? "bg-white shadow-xs text-ink" : "text-ink-soft"
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilterUnreadOnly(true)}
            className={`px-2.5 py-1 rounded-md font-medium ${
              filterUnreadOnly ? "bg-white shadow-xs text-ink" : "text-ink-soft"
            }`}
          >
            Unread only
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="space-y-2.5">
        {visibleItems.length === 0 ? (
          <Card>
            <div className="p-8 text-center flex flex-col items-center justify-center">
              <BellOff className="h-8 w-8 text-ink-muted mb-2 opacity-50" />
              <p className="text-sm font-medium text-ink">No notifications found</p>
              <p className="text-xs text-ink-soft mt-0.5">
                {filterUnreadOnly
                  ? "There are no unread notifications in this category."
                  : "No notifications recorded under this section."}
              </p>
            </div>
          </Card>
        ) : (
          visibleItems.map((item: any, idx: number) => {
            const isRead = Boolean(item.read || item.isRead);
            const category = item.category ?? item.type ?? "General";
            return (
              <div
                key={item._id ?? item.id ?? idx}
                className={`group flex items-start gap-3.5 p-4 rounded-xl border transition-all ${
                  isRead
                    ? "bg-surface/50 border-line/60 opacity-80"
                    : "bg-surface border-line shadow-xs"
                }`}
              >
                <div className="mt-0.5 p-2 rounded-lg bg-subtle shrink-0">
                  {getCategoryIcon(category)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm ${isRead ? "font-medium text-ink" : "font-semibold text-ink"}`}>
                      {item.title ?? item.subject ?? "Notification"}
                    </p>
                    {!isRead && (
                      <span className="inline-block h-2 w-2 rounded-full bg-sapphire shrink-0" />
                    )}
                  </div>
                  {item.message || item.description ? (
                    <p className="text-xs text-ink-soft line-clamp-2 mt-0.5">
                      {item.message ?? item.description}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-muted">
                    <span className="capitalize font-medium">{category}</span>
                    <span>•</span>
                    <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : (item.date ?? "Recently")}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
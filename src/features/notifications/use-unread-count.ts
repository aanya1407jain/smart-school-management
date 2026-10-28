"use client";
import { api } from "@convex/_generated/api";
import { requireDemo } from "@/lib/demo/runtime";
import { useQuery } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { useSession } from "@/features/auth/session-provider";

/** Unread notifications: Convex for live-portal accounts, demo data otherwise. */
export function useUnreadCount() {
  const { user, dataSource } = useSession();
  const live = dataSource === "live";
  const demo = useQuery(() => requireDemo().notifications.unreadCount(), [user?.id], { enabled: !!user && !live });
  const server = useSchoolQuery(api.notifications.unreadCount, user && live ? {} : "skip");
  return (live ? server : demo.data) ?? 0;
}

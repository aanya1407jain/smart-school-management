"use client";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useSession } from "@/features/auth/session-provider";

export function useUnreadCount() {
  const { user } = useSession();
  const q = useQuery(() => services.notifications.unreadCount(), [user?.id], { enabled: !!user });
  return q.data ?? 0;
}

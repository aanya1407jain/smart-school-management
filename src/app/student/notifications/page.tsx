import type { Metadata } from "next";
import { NotificationCenter } from "@/features/notifications/notification-center";
import { PortalPage, LiveNotifications } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Notifications" };
export default function Page() {
  return <PortalPage demo={<NotificationCenter />} live={<LiveNotifications />} />;
}

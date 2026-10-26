import type { Metadata } from "next";
import { NotificationCenter } from "@/features/notifications/notification-center";
import { LiveAware } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Notifications" };
/** One notification centre for every role: demo data for demo personas, Convex for school accounts. */
export default function Page() {
  return <LiveAware><NotificationCenter /></LiveAware>;
}

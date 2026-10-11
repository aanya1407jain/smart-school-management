import type { Metadata } from "next";
import { NotificationCenter } from "@/features/notifications/notification-center";

export const metadata: Metadata = { title: "Notifications" };
export default function Page() {
  return <NotificationCenter />;
}

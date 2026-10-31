import type { Metadata } from "next";
import { AdminDashboard } from "@/features/dashboard/admin-dashboard";
import { LiveAware } from "@/features/live/portal";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return <LiveAware><AdminDashboard /></LiveAware>;
}

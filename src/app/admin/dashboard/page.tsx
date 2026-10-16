import type { Metadata } from "next";
import { AdminDashboard } from "@/features/dashboard/admin-dashboard";
import { LiveAware } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return <LiveAware><AdminDashboard /></LiveAware>;
}

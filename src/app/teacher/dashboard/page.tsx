import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveTeacherDashboard } from "@/features/teachers/teacher-dashboard-live";

export const metadata: Metadata = { title: "Dashboard" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="teacher.dashboard" />} live={<LiveTeacherDashboard />} />;
}

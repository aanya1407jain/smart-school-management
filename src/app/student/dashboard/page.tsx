import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveStudentDashboard } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Dashboard" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="student.dashboard" />} live={<LiveStudentDashboard />} />;
}

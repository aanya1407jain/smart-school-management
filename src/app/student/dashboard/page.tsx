import type { Metadata } from "next";
import { StudentDashboard } from "@/features/dashboard/student-dashboard";
import { PortalPage, LiveStudentDashboard } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Dashboard" };
export default function Page() {
  return <PortalPage demo={<StudentDashboard />} live={<LiveStudentDashboard />} />;
}

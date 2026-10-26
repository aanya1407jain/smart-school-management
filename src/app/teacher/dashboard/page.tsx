import type { Metadata } from "next";
import { TeacherDashboard } from "@/features/dashboard/teacher-dashboard";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveTeacherDashboard } from "@/features/teacher-live/teacher-live";

export const metadata: Metadata = { title: "Dashboard" };
export default function Page() {
  return <PortalPage demo={<TeacherDashboard />} live={<LiveTeacherDashboard />} />;
}

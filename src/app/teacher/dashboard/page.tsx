import type { Metadata } from "next";
import { TeacherDashboard } from "@/features/dashboard/teacher-dashboard";

export const metadata: Metadata = { title: "Dashboard" };
export default function Page() {
  return <TeacherDashboard />;
}

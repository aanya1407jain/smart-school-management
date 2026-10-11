import type { Metadata } from "next";
import { StudentDashboard } from "@/features/dashboard/student-dashboard";

export const metadata: Metadata = { title: "Dashboard" };
export default function Page() {
  return <StudentDashboard />;
}

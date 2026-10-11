import type { Metadata } from "next";
import { Suspense } from "react";
import { AttendanceWorkspace } from "@/features/attendance/attendance-workspace";

export const metadata: Metadata = { title: "Attendance" };
export default function Page() {
  return <Suspense><AttendanceWorkspace area="admin" /></Suspense>;
}

import type { Metadata } from "next";
import { MyAttendance } from "@/features/attendance/my-attendance";
import { PortalPage, LiveMyAttendance } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "My Attendance" };
export default function Page() {
  return <PortalPage demo={<MyAttendance />} live={<LiveMyAttendance />} />;
}

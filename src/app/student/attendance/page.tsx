import type { Metadata } from "next";
import { MyAttendance } from "@/features/attendance/my-attendance";

export const metadata: Metadata = { title: "My Attendance" };
export default function Page() {
  return <MyAttendance />;
}

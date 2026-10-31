import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveMyAttendance } from "@/features/attendance/live-my-attendance";

export const metadata: Metadata = { title: "My Attendance" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="attendance.myAttendance" />} live={<LiveMyAttendance />} />;
}

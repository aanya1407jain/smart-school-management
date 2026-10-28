import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveTeacherTimetable } from "@/features/timetable/live-teacher-timetable";

export const metadata: Metadata = { title: "My Timetable" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="timetable.teacher" />} live={<LiveTeacherTimetable />} />;
}

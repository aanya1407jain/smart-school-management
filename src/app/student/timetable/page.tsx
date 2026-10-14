import type { Metadata } from "next";
import { StudentTimetable } from "@/features/timetable/timetable-pages";
import { PortalPage, LiveTimetable } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "My Timetable" };
export default function Page() {
  return <PortalPage demo={<StudentTimetable />} live={<LiveTimetable />} />;
}

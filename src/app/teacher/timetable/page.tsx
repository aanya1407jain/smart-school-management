import type { Metadata } from "next";
import { TeacherTimetable } from "@/features/timetable/timetable-pages";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveTeacherTimetable } from "@/features/teacher-live/teacher-live";

export const metadata: Metadata = { title: "My Timetable" };
export default function Page() {
  return <PortalPage demo={<TeacherTimetable />} live={<LiveTeacherTimetable />} />;
}

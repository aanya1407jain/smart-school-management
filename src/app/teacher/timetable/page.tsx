import type { Metadata } from "next";
import { TeacherTimetable } from "@/features/timetable/timetable-pages";

export const metadata: Metadata = { title: "My Timetable" };
export default function Page() {
  return <TeacherTimetable />;
}

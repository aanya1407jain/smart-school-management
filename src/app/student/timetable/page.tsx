import type { Metadata } from "next";
import { StudentTimetable } from "@/features/timetable/timetable-pages";

export const metadata: Metadata = { title: "My Timetable" };
export default function Page() {
  return <StudentTimetable />;
}

import type { Metadata } from "next";
import { LiveTimetableBuilder } from "@/features/timetable/timetable-live";
import { LiveAware } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Timetable" };
// One source for every admin session (demo personas included), like the Students page: the
// builder edits the school's Convex timetable (drag-and-drop moves, clash checks on the server).
export default function Page() {
  return <LiveAware><LiveTimetableBuilder /></LiveAware>;
}

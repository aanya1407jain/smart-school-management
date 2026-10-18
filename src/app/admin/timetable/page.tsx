import type { Metadata } from "next";
import { AdminTimetable } from "@/features/timetable/timetable-pages";
import { LiveTimetableBuilder } from "@/features/timetable/timetable-live";
import { PortalPage } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Timetable" };
export default function Page() {
  return <PortalPage demo={<AdminTimetable />} live={<LiveTimetableBuilder />} />;
}

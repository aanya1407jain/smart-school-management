import type { Metadata } from "next";
import { AdminTimetable } from "@/features/timetable/timetable-pages";

export const metadata: Metadata = { title: "Timetable" };
export default function Page() {
  return <AdminTimetable />;
}

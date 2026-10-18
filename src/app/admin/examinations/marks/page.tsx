import type { Metadata } from "next";
import { Suspense } from "react";
import { MarksEntry } from "@/features/examinations/marks-entry";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveMarksEntry } from "@/features/teacher-live/teacher-live";

export const metadata: Metadata = { title: "Marks entry" };
export default function Page() {
  return <Suspense><PortalPage demo={<MarksEntry area="admin" />} live={<LiveMarksEntry area="admin" />} /></Suspense>;
}

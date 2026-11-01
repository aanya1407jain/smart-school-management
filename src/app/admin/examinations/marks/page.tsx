import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveMarksEntry } from "@/features/examinations/live-teacher-exams";

export const metadata: Metadata = { title: "Marks entry" };
export default function Page() {
  return <Suspense><PortalPage demo={<DemoSlot id="exams.marks" props={{ area: "admin" }} />} live={<LiveMarksEntry area="admin" />} /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { LiveExamsAdmin } from "@/features/examinations/exams-live";
import { PortalPage } from "@/features/live/portal";

export const metadata: Metadata = { title: "Examinations" };
export default function Page() {
  return <Suspense><PortalPage demo={<DemoSlot id="exams.list" />} live={<LiveExamsAdmin />} /></Suspense>;
}

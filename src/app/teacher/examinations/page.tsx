import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveTeacherExams } from "@/features/examinations/live-teacher-exams";

export const metadata: Metadata = { title: "Examinations" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="exams.teacher" />} live={<LiveTeacherExams />} />;
}

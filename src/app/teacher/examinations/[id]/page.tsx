"use client";
import { useParams } from "next/navigation";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveTeacherExams } from "@/features/examinations/live-teacher-exams";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  // The per-exam detail screen is demo-only; live accounts get their live examinations list.
  return <PortalPage demo={<DemoSlot id="exams.detail" props={{ examId: id, area: "teacher" }} />} live={<LiveTeacherExams />} />;
}

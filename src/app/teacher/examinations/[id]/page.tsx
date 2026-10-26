"use client";
import { useParams } from "next/navigation";
import { ExamDetail } from "@/features/examinations/exam-detail";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveTeacherExams } from "@/features/teacher-live/teacher-live";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  // The per-exam detail screen is demo-only; live accounts get their live examinations list.
  return <PortalPage demo={<ExamDetail examId={id} area="teacher" />} live={<LiveTeacherExams />} />;
}

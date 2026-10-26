"use client";
import { useParams } from "next/navigation";
import { ExamDetail } from "@/features/examinations/exam-detail";
import { LiveExamDetail } from "@/features/examinations/exams-live";
import { PortalPage } from "@/features/student-portal/live-portal";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PortalPage demo={<ExamDetail examId={id} area="admin" />} live={<LiveExamDetail examId={id} />} />;
}

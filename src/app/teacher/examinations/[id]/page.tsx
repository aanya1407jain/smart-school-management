"use client";
import { useParams } from "next/navigation";
import { ExamDetail } from "@/features/examinations/exam-detail";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ExamDetail examId={id} area="teacher" />;
}

import type { Metadata } from "next";
import { TeacherExams } from "@/features/examinations/teacher-exams";

export const metadata: Metadata = { title: "Examinations" };
export default function Page() {
  return <TeacherExams />;
}

import type { Metadata } from "next";
import { TeacherExams } from "@/features/examinations/teacher-exams";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveTeacherExams } from "@/features/teacher-live/teacher-live";

export const metadata: Metadata = { title: "Examinations" };
export default function Page() {
  return <PortalPage demo={<TeacherExams />} live={<LiveTeacherExams />} />;
}

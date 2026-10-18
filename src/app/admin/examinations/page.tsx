import type { Metadata } from "next";
import { Suspense } from "react";
import { ExamsList } from "@/features/examinations/exams-list";
import { LiveExamsAdmin } from "@/features/examinations/exams-live";
import { PortalPage } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Examinations" };
export default function Page() {
  return <Suspense><PortalPage demo={<ExamsList />} live={<LiveExamsAdmin />} /></Suspense>;
}

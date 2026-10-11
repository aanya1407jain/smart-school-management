import type { Metadata } from "next";
import { Suspense } from "react";
import { ExamsList } from "@/features/examinations/exams-list";

export const metadata: Metadata = { title: "Examinations" };
export default function Page() {
  return <Suspense><ExamsList /></Suspense>;
}

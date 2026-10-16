import type { Metadata } from "next";
import { Suspense } from "react";
import { StudentsList } from "@/features/students/students-list";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveStudentsList } from "@/features/students/live-students";

export const metadata: Metadata = { title: "Students" };
export default function Page() {
  return <Suspense><PortalPage demo={<StudentsList />} live={<LiveStudentsList />} /></Suspense>;
}

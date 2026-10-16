import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeworkManager } from "@/features/homework/homework-manager";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveTeacherHomework } from "@/features/teacher-live/teacher-live";

export const metadata: Metadata = { title: "Homework" };
export default function Page() {
  return <Suspense><PortalPage demo={<HomeworkManager area="teacher" />} live={<LiveTeacherHomework />} /></Suspense>;
}

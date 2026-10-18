import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeworkManager } from "@/features/homework/homework-manager";
import { LiveAdminHomework } from "@/features/homework/homework-admin-live";
import { PortalPage } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Homework" };
export default function Page() {
  return <Suspense><PortalPage demo={<HomeworkManager area="admin" />} live={<LiveAdminHomework />} /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { TeachersWorkspace } from "@/features/teachers/teachers-workspace";
import { LiveTeachersWorkspace } from "@/features/teachers/teachers-live";
import { PortalPage } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Teachers & Staff" };
export default function Page() {
  return <Suspense><PortalPage demo={<TeachersWorkspace />} live={<LiveTeachersWorkspace />} /></Suspense>;
}

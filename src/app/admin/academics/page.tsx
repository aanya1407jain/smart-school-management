import type { Metadata } from "next";
import { Suspense } from "react";
import { AcademicsWorkspace } from "@/features/academics/academics-workspace";
import { LiveAware } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Academics" };
export default function Page() {
  return <Suspense><LiveAware><AcademicsWorkspace /></LiveAware></Suspense>;
}

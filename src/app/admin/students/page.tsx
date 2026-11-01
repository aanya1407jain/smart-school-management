import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveAware } from "@/features/live/portal";
import { LiveStudentsList } from "@/features/students/live-students";

export const metadata: Metadata = { title: "Students" };
// One source for every admin session (demo personas included): admissions are written to the
// school's Convex records, so the list and its totals read the same records (see live-students.tsx).
export default function Page() {
  return <Suspense><LiveAware><LiveStudentsList /></LiveAware></Suspense>;
}

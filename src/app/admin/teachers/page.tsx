import type { Metadata } from "next";
import { Suspense } from "react";
import { TeachersWorkspace } from "@/features/teachers/teachers-workspace";

export const metadata: Metadata = { title: "Teachers & Staff" };
export default function Page() {
  return <Suspense><TeachersWorkspace /></Suspense>;
}

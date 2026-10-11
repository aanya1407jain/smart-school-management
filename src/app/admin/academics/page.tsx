import type { Metadata } from "next";
import { Suspense } from "react";
import { AcademicsWorkspace } from "@/features/academics/academics-workspace";

export const metadata: Metadata = { title: "Academics" };
export default function Page() {
  return <Suspense><AcademicsWorkspace /></Suspense>;
}

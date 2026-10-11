import type { Metadata } from "next";
import { Suspense } from "react";
import { StudentsList } from "@/features/students/students-list";

export const metadata: Metadata = { title: "Students" };
export default function Page() {
  return <Suspense><StudentsList /></Suspense>;
}

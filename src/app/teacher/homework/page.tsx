import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeworkManager } from "@/features/homework/homework-manager";

export const metadata: Metadata = { title: "Homework" };
export default function Page() {
  return <Suspense><HomeworkManager area="teacher" /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { MarksEntry } from "@/features/examinations/marks-entry";

export const metadata: Metadata = { title: "Marks entry" };
export default function Page() {
  return <Suspense><MarksEntry area="admin" /></Suspense>;
}

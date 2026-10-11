import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsPage } from "@/features/reports/reports-page";

export const metadata: Metadata = { title: "Reports" };
export default function Page() {
  return <Suspense><ReportsPage /></Suspense>;
}

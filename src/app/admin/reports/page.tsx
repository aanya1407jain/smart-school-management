import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsPage } from "@/features/reports/reports-page";
import { LiveAware } from "@/features/live/portal";

export const metadata: Metadata = { title: "Reports" };
export default function Page() {
  return <Suspense><LiveAware><ReportsPage /></LiveAware></Suspense>;
}

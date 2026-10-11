import type { Metadata } from "next";
import { Suspense } from "react";
import { FeesWorkspace } from "@/features/fees/fees-workspace";

export const metadata: Metadata = { title: "Fees" };
export default function Page() {
  return <Suspense><FeesWorkspace /></Suspense>;
}

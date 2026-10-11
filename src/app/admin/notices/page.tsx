import type { Metadata } from "next";
import { Suspense } from "react";
import { NoticesManager } from "@/features/notices/notices-pages";

export const metadata: Metadata = { title: "Notices & Events" };
export default function Page() {
  return <Suspense><NoticesManager /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveTeacherHomework } from "@/features/homework/live-teacher-homework";

export const metadata: Metadata = { title: "Homework" };
export default function Page() {
  return <Suspense><PortalPage demo={<DemoSlot id="homework.manager" props={{ area: "teacher" }} />} live={<LiveTeacherHomework />} /></Suspense>;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { LiveTeachersWorkspace } from "@/features/teachers/teachers-live";
import { PortalPage } from "@/features/live/portal";

export const metadata: Metadata = { title: "Teachers & Staff" };
export default function Page() {
  return <Suspense><PortalPage demo={<DemoSlot id="teachers.workspace" />} live={<LiveTeachersWorkspace />} /></Suspense>;
}

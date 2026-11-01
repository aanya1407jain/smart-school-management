import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveMyClasses } from "@/features/students/live-my-classes";

export const metadata: Metadata = { title: "My Classes" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="teacher.myClasses" />} live={<LiveMyClasses />} />;
}

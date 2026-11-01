import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveResults } from "@/features/examinations/live-my-results";

export const metadata: Metadata = { title: "My Results" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="exams.myResults" />} live={<LiveResults />} />;
}

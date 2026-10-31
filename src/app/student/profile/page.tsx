import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveStudentProfile } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Profile" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="profile.page" />} live={<LiveStudentProfile />} />;
}

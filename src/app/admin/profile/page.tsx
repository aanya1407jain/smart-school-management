import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { LiveStaffProfile } from "@/features/profile/staff-profile-live";
import { PortalPage } from "@/features/live/portal";

export const metadata: Metadata = { title: "Profile" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="profile.page" />} live={<LiveStaffProfile />} />;
}

import type { Metadata } from "next";
import { ProfilePage } from "@/features/profile/profile-page";
import { PortalPage, LiveStudentProfile } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Profile" };
export default function Page() {
  return <PortalPage demo={<ProfilePage />} live={<LiveStudentProfile />} />;
}

import type { Metadata } from "next";
import { MyResults } from "@/features/examinations/my-results";
import { PortalPage, LiveResults } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "My Results" };
export default function Page() {
  return <PortalPage demo={<MyResults />} live={<LiveResults />} />;
}

import type { Metadata } from "next";
import { PortalPage, LiveCertificates } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Certificates & Documents" };
export default function Page() {
  return <PortalPage demo={<LiveCertificates />} live={<LiveCertificates />} />;
}

import type { Metadata } from "next";
import { NoticeBoard } from "@/features/notices/notices-pages";
import { PortalPage, ModuleNotConnected } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Notices" };
export default function Page() {
  return <PortalPage demo={<NoticeBoard />} live={<ModuleNotConnected module="Notices" />} />;
}

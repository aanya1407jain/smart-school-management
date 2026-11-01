import type { Metadata } from "next";
import { NoticeBoard } from "@/features/notices/notices-pages";
import { LiveAware } from "@/features/live/portal";

export const metadata: Metadata = { title: "Notices" };
export default function Page() {
  return <LiveAware><NoticeBoard /></LiveAware>;
}

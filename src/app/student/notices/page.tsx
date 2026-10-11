import type { Metadata } from "next";
import { NoticeBoard } from "@/features/notices/notices-pages";

export const metadata: Metadata = { title: "Notices" };
export default function Page() {
  return <NoticeBoard />;
}

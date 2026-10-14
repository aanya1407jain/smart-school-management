import type { Metadata } from "next";
import { MyHomework } from "@/features/homework/my-homework";
import { PortalPage, LiveHomework } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "My Homework" };
export default function Page() {
  return <PortalPage demo={<MyHomework />} live={<LiveHomework />} />;
}

import type { Metadata } from "next";
import { MyHomework } from "@/features/homework/my-homework";
import { MyHomeworkDemo } from "@/features/homework/my-homework-demo";
import { PortalPage } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "My Homework" };
export default function Page() {
  // Live (school-created) accounts: Convex homework with online submission. Demo personas: the in-browser demo data.
  return <PortalPage demo={<MyHomeworkDemo />} live={<MyHomework />} />;
}

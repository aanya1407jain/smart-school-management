import type { Metadata } from "next";
import { MyHomework } from "@/features/homework/my-homework";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";

export const metadata: Metadata = { title: "My Homework" };
export default function Page() {
  // Live (school-created) accounts: Convex homework with online submission. Demo personas: the in-browser demo data.
  return <PortalPage demo={<DemoSlot id="homework.myHomework" />} live={<MyHomework />} />;
}

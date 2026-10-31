"use client";
import { useParams } from "next/navigation";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveMyClasses } from "@/features/students/live-my-classes";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  // Live accounts get the live class view (section picker + roster) instead of demo data.
  return <PortalPage demo={<DemoSlot id="teacher.classDetail" props={{ sectionId: id }} />} live={<LiveMyClasses />} />;
}

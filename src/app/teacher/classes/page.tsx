import type { Metadata } from "next";
import { MyClasses } from "@/features/teachers/my-classes";
import { PortalPage } from "@/features/student-portal/live-portal";
import { LiveMyClasses } from "@/features/teacher-live/teacher-live";

export const metadata: Metadata = { title: "My Classes" };
export default function Page() {
  return <PortalPage demo={<MyClasses />} live={<LiveMyClasses />} />;
}

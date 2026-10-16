import type { Metadata } from "next";
import { SettingsPage } from "@/features/settings/settings-page";
import { LiveAware } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "Settings" };
export default function Page() {
  return <LiveAware><SettingsPage /></LiveAware>;
}

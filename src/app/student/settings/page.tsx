import type { Metadata } from "next";
import { AccountSettingsPage } from "@/features/settings/account-settings";

export const metadata: Metadata = { title: "Settings" };
export default function Page() {
  return <AccountSettingsPage />;
}

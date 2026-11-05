import type { Metadata } from "next";
import { SetPasswordScreen } from "@/features/auth/set-password-screen";

export const metadata: Metadata = { title: "Set your password" };

/** Protected by src/proxy.ts (signed-in only). */
export default function Page() {
  return <SetPasswordScreen />;
}

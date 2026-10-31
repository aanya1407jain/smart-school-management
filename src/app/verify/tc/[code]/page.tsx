import type { Metadata } from "next";
import { VerifyTc } from "@/features/students/lifecycle/verify-tc";

export const metadata: Metadata = { title: "Verify transfer certificate" };

/** Public page (no sign-in): opened from the QR code printed on a transfer certificate. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <VerifyTc code={code} />;
}

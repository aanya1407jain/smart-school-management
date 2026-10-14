import type { Metadata } from "next";
import { MyFees } from "@/features/fees/my-fees";
import { PortalPage, ModuleNotConnected } from "@/features/student-portal/live-portal";

export const metadata: Metadata = { title: "My Fees" };
export default function Page() {
  return <PortalPage demo={<MyFees />} live={<ModuleNotConnected module="Fees" />} />;
}

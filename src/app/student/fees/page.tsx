import type { Metadata } from "next";
import { DemoSlot } from "@/lib/demo/demo-slot";
import { PortalPage } from "@/features/live/portal";
import { LiveFees } from "@/features/fees/live-my-fees";

export const metadata: Metadata = { title: "My Fees" };
export default function Page() {
  return <PortalPage demo={<DemoSlot id="fees.myFees" />} live={<LiveFees />} />;
}

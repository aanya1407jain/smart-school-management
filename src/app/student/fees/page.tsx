import type { Metadata } from "next";
import { MyFees } from "@/features/fees/my-fees";

export const metadata: Metadata = { title: "My Fees" };
export default function Page() {
  return <MyFees />;
}

import type { Metadata } from "next";
import { StaffPermissionsPage } from "@/features/accounts/staff-permissions";

export const metadata: Metadata = { title: "Staff & Permissions" };
export default function Page() {
  return <StaffPermissionsPage />;
}

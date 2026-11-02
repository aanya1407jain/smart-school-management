import type { Metadata } from "next";
import { CredentialsLookup } from "@/features/accounts/credentials-lookup";

export const metadata: Metadata = { title: "Credentials" };
export default function Page() {
  return <CredentialsLookup />;
}

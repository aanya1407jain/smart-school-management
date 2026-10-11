"use client";
/**
 * Client half: the Convex React client with Convex Auth, plus the active
 * school-membership selector used by `useSchoolQuery` / `useSchoolMutation`.
 */
import type { ReactNode } from "react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { CONVEX_URL, isConvexConfigured } from "./config";
import { MembershipProvider } from "./membership";

const client = isConvexConfigured ? new ConvexReactClient(CONVEX_URL) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthNextjsProvider client={client}>
      <MembershipProvider>{children}</MembershipProvider>
    </ConvexAuthNextjsProvider>
  );
}

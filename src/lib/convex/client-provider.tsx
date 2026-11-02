"use client";
/**
 * Client half: the Convex React client with Convex Auth, plus the active
 * school-membership selector used by `useSchoolQuery` / `useSchoolMutation`.
 */
import type { ReactNode } from "react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { CONVEX_URL, isConvexConfigured } from "./config";
import { MembershipProvider } from "./membership";

const client = isConvexConfigured ? new ConvexReactClient(CONVEX_URL) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthNextjsProvider client={client}>
      {/* Keeps school-query subscriptions alive for 5 minutes after their last user unmounts (tab switches are instant). */}
      <ConvexQueryCacheProvider expiration={5 * 60_000} maxIdleEntries={200}>
        <MembershipProvider>{children}</MembershipProvider>
      </ConvexQueryCacheProvider>
    </ConvexAuthNextjsProvider>
  );
}

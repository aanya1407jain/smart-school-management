/**
 * Server half of Convex Auth for the App Router. Mounted in the root layout
 * only when NEXT_PUBLIC_CONVEX_URL is configured (it reads auth cookies, which
 * makes routes dynamic).
 */
import type { ReactNode } from "react";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { isConvexConfigured } from "./config";

export function ConvexServerProvider({ children }: { children: ReactNode }) {
  if (!isConvexConfigured) return <>{children}</>;
  return <ConvexAuthNextjsServerProvider>{children}</ConvexAuthNextjsServerProvider>;
}

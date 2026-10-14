/**
 * Server half of Convex Auth for the App Router. Mounted in the root layout
 * only when NEXT_PUBLIC_CONVEX_URL is configured (it reads auth cookies, which
 * makes routes dynamic).
 *
 * Session storage: the durable session is the httpOnly cookie pair
 * (`__convexAuthJWT`, `__convexAuthRefreshToken`) set by the proxy. The Convex
 * Auth client additionally caches the short-lived access JWT (1 h) in
 * localStorage for its WebSocket; in Next.js mode the refresh token it stores
 * there is only a placeholder. `storage="inMemory"` would avoid that cache but
 * is broken in @convex-dev/auth 0.0.96 (its in-memory store never returns what
 * it saved, so the client never signs in) — revisit when upgrading.
 */
import type { ReactNode } from "react";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { isConvexConfigured } from "./config";

export function ConvexServerProvider({ children }: { children: ReactNode }) {
  if (!isConvexConfigured) return <>{children}</>;
  return <ConvexAuthNextjsServerProvider>{children}</ConvexAuthNextjsServerProvider>;
}

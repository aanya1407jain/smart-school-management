/**
 * Next.js 16 proxy (formerly middleware).
 *
 * When Convex is configured, Convex Auth's handler proxies sign-in/sign-out
 * requests (POST /api/auth) to the Convex deployment and keeps the auth
 * cookies in sync, so Server Components can call `convexAuthNextjsToken()`.
 *
 * Route protection is still done client-side by AppShell while the UI runs on
 * mock services. When the auth screen migrates to Convex, add redirects here
 * (see docs/BACKEND.md → "Frontend migration").
 */
import { NextResponse, type NextRequest } from "next/server";
import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

const convexAuth = process.env.NEXT_PUBLIC_CONVEX_URL ? convexAuthNextjsMiddleware() : null;

export default function proxy(request: NextRequest, event: Parameters<NonNullable<typeof convexAuth>>[1]) {
  if (!convexAuth) return NextResponse.next();
  return convexAuth(request, event);
}

export const config = {
  // Run on everything except static assets and Next internals.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

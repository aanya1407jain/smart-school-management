/**
 * Next.js 16 proxy (formerly middleware).
 *
 *  1. Convex Auth: proxies sign-in/sign-out (POST /api/auth) to the Convex
 *     deployment and keeps the httpOnly auth cookies in sync (incl. refresh).
 *  2. Route protection (server-side, before any page code is sent): a visitor
 *     without a valid Convex Auth session cannot load /admin/*, /teacher/*,
 *     /student/* or /account — they are redirected to /login?next=<path>.
 *
 * Which PORTAL a signed-in user may open is decided by the server-derived role
 * (users.session) in AppShell, and every Convex function re-checks the caller
 * on its own. This proxy never trusts a role, school or membership from the
 * request.
 */
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { convexAuthNextjsMiddleware, createRouteMatcher } from "@convex-dev/auth/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/admin", "/admin/(.*)", "/teacher", "/teacher/(.*)", "/student", "/student/(.*)", "/account"]);

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

const convexAuth = process.env.NEXT_PUBLIC_CONVEX_URL
  ? convexAuthNextjsMiddleware(async (request, { convexAuth: auth }) => {
      if (isProtectedRoute(request) && !(await auth.isAuthenticated())) return redirectToLogin(request);
    })
  : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Without a backend nobody can be signed in, so protected pages stay closed.
  if (!convexAuth) return isProtectedRoute(request) ? redirectToLogin(request) : NextResponse.next();
  return convexAuth(request, event);
}

export const config = {
  // Run on everything except static assets and Next internals.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

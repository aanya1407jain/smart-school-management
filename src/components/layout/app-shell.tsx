"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useSession } from "@/features/auth/session-provider";
import { canAccessRoute, homeRouteFor } from "@/lib/permissions";
import { isLiveRoute, liveNavItems } from "@/lib/permissions/navigation";
import { UnauthorizedState } from "@/components/ui/states";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { STORAGE_NAMESPACE } from "@/lib/constants/product";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { Topbar } from "./topbar";

const COLLAPSE_KEY = `${STORAGE_NAMESPACE}-sidebar-collapsed`;

/**
 * Workspace shell + route guard. The proxy (src/proxy.ts) already keeps
 * signed-out visitors out of /admin, /teacher and /student on the server; this
 * guard handles in-app navigation, sign-out and the role check.
 *  - not signed in      → redirect to /login (with ?next=)
 *  - signed in, nothing to open (no school access) → explanation + sign out
 *  - signed in, no access → Unauthorized page inside the user's OWN shell
 *  - temporary password → /account (the server blocks school functions until it is changed)
 *  - allowed            → page content
 *  - live account on a page that still runs on demo data → explanation + the
 *    live pages it can use (never the demo school's data)
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, viewer, notice, mustChangePassword, logout, dataSource } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* ignore */ }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* ignore */ }
      return !c;
    });
  };

  const access = status === "loading" || status === "unavailable" ? null : canAccessRoute(user, pathname);

  useEffect(() => {
    if (access === "unauthenticated") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [access, pathname, router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  // Temporary password: the server refuses every school function
  // (PASSWORD_CHANGE_REQUIRED) until it is changed, so go straight to /account.
  useEffect(() => {
    if (mustChangePassword) router.replace("/account");
  }, [mustChangePassword, router]);

  if (status === "unavailable") {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-4" role="alert">
        <div className="solid-card flex max-w-md flex-col items-center gap-4 p-8 text-center">
          <LogoMark size={44} />
          <p className="text-sm text-ink-soft">{notice}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {viewer && <Link href="/account" className="inline-flex h-10 items-center rounded-xl bg-sapphire px-4 text-sm font-semibold text-white hover:bg-lagoon">My account</Link>}
            <Button variant="outline" onClick={async () => { await logout(); router.replace("/login"); }}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "loading" || access === null || access === "unauthenticated" || !user || mustChangePassword) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg" role="status" aria-label="Checking your session">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={44} className="animate-pulse" />
          <p className="text-sm text-ink-muted">Checking your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ambient flex min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-lift">
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <main id="main" className="flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }} className="mx-auto w-full max-w-[1400px]">
            {access === "forbidden" ? (
              <div className="solid-card mx-auto mt-6 max-w-xl">
                <UnauthorizedState
                  homeHref={homeRouteFor(user)}
                  message={`Your ${user.role} account can't open ${pathname}. Access is decided by your account's role, not by the link you followed.`}
                />
              </div>
            ) : dataSource === "live" && !isLiveRoute(pathname) ? (
              <LiveNotConnected user={user} schoolName={viewer?.school.name ?? ""} />
            ) : children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

/**
 * A school-created (live) account opened a page that is not connected to the
 * school's records yet. Show what IS available instead of demo data.
 */
function LiveNotConnected({ user, schoolName }: { user: Parameters<typeof liveNavItems>[0]; schoolName: string }) {
  const items = liveNavItems(user);
  return (
    <div className="solid-card mx-auto mt-6 max-w-xl p-8 text-center" role="status" data-testid="live-not-connected">
      <h1 className="font-display text-xl text-ink">Not connected to {schoolName || "your school"}'s records yet</h1>
      <p className="mt-2 text-sm text-ink-soft">
        This page still runs on demonstration data, so it is hidden for school accounts. These pages already use your school&apos;s records:
      </p>
      <ul className="mt-4 flex flex-wrap justify-center gap-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="inline-flex h-9 items-center rounded-xl border border-line px-3 text-sm font-medium text-ink hover:bg-teal-soft/40">{i.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

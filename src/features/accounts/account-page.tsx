"use client";
/**
 * /account — the signed-in person's own account: Login ID, school and access.
 * Works for every valid account, including ones whose portal data is not
 * available in this build yet. Links to /set-password to change the
 * password. Protected by src/proxy.ts.
 */
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, LogOut } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { SET_PASSWORD_ROUTE, useSession } from "@/features/auth/session-provider";
import { landingRouteFor } from "@/lib/permissions";

export function AccountPage() {
  const { status, user, viewer, notice, logout } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?next=/account");
    else if (status === "passwordChange") router.replace(SET_PASSWORD_ROUTE);
  }, [status, router]);

  if (status === "loading" || status === "unauthenticated" || status === "passwordChange") {
    return (
      <div className="grid min-h-screen place-items-center bg-bg" role="status" aria-label="Checking your session">
        <LogoMark size={44} className="animate-pulse" />
      </div>
    );
  }
  if (!viewer) {
    // Signed in but no active school access (e.g. disabled): nothing to manage here.
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-4" role="alert">
        <div className="solid-card flex max-w-md flex-col items-center gap-4 p-8 text-center">
          <LogoMark size={44} />
          <p className="text-sm text-ink-soft">{notice ?? "Your account is not available."}</p>
          <Button variant="outline" onClick={async () => { await logout(); router.replace("/login"); }}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <main className="ambient min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-5">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-sapphire">{viewer.school.name}</p>
            <h1 className="text-xl font-semibold text-ink">My account</h1>
          </div>
        </div>

        <div className="solid-card space-y-1 p-5 text-sm">
          <p className="font-semibold text-ink">{viewer.displayName}</p>
          <p className="text-ink-muted">Login ID <span className="font-mono font-semibold text-ink">{viewer.loginId ?? "—"}</span></p>
          <p className="text-ink-muted">Access <span className="font-medium text-ink">{viewer.role === "admin" ? "Administrator" : viewer.role === "teacher" ? "Teacher" : "Student"}</span></p>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[13px] text-ink-muted">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-lagoon" aria-hidden />
          <span>
            <Link href={SET_PASSWORD_ROUTE} className="font-medium text-lagoon hover:text-sapphire">Change your password</Link>
            {" "}— you&apos;ll need your current one. Forgot it? Contact the school office.
          </span>
        </div>

        {status === "unavailable" && (
          <p className="rounded-xl border border-line bg-white px-4 py-3 text-[13px] text-ink-muted">{notice}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={async () => { await logout(); router.replace("/login"); }}><LogOut className="h-4 w-4" /> Sign out</Button>
          {user && (
            <Link href={landingRouteFor(user)} className="inline-flex items-center gap-1.5 text-sm font-medium text-lagoon hover:text-sapphire">
              Go to my portal <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

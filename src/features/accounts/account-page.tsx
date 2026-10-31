"use client";
/**
 * /account — the signed-in person's own account: Login ID, school and
 * password change. Works for every valid account, including ones whose portal
 * data is not available in this build yet, so a new user can always replace
 * the temporary password they were given. Protected by src/proxy.ts.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, LogOut } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/session-provider";
import { PasswordCard } from "@/features/profile/password-card";
import { landingRouteFor } from "@/lib/permissions";

export function AccountPage() {
  const { status, user, viewer, notice, mustChangePassword, logout } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?next=/account");
  }, [status, router]);

  // After the mandatory first-login password change, continue to the portal
  // (the server lifts PASSWORD_CHANGE_REQUIRED as soon as the change succeeds).
  const wasForced = useRef(false);
  useEffect(() => {
    if (mustChangePassword) wasForced.current = true;
    else if (wasForced.current && status === "authenticated" && user) {
      wasForced.current = false;
      router.replace(landingRouteFor(user));
    }
  }, [mustChangePassword, status, user, router]);

  if (status === "loading" || status === "unauthenticated") {
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

        {mustChangePassword && (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-lagoon/25 bg-teal-soft px-4 py-3 text-[13px] text-lagoon">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              You signed in with a temporary password. Choose your own password to continue — the rest of the portal stays locked until you do.
              {viewer.temporaryPasswordExpiresAt && <> The temporary password expires on {new Date(viewer.temporaryPasswordExpiresAt).toLocaleString()}.</>}
            </span>
          </div>
        )}

        <div className="solid-card space-y-1 p-5 text-sm">
          <p className="font-semibold text-ink">{viewer.displayName}</p>
          <p className="text-ink-muted">Login ID <span className="font-mono font-semibold text-ink">{viewer.loginId ?? "—"}</span></p>
          <p className="text-ink-muted">Access <span className="font-medium text-ink">{viewer.role === "admin" ? "Administrator" : viewer.role === "teacher" ? "Teacher" : "Student"}</span></p>
        </div>

        <PasswordCard />

        {status === "unavailable" && (
          <p className="rounded-xl border border-line bg-white/60 px-4 py-3 text-[13px] text-ink-muted">{notice}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={async () => { await logout(); router.replace("/login"); }}><LogOut className="h-4 w-4" /> Sign out</Button>
          {user && !mustChangePassword && (
            <Link href={landingRouteFor(user)} className="inline-flex items-center gap-1.5 text-sm font-medium text-lagoon hover:text-sapphire">
              Go to my portal <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

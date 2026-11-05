"use client";
/**
 * /set-password — replace the password (SEC-01).
 *
 *  - Forced: a session signed in with an issued/temporary password
 *    (status "passwordChange") lands here and can open nothing else; AppShell
 *    redirects every portal route (e.g. /student/dashboard) back here and the
 *    server refuses school data with PASSWORD_CHANGE_REQUIRED.
 *  - Voluntary: any signed-in person can change their password (linked from /account).
 *
 * The current password is required; the server (convex/account.ts
 * changePassword) verifies it, enforces the policy, stores only Convex Auth's
 * salted Scrypt hash, clears the flag and signs out the person's other sessions.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LogOut } from "lucide-react";
import { api } from "@convex/_generated/api";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { getAppError } from "@/lib/convex/errors";
import { landingRouteFor } from "@/lib/permissions";
import { isConvexConfigured } from "@/lib/convex/config";
import { useSession } from "./session-provider";
import { OWN_PASSWORD_RULE, setPasswordSchema, type SetPasswordValues } from "./set-password-form";

export function SetPasswordScreen() {
  // Without a backend nobody is signed in (the proxy already redirects to /login).
  if (!isConvexConfigured) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-4" role="alert">
        <p className="text-sm text-ink-soft">Sign-in is not available: the school backend is not configured for this deployment.</p>
      </div>
    );
  }
  return <SetPasswordForm />;
}

function SetPasswordForm() {
  const { status, user, viewer, passwordChange, logout } = useSession();
  const router = useRouter();
  const changePassword = useAction(api.account.changePassword);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const forced = status === "passwordChange";
  const loginId = passwordChange?.loginId ?? viewer?.loginId ?? null;
  const schema = useMemo(() => setPasswordSchema(loginId), [loginId]);
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<SetPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?next=/set-password");
    // After a forced change the session becomes "authenticated": continue to the portal.
    else if (done && status === "authenticated" && user) router.replace(landingRouteFor(user));
    else if (done && status === "unavailable") router.replace("/account");
  }, [status, user, done, router]);

  const onSubmit = async (values: SetPasswordValues) => {
    setError(null);
    try {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      setDone(true);
    } catch (e) {
      const app = getAppError(e);
      if (app?.fields?.currentPassword) setFieldError("currentPassword", { message: app.fields.currentPassword });
      if (app?.fields?.newPassword) setFieldError("newPassword", { message: app.fields.newPassword });
      setError(app?.message ?? "We couldn't change your password. Please try again.");
    }
  };

  const signOut = async () => { await logout(); router.replace("/login"); };

  if (status === "loading" || status === "unauthenticated" || (done && forced)) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg" role="status" aria-label="Checking your session">
        <LogoMark size={44} className="animate-pulse" />
      </div>
    );
  }

  const who = passwordChange?.displayName ?? viewer?.displayName ?? null;
  const schoolName = passwordChange?.schoolName ?? viewer?.school.name ?? null;

  return (
    <main className="ambient grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-[460px]">
        <div className="glass rounded-2xl px-6 pb-7 pt-8 sm:px-9">
          <div className="flex flex-col items-center text-center">
            <LogoMark size={48} />
            {schoolName && <p className="mt-4 font-display text-[14px] font-semibold uppercase tracking-[0.22em] text-sapphire">{schoolName}</p>}
            <h1 className="mt-3 text-[24px] font-semibold text-sapphire">{forced ? "Set your password" : "Change your password"}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {forced
                ? "Your school gave you a temporary password. Choose your own to continue."
                : "Enter your current password, then choose a new one."}
            </p>
            {who && (
              <p className="mt-2 text-[13px] text-ink-muted">
                {who}{loginId && <> · <span className="font-mono font-semibold text-ink">{loginId}</span></>}
              </p>
            )}
          </div>

          {done ? (
            <div className="mt-7 space-y-4 text-center" role="status">
              <CheckCircle2 className="mx-auto h-8 w-8 text-lagoon" aria-hidden />
              <p className="text-sm text-ink">Your password was changed. Other devices were signed out.</p>
              <Link href={user ? landingRouteFor(user) : "/account"} className="inline-flex items-center gap-1.5 text-sm font-medium text-lagoon hover:text-sapphire">
                Continue <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-5">
              <FormField label={forced ? "Temporary password" : "Current password"} required error={errors.currentPassword?.message}>
                <Input type={show ? "text" : "password"} autoComplete="current-password" {...register("currentPassword")} />
              </FormField>
              <FormField label="New password" required hint={OWN_PASSWORD_RULE} error={errors.newPassword?.message}>
                <Input type={show ? "text" : "password"} autoComplete="new-password" {...register("newPassword")} />
              </FormField>
              <FormField label="Confirm new password" required error={errors.confirmPassword?.message}>
                <Input type={show ? "text" : "password"} autoComplete="new-password" {...register("confirmPassword")} />
              </FormField>
              <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {show ? "Hide passwords" : "Show passwords"}
              </button>

              {error && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-purple/25 bg-blush/40 px-3.5 py-3 text-[13px] text-plum">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
                {isSubmitting ? "Saving…" : <><KeyRound className="h-4 w-4" /> Save password</>}
              </Button>
            </form>
          )}

          <div className="mt-5 flex items-center justify-between gap-3 text-[13px]">
            <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 font-medium text-ink-muted hover:text-ink">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
            {!forced && !done && (
              <Link href="/account" className="font-medium text-lagoon hover:text-sapphire">Back to my account</Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

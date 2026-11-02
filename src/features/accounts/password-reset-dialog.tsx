"use client";
/**
 * Administrator password overwrite (convex/credentials.ts), in three steps:
 *  1. type a new password or generate one;
 *  2. a one-time code is emailed to the ADMINISTRATOR's own address and must
 *     be entered here to authorize the change;
 *  3. the new password is shown once (with copy) to hand to the person.
 * Nothing is kept after the dialog closes. The server enforces everything
 * (admin role + users:manage, code expiry, single use, attempt limit) and
 * writes the PASSWORD_OVERWRITE audit entry.
 */
import { useState, type ComponentProps } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Check, Copy, Eye, EyeOff, MailCheck, ShieldAlert, Wand2 } from "lucide-react";
import { Button, FormField, Input, Modal, useToast } from "@/components/ui";
import { useSchoolAction } from "@/lib/convex/membership";
import { errorMessage, getAppError } from "@/lib/convex/errors";
import { cn } from "@/lib/utils/cn";

export type ResetTarget = { membershipId: Id<"schoolMemberships">; name: string; loginId: string | null };

const RULE_HINT = "At least 8 characters, with a letter and a number";
const meetsRule = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

/** Same shape as the server's generateSecurePassword (convex/model/accounts.ts): 12 unambiguous characters, e.g. "Kq7m-x3Rt-9pWd". */
export function generateSecurePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const limit = 65536 - (65536 % alphabet.length);
  for (;;) {
    const chars: string[] = [];
    while (chars.length < 12) {
      const buf = new Uint16Array(16);
      crypto.getRandomValues(buf);
      for (const x of buf) if (x < limit && chars.length < 12) chars.push(alphabet[x % alphabet.length]);
    }
    const pw = `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
    if (meetsRule(pw)) return pw;
  }
}

/** Password input with a show/hide toggle. Forwards the props FormField injects (id, aria-*, invalid). */
function PasswordInput({ shown, onToggle, className, ...props }: Omit<ComponentProps<typeof Input>, "type"> & { shown: boolean; onToggle: () => void }) {
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className={cn("pr-11 font-mono", className)} />
      <button
        type="button" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
        className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-bg hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

type Step =
  | { kind: "password" }
  | { kind: "otp"; challengeId: Id<"credentialOtps">; sentTo: string; loginId: string }
  | { kind: "done"; loginId: string };

export function PasswordResetDialog({ target, onClose }: { target: ResetTarget | null; onClose: () => void }) {
  return target ? <ResetFlow key={target.membershipId} target={target} onClose={onClose} /> : null;
}

function ResetFlow({ target, onClose }: { target: ResetTarget; onClose: () => void }) {
  const { toast } = useToast();
  const requestOtp = useSchoolAction(api.credentials.requestPasswordOverwriteOtp);
  const verify = useSchoolAction(api.credentials.verifyOtpAndSetPassword);
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: "password" | "code"; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    if (!meetsRule(password)) { setError({ field: "password", message: `Use ${RULE_HINT.toLowerCase()}` }); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await requestOtp({ targetMembershipId: target.membershipId });
      setCode("");
      setStep({ kind: "otp", challengeId: r.challengeId, sentTo: r.sentTo, loginId: r.targetLoginId });
    } catch (e) {
      setError({ message: errorMessage(e, "We couldn't send the code. Please try again.") });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (step.kind !== "otp") return;
    if (!/^\d{6}$/.test(code)) { setError({ field: "code", message: "Enter the 6-digit code" }); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await verify({ challengeId: step.challengeId, code, newPassword: password });
      setStep({ kind: "done", loginId: r.loginId });
      toast({ title: "Password updated", description: `${r.displayName} was signed out everywhere.` });
    } catch (e) {
      const app = getAppError(e);
      setError({ field: app?.fields?.code ? "code" : app?.fields?.newPassword ? "password" : undefined, message: errorMessage(e, "We couldn't update the password. Please try again.") });
      if (app?.fields?.newPassword) setStep({ kind: "password" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (loginId: string) => {
    try {
      await navigator.clipboard.writeText(`Login ID: ${loginId}\nPassword: ${password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the values stay visible */
    }
  };

  const close = () => { setPassword(""); setCode(""); onClose(); };
  const footer =
    step.kind === "password" ? (
      <>
        <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
        <Button onClick={send} loading={busy}>Send code to my email</Button>
      </>
    ) : step.kind === "otp" ? (
      <>
        <Button variant="outline" onClick={() => { setStep({ kind: "password" }); setError(null); }} disabled={busy}>Back</Button>
        <Button onClick={confirm} loading={busy}>Confirm and update</Button>
      </>
    ) : (
      <Button onClick={close}>Done</Button>
    );

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o && !busy) close(); }}
      title={step.kind === "done" ? "Password updated" : `Reset password — ${target.name}`}
      description={step.kind === "password" ? `Login ID ${target.loginId ?? "—"}. ${target.name} will be signed out everywhere.` : undefined}
      size="sm"
      footer={footer}
    >
      {step.kind === "password" && (
        <div className="space-y-4" data-testid="reset-password-step">
          <FormField label="New password" required hint={RULE_HINT} error={error?.field === "password" ? error.message : undefined}>
            <PasswordInput
              shown={shown} onToggle={() => setShown((s) => !s)} autoComplete="new-password" value={password}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
            />
          </FormField>
          <Button variant="soft" size="sm" onClick={() => { setPassword(generateSecurePassword()); setShown(true); setError(null); }}>
            <Wand2 className="h-4 w-4" /> Generate secure password
          </Button>
          <p className="flex items-start gap-2 text-[12.5px] text-ink-muted">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-lagoon" aria-hidden />
            To confirm it&apos;s you, we&apos;ll email a one-time code to your administrator email address.
          </p>
          {error && !error.field && <p role="alert" className="text-[13px] text-pd-danger">{error.message}</p>}
        </div>
      )}

      {step.kind === "otp" && (
        <div className="space-y-4" data-testid="reset-otp-step">
          <p className="text-sm text-ink-soft">
            Enter the 6-digit OTP sent to <span className="font-semibold text-ink">{step.sentTo}</span> to authorize the credential update for{" "}
            <span className="font-mono font-semibold text-ink">{step.loginId}</span>.
          </p>
          <FormField label="One-time code" required error={error?.field === "code" ? error.message : undefined}>
            <Input
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} placeholder="000000"
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); if (error) setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
              className="font-mono tracking-[0.4em]"
            />
          </FormField>
          <p className="text-[12.5px] text-ink-muted">
            The code expires in 10 minutes and works once.{" "}
            <button type="button" onClick={send} disabled={busy} className="font-medium text-lagoon hover:underline disabled:opacity-50">Send a new code</button>
          </p>
          {error && !error.field && <p role="alert" className="text-[13px] text-pd-danger">{error.message}</p>}
        </div>
      )}

      {step.kind === "done" && (
        <div className="space-y-4" data-testid="reset-done-step">
          <div role="note" className="flex items-start gap-2.5 rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>This password is shown only now and is not stored anywhere readable. Share it privately with {target.name}.</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/80 bg-white px-4 py-3">
            <p className="text-[13px] text-ink-muted">
              Login ID <span className="font-mono font-semibold text-ink">{step.loginId}</span>
              <span className="mx-2 text-line">|</span>
              Password <span className="font-mono font-semibold text-ink" data-testid="reset-new-password">{password}</span>
            </p>
            <Button variant="ghost" size="sm" onClick={() => copy(step.loginId)} aria-label="Copy the new credentials">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} <span className={cn(copied && "text-lagoon")}>{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

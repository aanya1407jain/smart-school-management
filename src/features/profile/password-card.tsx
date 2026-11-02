"use client";
/**
 * Change the signed-in account's password (Convex Auth: account.changePassword
 * verifies the current password and stores only the new hash).
 *  - PasswordSecurity: a compact "Password & Security" settings row whose button
 *    expands the form in place (Settings, and the profile pages without Settings).
 *  - PasswordCard: the same form always open (the /account page, where a
 *    temporary password must be changed before anything else).
 */
import { useCallback, useId, useState, type ComponentProps } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { ChevronDown, Eye, EyeOff, KeyRound } from "lucide-react";
import { getAppError } from "@/lib/convex/errors";
import { useMutation } from "@/lib/hooks/use-mutation";
import { FieldError } from "@/lib/utils/errors";
import { cn } from "@/lib/utils/cn";
import { Button, Card, CardHeader, FormField, Input, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";

const EMPTY = { current: "", next: "", confirm: "" };
const RULE_HINT = "At least 8 characters, with a letter and a number";

/** Password input with a show/hide toggle. Forwards the props FormField injects (id, aria-*, invalid). */
function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className={cn("pr-11", className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-bg hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

/** Client checks that mirror the server's rule, so mistakes show before a round trip. */
function validate(f: typeof EMPTY): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.current) e.current = "Enter your current password";
  if (f.next.length < 8 || !/[A-Za-z]/.test(f.next) || !/\d/.test(f.next)) e.next = `Use ${RULE_HINT.toLowerCase()}`;
  if (!f.confirm) e.confirm = "Re-enter the new password";
  else if (f.confirm !== f.next) e.confirm = "Passwords don't match";
  return e;
}

function usePasswordChange() {
  const changePasswordAction = useAction(api.account.changePassword);
  const changePassword = useCallback(async (input: { current: string; next: string }) => {
    try {
      return await changePasswordAction({ currentPassword: input.current, newPassword: input.next });
    } catch (e) {
      const app = getAppError(e);
      if (app) throw new FieldError(app.code === "INVALID_ARGUMENT" ? "VALIDATION" : app.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", app.message, app.fields);
      throw new Error("We couldn't change your password. Please try again.");
    }
  }, [changePasswordAction]);
  return useMutation(changePassword);
}

/** The three fields, validation, submit and (optionally) cancel. `onDone` runs after a successful change. */
function PasswordForm({ onDone, onCancel, submitLabel }: { onDone?: () => void; onCancel?: () => void; submitLabel: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = usePasswordChange();
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: "" });
  };
  const fieldError = (k: "current" | "next" | "confirm") =>
    errors[k] || (k === "current" ? m.fieldErrors.current ?? m.fieldErrors.currentPassword : k === "next" ? m.fieldErrors.next ?? m.fieldErrors.newPassword : undefined) || undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.values(v).some(Boolean)) return;
    if (await m.mutate({ current: form.current, next: form.next })) {
      toast({ title: "Password changed", description: "Use your new password the next time you sign in." });
      setForm(EMPTY);
      onDone?.();
    }
  };
  const cancel = () => { setForm(EMPTY); setErrors({}); m.reset(); onCancel?.(); };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormField label="Current password" required error={fieldError("current")}>
        <PasswordInput autoComplete="current-password" value={form.current} onChange={set("current")} />
      </FormField>
      <FormField label="New password" required hint={RULE_HINT} error={fieldError("next")}>
        <PasswordInput autoComplete="new-password" value={form.next} onChange={set("next")} />
      </FormField>
      <FormField label="Confirm new password" required error={fieldError("confirm")}>
        <PasswordInput autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
      </FormField>
      <FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} />
      <div className={cn("flex flex-col-reverse gap-2 sm:flex-row", onCancel && "sm:justify-end")}>
        {onCancel && <Button type="button" variant="outline" onClick={cancel} disabled={m.isPending}>Cancel</Button>}
        <Button type="submit" loading={m.isPending} className={onCancel ? undefined : "w-full"}>{submitLabel}</Button>
      </div>
    </form>
  );
}

/** Compact settings row: label and helper text on the left, a button that expands the form below. */
export function PasswordSecurity({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <Card className={cn("h-fit", className)} data-testid="password-security">
      {/* Wraps by available width (not viewport): the button drops below the text in a narrow column. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-5">
        <div className="flex min-w-[14rem] flex-1 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-soft text-lagoon" aria-hidden><KeyRound className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">Password &amp; Security</h2>
            <p className="text-[13px] text-ink-muted">Update your account password</p>
          </div>
        </div>
        <Button variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)} className="shrink-0">
          Change password <ChevronDown className={cn("h-4 w-4 transition-transform duration-150", open && "rotate-180")} aria-hidden />
        </Button>
      </div>
      {open && (
        <div id={panelId} className="border-t border-line p-5">
          <PasswordForm submitLabel="Update password" onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </div>
      )}
    </Card>
  );
}

/** The always-open form (the /account page). */
export function PasswordCard() {
  return (
    <Card className="h-fit">
      <CardHeader title="Password" icon={<KeyRound className="h-4 w-4" />} />
      <div className="p-5">
        <PasswordForm submitLabel="Change password" />
      </div>
    </Card>
  );
}

"use client";
/** Change the signed-in account's password (Convex Auth). Shared by every profile/account page. */
import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { KeyRound } from "lucide-react";
import { getAppError } from "@/lib/convex/errors";
import { useMutation } from "@/lib/hooks/use-mutation";
import { FieldError } from "@/lib/utils/errors";
import { Button, Card, CardHeader, FormField, Input, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";

export function PasswordCard() {
  const { toast } = useToast();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [mismatch, setMismatch] = useState(false);
  // Convex Auth verifies the current password and stores only the new hash.
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
  const m = useMutation(changePassword);
  return (
    <Card className="h-fit">
      <CardHeader title="Password" icon={<KeyRound className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        <FormField label="Current password" error={m.fieldErrors.current}><Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></FormField>
        <FormField label="New password" hint="At least 8 characters, with a letter and a number" error={m.fieldErrors.next}><Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></FormField>
        <FormField label="Confirm new password" error={mismatch ? "Passwords don't match" : undefined}><Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></FormField>
        <FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} />
        <Button className="w-full" loading={m.isPending} onClick={async () => {
          setMismatch(form.next !== form.confirm);
          if (form.next !== form.confirm) return;
          if (await m.mutate({ current: form.current, next: form.next })) { toast({ title: "Password changed" }); setForm({ current: "", next: "", confirm: "" }); }
        }}>Change password</Button>
      </div>
    </Card>
  );
}

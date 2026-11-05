/**
 * Set-password form rules (SEC-01). Mirrors the server policy in
 * convex/auth.ts validateOwnPassword — the server re-checks everything; this
 * only gives immediate feedback.
 *
 * Relative imports on purpose: unit-tested without the app's path aliases.
 */
import { z } from "zod";

export const OWN_PASSWORD_RULE = "Use at least 8 characters with a letter, a number and a symbol.";

/** The first unmet rule for a new password, or null. */
export function newPasswordProblem(password: string, loginId: string | null): string | null {
  if (password.length < 8) return "At least 8 characters";
  if (password.length > 128) return "At most 128 characters";
  if (!/[A-Za-z]/.test(password)) return "Add a letter";
  if (!/\d/.test(password)) return "Add a number";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Add a symbol (e.g. ! @ # -)";
  if (loginId && password.toLowerCase().includes(loginId.toLowerCase())) return "Must not contain your Login ID";
  return null;
}

export function setPasswordSchema(loginId: string | null) {
  return z
    .object({
      currentPassword: z.string().min(1, "Enter your current (temporary) password"),
      newPassword: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((v, ctx) => {
      const problem = newPasswordProblem(v.newPassword, loginId);
      if (problem) ctx.addIssue({ code: "custom", path: ["newPassword"], message: problem });
      else if (v.newPassword === v.currentPassword) ctx.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a different password" });
      if (v.confirmPassword !== v.newPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords don't match" });
    });
}
export type SetPasswordValues = z.infer<ReturnType<typeof setPasswordSchema>>;

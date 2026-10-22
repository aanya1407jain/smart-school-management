/**
 * Sign-in form rules and sign-in error messages, shared by the login screen and
 * the session provider (and unit-tested in tests/convex/login-form.test.ts).
 *
 * People sign in with the LOGIN ID their school issued (ADMIN-001, TCH-00001,
 * STU-2026-00001) — never with an email address. The form accepts
 * any value that canonicalises to a valid Login ID (case and surrounding spaces
 * are ignored); the server applies the same rule (convex/model/loginIds.ts).
 *
 * Relative imports on purpose: this module is imported by unit tests that run
 * without the app's path aliases.
 */
import { z } from "zod";
import { canonicalLoginId } from "../../../convex/model/loginIds";
import { getAppError } from "../../lib/convex/errors";

export const loginFormSchema = z.object({
  loginId: z.string().trim().min(1, "Enter your Login ID").refine((v) => canonicalLoginId(v) !== null, "Enter the Login ID given by your school (e.g. TCH-00124)"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});
export type LoginFormValues = z.infer<typeof loginFormSchema>;

/** One message for an unknown Login ID and a wrong password: never reveal whether an account exists. */
export const SIGN_IN_FAILED = "The Login ID or password you entered is incorrect.";

export function signInErrorMessage(error: unknown): string {
  const app = getAppError(error);
  if (app?.code === "NO_SCHOOL_ACCESS" || app?.code === "TEMPORARY_PASSWORD_EXPIRED" || app?.code === "LOGIN_ID_REQUIRED") return app.message;
  const raw = error instanceof Error ? error.message : String(error);
  if (/TooManyFailedAttempts/.test(raw)) return "Too many incorrect attempts. Please wait a while and try again.";
  if (/NO_SCHOOL_ACCESS/.test(raw)) return "Your account does not have active access to any school.";
  if (/TEMPORARY_PASSWORD_EXPIRED/.test(raw)) return "This temporary password has expired. Ask your school office for a new one.";
  if (/LOGIN_ID_REQUIRED/.test(raw)) return "This sign-in page is out of date. Reload the page and sign in with your Login ID.";
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(raw)) return SIGN_IN_FAILED;
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return "We couldn't reach the server. Check your connection and try again.";
  return SIGN_IN_FAILED;
}

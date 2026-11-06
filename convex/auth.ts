/**
 * Authentication — Convex Auth, password accounts identified by LOGIN ID.
 *
 * People sign in with a Login ID issued by their school ("TCH-00124") and a
 * password. Email is optional contact information and is never a sign-in
 * identifier.
 *
 * How this maps onto Convex Auth's Password provider (0.0.96):
 *  - The provider's account identifier (its `email` param/profile field) is
 *    only the `authAccounts.providerAccountId` key; nothing is emailed and no
 *    email format is required while verify/reset are not configured. We set it
 *    to the CANONICAL Login ID (convex/model/loginIds.ts). Hashing (Scrypt),
 *    session issuance and the built-in failed-sign-in rate limit are unchanged.
 *  - There is NO self-registration and NO self-service recovery: the provider
 *    has no `reset`/`verify` email configured, and `validatePasswordRequirements`
 *    — invoked only for client flows that would set a password (signUp,
 *    reset-verification) — always refuses. Accounts are created exclusively
 *    server-side (convex/model/accounts.ts → createAccount) by an authorized
 *    admin action, a data import, the deployment setup or the demo seed, and
 *    `createOrUpdateUser` additionally requires a reserved membership.
 *  - Issued passwords are temporary: a signed-in person replaces their own
 *    password with convex/account.ts changePassword (current password
 *    required). Administrators overwrite forgotten passwords
 *    (convex/credentials.ts, authorized by an emailed one-time code).
 *  - A session is only created for an enabled user with at least one ACTIVE
 *    membership in an ACTIVE school.
 *
 * Client usage: `useAuthActions().signIn("password", { loginId, password, flow: "signIn" })`.
 */
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { AppError, invalid } from "./core/errors";
import { canonicalLoginId } from "./model/loginIds";
import { activatePendingAccount, assertSessionAllowed } from "./model/accounts";
import { activeMembershipsOf } from "./core/actor";
import { writeAudit } from "./model/audit";

/** Password policy for administrator-set passwords (credentials.verifyOtpAndSetPassword). */
export function validatePassword(password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw invalid("Use at least 8 characters, including a letter and a number.", { password: "Too weak" });
  }
}

export const OWN_PASSWORD_RULE = "Use at least 8 characters with a letter, a number and a symbol.";
/** Most characters a password may have (bounds the Scrypt work per request). */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Password policy for a password the owner chooses (passwords.changePassword):
 * at least 8 characters with a letter, a digit and a symbol; not the Login ID.
 * Mirrored in the browser by src/features/auth/set-password-form.ts.
 */
export function validateOwnPassword(password: string, loginId: string | null) {
  const problem =
    password.length < 8 ? "Too short"
      : password.length > MAX_PASSWORD_LENGTH ? "Too long"
        : !/[A-Za-z]/.test(password) ? "Add a letter"
          : !/\d/.test(password) ? "Add a number"
            : !/[^A-Za-z0-9\s]/.test(password) ? "Add a symbol"
              : loginId && password.toLowerCase().includes(loginId.toLowerCase()) ? "Must not contain your Login ID"
                : null;
  if (problem) throw invalid(OWN_PASSWORD_RULE, { newPassword: problem });
}

const LoginIdPassword = Password({
  // Account identifier = canonical Login ID. Unknown/malformed IDs map to ""
  // which matches no account (sign-in fails like a wrong password).
  profile(params) {
    // A request without `loginId` comes from an outdated, email-based sign-in
    // page (e.g. a stale `next build`). Never look an email up as an account
    // id: before this check it silently became "" and Convex Auth reported the
    // misleading "InvalidAccountId". The error depends only on the request's
    // shape, so it reveals nothing about which accounts exist.
    if (params.loginId === undefined) {
      throw new AppError("LOGIN_ID_REQUIRED", "This sign-in page is out of date. Reload the page and sign in with your Login ID.");
    }
    return { email: canonicalLoginId(params.loginId) ?? "" };
  },
  validatePasswordRequirements() {
    throw new AppError("FORBIDDEN", "Accounts are created by your school. Contact the school office for your Login ID.");
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [LoginIdPassword],
  callbacks: {
    /**
     * Runs only when a NEW account is created (server-side createAccount).
     * Existing accounts signing in return early.
     */
    async createOrUpdateUser(rawCtx, args) {
      const ctx = rawCtx as unknown as MutationCtx;
      if (args.existingUserId) return args.existingUserId as Id<"users">;
      if (args.type !== "credentials") {
        throw new AppError("FORBIDDEN", "This sign-in method is not enabled.");
      }
      const loginId = canonicalLoginId(args.profile.loginId);
      if (!loginId) throw new AppError("FORBIDDEN", "Accounts are created by your school.");
      return await activatePendingAccount(ctx, { loginId, requiresPasswordChange: args.profile.requiresPasswordChange === true });
    },

    /**
     * Gate every new session (runs after the password was verified):
     * disabled users and users without an active membership in an active
     * school get no session. An allowed sign-in is audited ("auth.signed_in")
     * in every school the person has active access to. (Token refreshes do
     * not create sessions, so they are not logged.)
     */
    async beforeSessionCreation(rawCtx, { userId }) {
      const ctx = rawCtx as unknown as MutationCtx;
      await assertSessionAllowed(ctx, userId as Id<"users">);
      for (const { membership: m } of await activeMembershipsOf(ctx, userId as Id<"users">)) {
        await writeAudit(ctx, {
          schoolId: m.schoolId, actor: { userId: m.userId!, role: m.role, displayName: m.displayName },
          action: "auth.signed_in", entity: { table: "schoolMemberships", id: m._id },
          summary: `${m.displayName}${m.loginId ? ` (${m.loginId})` : ""} signed in`,
          metadata: { ...(m.loginId ? { targetLoginId: m.loginId } : {}), method: "password" },
        });
      }
    },
  },
});

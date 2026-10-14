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
 *  - There is NO self-registration. `validatePasswordRequirements` is only
 *    invoked for client flows that would set a password (signUp,
 *    reset-verification); it always refuses. Accounts are created exclusively
 *    server-side (convex/model/accounts.ts → createAccount) by an authorized
 *    admin action, a data import, the deployment setup or the demo seed, and
 *    `createOrUpdateUser` additionally requires a reserved membership.
 *  - A session is only created for an enabled user with at least one ACTIVE
 *    membership in an ACTIVE school, and never with an expired temporary
 *    password (model/accounts.ts TEMPORARY_PASSWORD_TTL_MS).
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

/** Password policy for school accounts (used by account.changePassword and temporary passwords). */
export function validatePassword(password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw invalid("Use at least 8 characters, including a letter and a number.", { password: "Too weak" });
  }
}

const LoginIdPassword = Password({
  // Account identifier = canonical Login ID. Unknown/malformed IDs map to ""
  // which matches no account (sign-in fails like a wrong password).
  profile(params) {
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
      return await activatePendingAccount(ctx, { loginId, mustChangePassword: args.profile.mustChangePassword === true });
    },

    /**
     * Gate every new session (runs after the password was verified):
     * disabled users, users without an active membership in an active school,
     * and expired temporary passwords get no session.
     */
    async beforeSessionCreation(rawCtx, { userId }) {
      const ctx = rawCtx as unknown as MutationCtx;
      await assertSessionAllowed(ctx, userId as Id<"users">, Date.now());
    },
  },
});

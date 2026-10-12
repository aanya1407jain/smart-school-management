/**
 * Authentication — Convex Auth with the Password provider.
 *
 * Identity model:
 *  - `users` = global login identity. `schoolMemberships` = access to a school.
 *  - There is NO open self-registration. An account can only be created
 *    ("signUp" flow) with a valid, unexpired invitation code issued for that
 *    email by a school (see convex/memberships.ts → invite), or by the seed.
 *  - A session is only created for a non-disabled user with at least one
 *    ACTIVE membership in an ACTIVE school.
 *
 * Client usage (Next.js): `useAuthActions().signIn("password", { email, password, flow: "signIn" })`
 * or `{ flow: "signUp", inviteCode }` to activate an invitation.
 */
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { normalizeEmail } from "./core/validators";
import { AppError, invalid } from "./core/errors";
import { activateInvitationsForNewUser, hasActiveAccess } from "./model/memberships";

/** Password policy for school accounts (also used by account.changePassword). */
export function validatePassword(password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw invalid("Use at least 8 characters, including a letter and a number.", { password: "Too weak" });
  }
}

const SchoolPassword = Password({
  // Called for every flow. Normalising here makes "Admin@School.edu " and
  // "admin@school.edu" the same account id.
  profile(params) {
    const email = normalizeEmail(String(params.email ?? ""));
    const inviteCode = typeof params.inviteCode === "string" ? params.inviteCode.trim() : undefined;
    // `inviteCode` is not stored on the user; it is consumed by createOrUpdateUser below.
    return { email, ...(inviteCode ? { inviteCode } : {}) } as { email: string };
  },
  validatePasswordRequirements: validatePassword,
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [SchoolPassword],
  callbacks: {
    /**
     * Runs only when a NEW account is created (signUp). Existing accounts
     * signing in return early. We create the user ourselves so we can enforce
     * invitation-only registration.
     */
    async createOrUpdateUser(rawCtx, args) {
      const ctx = rawCtx as unknown as MutationCtx;
      if (args.existingUserId) return args.existingUserId as Id<"users">;
      if (args.type !== "credentials") {
        throw new AppError("FORBIDDEN", "This sign-in method is not enabled.");
      }
      const email = String(args.profile.email ?? "");
      const inviteCode = typeof args.profile.inviteCode === "string" ? args.profile.inviteCode : "";
      return await activateInvitationsForNewUser(ctx, { email, inviteCode });
    },

    /** Gate every new session (sign-in, refresh-less new sessions). */
    async beforeSessionCreation(rawCtx, { userId }) {
      const ctx = rawCtx as unknown as MutationCtx;
      if (!(await hasActiveAccess(ctx, userId as Id<"users">))) {
        throw new AppError("NO_SCHOOL_ACCESS", "Your account does not have active access to any school.");
      }
    },
  },
});

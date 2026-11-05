/**
 * Self-service password change (SEC-01) — `api.account.changePassword`.
 *
 * Every issued password (account creation, bulk runs, imports, setup, the
 * student-login migration) is random and TEMPORARY: the user row carries
 * `requiresPasswordChange` (or the legacy `defaultPassword` marker of the
 * removed shared student default). Until the owner replaces it, every school
 * function refuses with PASSWORD_CHANGE_REQUIRED (core/actor.ts requireActor)
 * and the UI sends them to /set-password.
 *
 * `changePassword` is an ACTION, not a mutation: Convex Auth verifies and
 * hashes passwords (salted Scrypt) only from actions (retrieveAccount /
 * modifyAccountCredentials). It requires:
 *   - an active session (the session row must still exist; disabled users refused),
 *   - the CURRENT password, verified by Convex Auth — wrong guesses count against
 *     the same per-account limit as sign-in (TooManyFailedAttempts),
 *   - a new password meeting auth.ts validateOwnPassword (8+ chars, letter,
 *     number, symbol; not the Login ID; different from the current one).
 * The new password is stored only as Convex Auth's salted Scrypt hash. On
 * success the flag is cleared, the person's OTHER sessions are signed out and
 * an audit entry is written in each of their schools. Passwords never appear
 * in logs, audit rows or return values.
 */
import { v } from "convex/values";
import { getAuthSessionId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { activeMembershipsOf, requireAuthenticatedUser } from "./core/actor";
import { AppError, invalid, unauthenticated } from "./core/errors";
import { MAX_PASSWORD_LENGTH, validateOwnPassword } from "./auth";
import { PASSWORD_PROVIDER, passwordIssuedFields } from "./model/accounts";
import { writeAudit } from "./model/audit";

/** The signed-in person changing their own password (runs with the caller's identity). */
export const selfForPasswordChange = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ userId: Id<"users">; sessionId: Id<"authSessions">; loginId: string }> => {
    const user = await requireAuthenticatedUser(ctx); // session row must exist; disabled users refused
    const sessionId = await getAuthSessionId(ctx);
    if (!sessionId) throw unauthenticated();
    if (!user.loginId) throw invalid("This account has no Login ID. Contact the school office.");
    return { userId: user._id, sessionId, loginId: user.loginId };
  },
});

/** After the new hash is stored: clear the change-required flags and audit it (no secrets). */
export const recordOwnPasswordChange = internalMutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    const wasRequired = user.requiresPasswordChange === true || user.defaultPassword === true;
    await ctx.db.patch(user._id, passwordIssuedFields({ requiresPasswordChange: false }));
    for (const { membership } of await activeMembershipsOf(ctx, user._id)) {
      await writeAudit(ctx, {
        schoolId: membership.schoolId,
        actor: { userId: user._id, role: membership.role },
        action: "account.password_changed",
        entity: { table: "schoolMemberships", id: membership._id },
        summary: `${membership.loginId ?? user.loginId ?? ""} (${membership.displayName}) changed their own password`,
        metadata: { targetRole: membership.role, ...(membership.loginId ? { targetLoginId: membership.loginId } : {}), firstChange: wasRequired },
      });
    }
  },
});

/** Change the signed-in person's own password (current password required). */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }): Promise<{ ok: true }> => {
    const me: { userId: Id<"users">; sessionId: Id<"authSessions">; loginId: string } =
      await ctx.runQuery(internal.account.selfForPasswordChange, {});

    validateOwnPassword(newPassword, me.loginId);
    if (currentPassword.length === 0 || currentPassword.length > MAX_PASSWORD_LENGTH) {
      throw invalid("Enter your current password.", { currentPassword: "Required" });
    }
    if (newPassword === currentPassword) {
      throw invalid("Choose a password different from your current one.", { newPassword: "Same as current" });
    }

    // Verifies the current password with Convex Auth (salted Scrypt, per-account failure limit).
    let account: { account: { userId: Id<"users"> } };
    try {
      account = (await retrieveAccount(ctx, { provider: PASSWORD_PROVIDER, account: { id: me.loginId, secret: currentPassword } })) as typeof account;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      if (reason === "TooManyFailedAttempts") throw new AppError("FORBIDDEN", "Too many incorrect attempts. Wait a while and try again.");
      throw invalid("Your current password is incorrect.", { currentPassword: "Incorrect" });
    }
    if (account.account.userId !== me.userId) throw unauthenticated();

    // Stored only as Convex Auth's salted Scrypt hash.
    await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id: me.loginId, secret: newPassword } });
    await invalidateSessions(ctx, { userId: me.userId, except: [me.sessionId] });
    await ctx.runMutation(internal.account.recordOwnPasswordChange, {});
    return { ok: true };
  },
});

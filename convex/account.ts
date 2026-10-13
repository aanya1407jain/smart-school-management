/**
 * Self-service account actions for the signed-in user (no school needed).
 *
 * Passwords are verified and stored ONLY by Convex Auth (hashed in
 * `authAccounts`). The browser never sees or stores a password hash.
 */
import { v } from "convex/values";
import { getAuthSessionId, getAuthUserId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { AppError, invalid, noSchoolAccess, temporaryPasswordExpired, unauthenticated } from "./core/errors";
import { validatePassword } from "./auth";
import { PASSWORD_PROVIDER, temporaryPasswordExpiresAt } from "./model/accounts";
import { hasActiveAccess } from "./model/memberships";

/**
 * What a password change needs to know about the signed-in user (internal:
 * actions have no db access). null when the user is disabled or has no active
 * school access — such accounts cannot use the password-change endpoint.
 */
export const passwordChangeContext = internalQuery({
  args: { userId: v.id("users"), sessionId: v.id("authSessions") },
  handler: async (ctx, { userId, sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) return null; // signed out (e.g. after a reset)
    const user = await ctx.db.get(userId);
    if (!user || user.disabled || !user.loginId) return null;
    if (!(await hasActiveAccess(ctx, userId))) return null;
    return { loginId: user.loginId, temporaryPasswordExpiresAt: temporaryPasswordExpiresAt(user) };
  },
});

export const clearMustChangePassword = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user?.mustChangePassword || user?.temporaryPasswordIssuedAt !== undefined) {
      await ctx.db.patch(userId, { mustChangePassword: undefined, temporaryPasswordIssuedAt: undefined });
    }
  },
});

/**
 * Change my password. Requires the current password (rate-limited by Convex
 * Auth like sign-in). Other sessions of this user are signed out; the current
 * one stays signed in. Clears the "temporary password" flag only after the
 * new credentials are stored. Refused for disabled/suspended accounts and for
 * an expired temporary password. Works while PASSWORD_CHANGE_REQUIRED blocks
 * everything else (it does not use requireActor).
 */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw unauthenticated();
    const sessionId = await getAuthSessionId(ctx);
    if (!sessionId) throw unauthenticated();
    const account = await ctx.runQuery(internal.account.passwordChangeContext, { userId, sessionId });
    if (!account) throw noSchoolAccess();
    const { loginId } = account;
    if (account.temporaryPasswordExpiresAt !== null && Date.now() >= account.temporaryPasswordExpiresAt) throw temporaryPasswordExpired();
    try {
      validatePassword(newPassword);
    } catch {
      throw invalid("Use at least 8 characters, including a letter and a number.", { next: "At least 8 characters, with a letter and a number" });
    }
    if (newPassword === currentPassword) throw invalid("Choose a password you haven't used here.", { next: "Must differ from the current password" });

    try {
      const { user } = await retrieveAccount(ctx, { provider: PASSWORD_PROVIDER, account: { id: loginId, secret: currentPassword } });
      if (user._id !== userId) throw new Error("InvalidAccountId");
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      if (reason === "TooManyFailedAttempts") {
        throw new AppError("FORBIDDEN", "Too many incorrect attempts. Please wait and try again later.");
      }
      throw invalid("Current password is incorrect", { current: "Incorrect password" });
    }
    await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id: loginId, secret: newPassword } });
    await invalidateSessions(ctx, { userId, except: [sessionId] });
    await ctx.runMutation(internal.account.clearMustChangePassword, { userId });
    return { ok: true as const };
  },
});

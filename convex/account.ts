/**
 * Self-service account actions for the signed-in user (no school needed).
 *
 * Passwords are verified and stored ONLY by Convex Auth (hashed in
 * `authAccounts`). The browser never sees or stores a password hash.
 */
import { v } from "convex/values";
import { getAuthSessionId, getAuthUserId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { AppError, invalid, unauthenticated } from "./core/errors";
import { validatePassword } from "./auth";

/** Login email of an enabled user (internal: actions have no db access). */
export const loginEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user && !user.disabled ? (user.email ?? null) : null;
  },
});

/**
 * Change my password. Requires the current password (rate-limited by Convex
 * Auth like sign-in). Other sessions of this user are signed out; the current
 * one stays signed in.
 */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw unauthenticated();
    const email = await ctx.runQuery(internal.account.loginEmail, { userId });
    if (!email) throw unauthenticated();
    try {
      validatePassword(newPassword);
    } catch {
      throw invalid("Use at least 8 characters, including a letter and a number.", { next: "At least 8 characters, with a letter and a number" });
    }
    if (newPassword === currentPassword) throw invalid("Choose a password you haven't used here.", { next: "Must differ from the current password" });

    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: email, secret: currentPassword } });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      if (reason === "TooManyFailedAttempts") {
        throw new AppError("FORBIDDEN", "Too many incorrect attempts. Please wait and try again later.");
      }
      throw invalid("Current password is incorrect", { current: "Incorrect password" });
    }
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: newPassword } });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
    return { ok: true as const };
  },
});

/**
 * One-off data migrations (INTERNAL — run by the deployment operator only,
 * never callable from the browser).
 *
 * removeGuardianAccounts — the guardian sign-in was removed: account roles are
 * admin, teacher and student only. Since that change, a membership carrying
 * `guardianId` already grants NO access (core/actor.ts, model/memberships.ts
 * `grantsAccess`), cannot be activated, re-enabled or given new credentials.
 * This migration deletes those leftover memberships for good, as decided:
 *
 *   - every `schoolMemberships` row with `guardianId` is DELETED (irreversible);
 *   - if that leaves the user with no membership at all, the sign-in itself is
 *     deleted too: its sessions + refresh tokens, its password account(s) +
 *     verification codes, its in-app notifications, and the `users` row;
 *   - a user who still has another membership (e.g. a teacher who also had a
 *     guardian sign-in) keeps their user row and other access untouched;
 *   - parent CONTACT data is NOT touched: `guardians` / `guardianLinks` rows stay
 *     on the students (shown as "Parent contact");
 *   - one `account.deleted` audit row per removed membership (no secrets).
 *
 * Dry run by default — it reports what it would delete and writes nothing:
 *   npx convex run migrations:removeGuardianAccounts                    # dry run
 *   npx convex run migrations:removeGuardianAccounts '{"apply":true}'   # delete
 * Bounded per call (BATCH memberships); `remaining: true` means run it again.
 * Never run it against a deployment without the owner's approval.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { writeAudit } from "./model/audit";

const BATCH = 200;

async function deleteSignIn(ctx: MutationCtx, userId: Id<"users">) {
  for (const s of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
    for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(s._id);
  }
  for (const a of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", userId)).collect()) {
    for (const c of await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", a._id)).collect()) await ctx.db.delete(c._id);
    await ctx.db.delete(a._id);
  }
  // In-app notifications addressed to the removed sign-in (nobody can read them any more).
  for (const n of await ctx.db.query("notifications").withIndex("by_user_school", (q) => q.eq("userId", userId)).collect()) await ctx.db.delete(n._id);
  await ctx.db.delete(userId);
}

export const removeGuardianAccounts = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply = false }) => {
    const rows = await ctx.db
      .query("schoolMemberships")
      .filter((q) => q.neq(q.field("guardianId"), undefined))
      .take(BATCH + 1);
    const batch = rows.slice(0, BATCH);
    const report: { loginId: string | null; status: string; signInDeleted: boolean }[] = [];
    for (const m of batch) {
      let signInDeleted = false;
      if (apply) {
        await ctx.db.delete(m._id);
        if (m.userId) {
          const others = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", m.userId!)).first();
          if (!others && (await ctx.db.get(m.userId))) {
            await deleteSignIn(ctx, m.userId);
            signInDeleted = true;
          }
        }
        await writeAudit(ctx, {
          schoolId: m.schoolId, actor: null, action: "account.deleted", entity: { table: "schoolMemberships", id: m._id },
          summary: `Removed guardian sign-in ${m.loginId ?? ""} (account type discontinued)`,
          metadata: { targetKind: "legacy_guardian", ...(m.loginId ? { targetLoginId: m.loginId } : {}), signInDeleted },
        });
      } else if (m.userId) {
        const all = await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", m.userId!)).collect();
        signInDeleted = all.every((x) => x._id === m._id);
      }
      report.push({ loginId: m.loginId ?? null, status: m.status, signInDeleted });
    }
    return { applied: apply, memberships: batch.length, remaining: rows.length > BATCH, report };
  },
});

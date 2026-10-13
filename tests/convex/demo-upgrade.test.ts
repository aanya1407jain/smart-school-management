/**
 * seed:upgradeDemoLoginIds — brings a demo deployment that was seeded before
 * the Login ID migration (password accounts keyed by email) onto Login IDs
 * WITHOUT deleting or re-creating anything: the existing password hash keeps
 * working under the dataset's Login ID.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Scrypt } from "lucia";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { asterAcademy } from "../../convex/seedData/asterAcademy";

const ds = asterAcademy;
const rahul = ds.teachers.find((x) => x.key === "verma")!;

beforeEach(() => { process.env.ALLOW_DEMO_SEED = "true"; });
afterEach(() => { delete process.env.ALLOW_DEMO_SEED; });

/** An account exactly as the previous (email + invitation) design stored it. */
async function legacyAccount(t: T, schoolId: Id<"schools">, email: string, password: string, role: "admin" | "teacher") {
  const secret = await new Scrypt().hash(password);
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, name: email });
    await ctx.db.insert("authAccounts", { userId, provider: "password", providerAccountId: email, secret });
    const membershipId = await ctx.db.insert("schoolMemberships", {
      schoolId, userId, email, displayName: email, role, status: "active", permissionSets: [], activatedAt: Date.now(),
      inviteCodeHash: "legacy-hash", invitedByUserId: userId,
    });
    return { userId, membershipId };
  });
}

describe("seed:upgradeDemoLoginIds", () => {
  test("dry run reports, apply re-keys the demo accounts to Login IDs and keeps their passwords", async () => {
    const t = makeTest();
    const S = await createSchool(t, ds.school.slug);
    const admin = await legacyAccount(t, S.schoolId, ds.admin.email, ds.admin.login.password, "admin");
    const teacher = await legacyAccount(t, S.schoolId, rahul.email, rahul.login!.password, "teacher");

    const dry = await t.mutation(internal.seed.upgradeDemoLoginIds, {});
    expect(dry.applied).toBe(false);
    expect(dry.logins.find((l) => l.loginId === "ADMIN-001")?.status).toBe("upgraded");
    expect(dry.logins.find((l) => l.loginId === "TCH-00001")?.status).toBe("upgraded");
    expect(dry.logins.find((l) => l.loginId === "STU-2026-00001")?.status).toBe("no_legacy_account");
    expect(dry.membershipsWithLegacyInviteFields).toBe(2);
    expect(JSON.stringify(dry)).not.toMatch(/@|Admin@123|Teacher@123/); // no emails or passwords in the report
    // Dry run changed nothing.
    expect((await t.run((ctx) => ctx.db.get(admin.userId)))?.loginId).toBeUndefined();

    const applied = await t.mutation(internal.seed.upgradeDemoLoginIds, { apply: true });
    expect(applied.applied).toBe(true);
    const state = await t.run(async (ctx) => ({
      user: await ctx.db.get(admin.userId),
      membership: await ctx.db.get(admin.membershipId),
      account: await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", "ADMIN-001")).unique(),
      emailAccount: await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", ds.admin.email)).unique(),
    }));
    expect(state.user?.loginId).toBe("ADMIN-001");
    expect(state.membership).toMatchObject({ loginId: "ADMIN-001", status: "active" });
    expect(state.membership?.inviteCodeHash).toBeUndefined();
    expect(state.membership?.invitedByUserId).toBeUndefined();
    expect(state.account?.userId).toBe(admin.userId);
    expect(state.emailAccount).toBeNull();
    expect(applied.passwordAccountsWithoutLoginId).toBe(0);

    // The ORIGINAL demo password now verifies under the Login ID (Convex Auth retrieveAccount).
    const asTeacher = await as(t, teacher.userId);
    await asTeacher.action(api.account.changePassword, { currentPassword: rahul.login!.password, newPassword: "Changed2026" });
    expect(await errorCode(asTeacher.action(api.account.changePassword, { currentPassword: rahul.login!.password, newPassword: "Again2026x" }))).toBe("INVALID_ARGUMENT");

    // Idempotent; the next generated teacher Login ID does not collide with the demo ones.
    const again = await t.mutation(internal.seed.upgradeDemoLoginIds, { apply: true });
    expect(again.logins.find((l) => l.loginId === "ADMIN-001")?.status).toBe("already_upgraded");
    const newTeacher = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: S.schoolId, employeeId: "E-77", firstName: "Om", lastName: "Das", specializationSubjectIds: [], status: "active" }));
    const created = await (await as(t, admin.userId)).action(api.accounts.create, { person: { kind: "teacher", teacherId: newTeacher } });
    expect(created.loginId).toBe("TCH-00002");
  });

  test("refuses without ALLOW_DEMO_SEED and never touches a non-demo deployment", async () => {
    const t = makeTest();
    delete process.env.ALLOW_DEMO_SEED;
    expect(await errorCode(t.mutation(internal.seed.upgradeDemoLoginIds, { apply: true }))).toBe("FORBIDDEN");
    process.env.ALLOW_DEMO_SEED = "true";
    await createSchool(t, "green-valley");
    expect(await errorCode(t.mutation(internal.seed.upgradeDemoLoginIds, { apply: true }))).toBe("NOT_FOUND");
  });
});

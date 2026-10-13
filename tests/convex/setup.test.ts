/**
 * Real-school onboarding (convex/setup.ts) — independent of the demo seed.
 * Internal-only: not callable from a browser client.
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { as, errorCode, makeTest } from "./fixtures";

const input = {
  school: { name: "Green Valley School", shortName: "Green Valley", code: "gvs", slug: "green-valley", timezone: "Asia/Kolkata", locale: "en-IN", currency: "INR" },
  academicYear: { name: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
  admin: { displayName: "Principal" },
};

describe("setup:initSchool", () => {
  test("creates the school, current year and first admin with a temporary password; runs once", async () => {
    const t = makeTest();
    const r = await t.action(internal.setup.initSchool, input);
    expect(r.adminLoginId).toBe("ADMIN-001");
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    const state = await t.run(async (ctx) => ({
      school: await ctx.db.get(r.schoolId),
      years: await ctx.db.query("academicYears").collect(),
      user: await ctx.db.query("users").withIndex("by_login_id", (q) => q.eq("loginId", "ADMIN-001")).first(),
      membership: await ctx.db.query("schoolMemberships").withIndex("by_login_id", (q) => q.eq("loginId", "ADMIN-001")).first(),
    }));
    expect(state.school).toMatchObject({ code: "GVS", slug: "green-valley", status: "active" });
    expect(state.years).toHaveLength(1);
    expect(state.user).toMatchObject({ mustChangePassword: true });
    expect(state.membership).toMatchObject({ role: "admin", status: "active", schoolId: r.schoolId, userId: state.user!._id });

    // The temporary password is real (verified by Convex Auth) and can be replaced.
    const admin = await as(t, state.user!._id);
    expect(state.user?.temporaryPasswordIssuedAt).toBeGreaterThan(0);
    // Until the temporary password is replaced the first admin can only reach the session and the password change.
    const before = await admin.query(api.users.session, {});
    expect(before.status === "signedIn" && before.viewer.mustChangePassword).toBe(true);
    expect(await errorCode(admin.query(api.accounts.listPeople, { kind: "teacher", paginationOpts: { numItems: 5, cursor: null } }))).toBe("PASSWORD_CHANGE_REQUIRED");
    await admin.action(api.account.changePassword, { currentPassword: r.temporaryPassword, newPassword: "Principal2026" });
    const s = await admin.query(api.users.session, {});
    expect(s.status === "signedIn" && s.viewer.role === "admin" && s.viewer.school.slug === "green-valley" && !s.viewer.mustChangePassword).toBe(true);
    expect((await admin.query(api.accounts.listPeople, { kind: "teacher", paginationOpts: { numItems: 5, cursor: null } })).page).toHaveLength(0);

    expect(await errorCode(t.action(internal.setup.initSchool, { ...input, school: { ...input.school, slug: "other" } }))).toBe("CONFLICT");
    const second = await t.action(internal.setup.addAdministrator, { admin: { displayName: "Vice Principal" } });
    expect(second.loginId).toBe("ADMIN-002");
  });

  test("rejects invalid school codes and date ranges", async () => {
    const t = makeTest();
    expect(await errorCode(t.action(internal.setup.initSchool, { ...input, school: { ...input.school, code: "TOO-LONG-CODE" } }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(t.action(internal.setup.initSchool, { ...input, academicYear: { ...input.academicYear, endDate: "2026-01-01" } }))).toBe("INVALID_ARGUMENT");
    expect(await t.run((ctx) => ctx.db.query("schools").collect())).toHaveLength(0);
  });
});

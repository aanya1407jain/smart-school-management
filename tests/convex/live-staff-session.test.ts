/**
 * A-00: school-created ADMIN and TEACHER accounts (no demo persona) resolve to
 * their real server identity and get the live workspace — they are never
 * mapped onto demo personas and never shown "records aren't available".
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { liveStaffUser, liveWorkspaceUser } from "../../src/features/auth/live-user";
import { isLiveRoute, liveNavItems } from "../../src/lib/permissions/navigation";

async function signedInAfterPasswordChange(t: T, membershipId: Id<"schoolMemberships">, temporaryPassword: string) {
  const m = (await t.run((ctx) => ctx.db.get(membershipId)))!;
  const me = await as(t, m.userId!);
  await me.action(api.account.changePassword, { currentPassword: temporaryPassword, newPassword: "Staff#2026x" });
  return { me, userId: m.userId! };
}

describe("live admin / teacher sessions", () => {
  test("a provisioned teacher: server role + teacher link, live workspace user, own data only", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const teacherId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-77", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
    await t.run((ctx) => ctx.db.patch(A.sectionB, { classTeacherId: teacherId }));
    const acc = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId } });
    const { me } = await signedInAfterPasswordChange(t, acc.membershipId, acc.temporaryPassword);

    const s = await me.query(api.users.session, {});
    expect(s.status).toBe("signedIn");
    if (s.status !== "signedIn") return;
    expect(s.viewer).toMatchObject({ role: "teacher", loginId: acc.loginId, teacher: { teacherId }, students: [], mustChangePassword: false });
    expect(s.viewer.school.slug).toBe("alpha");

    const u = liveWorkspaceUser(s.viewer);
    expect(u).toMatchObject({ id: acc.membershipId, role: "teacher", teacherId, loginId: acc.loginId });
    expect(u.studentIds).toBeUndefined();

    // Live workspace works on real records: own class register yes; another school's section no.
    const reg = await me.query(api.attendance.getByDate, { sectionId: A.sectionB, date: "2026-07-01", today: "2026-07-01" });
    expect(reg.isClassTeacher).toBe(true);
    expect(await errorCode(me.query(api.attendance.getByDate, { sectionId: B.sectionA, date: "2026-07-01", today: "2026-07-01" }))).toBe("NOT_FOUND");
    // A section the teacher is not linked to.
    expect(await errorCode(me.query(api.attendance.getByDate, { sectionId: A.sectionA, date: "2026-07-01", today: "2026-07-01" }))).toBe("FORBIDDEN");
    // Admin-only functions stay closed.
    expect(await errorCode(me.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 5, cursor: null } }))).toBe("FORBIDDEN");
  });

  test("a provisioned administrator: server role admin, live workspace user, school-scoped", async () => {
    const t = makeTest();
    const A = await createSchool(t, "solo");
    const r = await t.action(internal.setup.addAdministrator, { admin: { displayName: "Second Admin" } });
    const membership = await t.run(async (ctx) => (await ctx.db.query("schoolMemberships").withIndex("by_login_id", (q) => q.eq("loginId", r.loginId)).unique())!);
    const { me } = await signedInAfterPasswordChange(t, membership._id, r.temporaryPassword);
    const s = await me.query(api.users.session, {});
    if (s.status !== "signedIn") throw new Error(s.status);
    expect(s.viewer).toMatchObject({ role: "admin", loginId: r.loginId, teacher: null, students: [] });
    const u = liveWorkspaceUser(s.viewer);
    expect(u).toMatchObject({ role: "admin", loginId: r.loginId });
    // Live admin pages are backed by Convex: e.g. the accounts list and the school-wide attendance overview.
    expect((await me.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 5, cursor: null } })).page.length).toBeGreaterThan(0);
    expect(Array.isArray(await me.query(api.attendance.dailyOverview, { date: "2026-07-01" }))).toBe(true);
  });

  test("temporary password: session resolves but school data is refused until the change", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const teacherId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-78", firstName: "Om", lastName: "K", specializationSubjectIds: [], status: "active" }));
    const acc = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId } });
    const m = (await t.run((ctx) => ctx.db.get(acc.membershipId)))!;
    const me = await as(t, m.userId!);
    const s = await me.query(api.users.session, {});
    expect(s.status === "signedIn" && s.viewer.mustChangePassword).toBe(true);
    expect(await errorCode(me.query(api.attendance.dailyOverview, { date: "2026-07-01" }))).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  test("suspended membership, foreign membershipId and disabled users fail safely", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const teacher = await as(t, A.users.classTeacher);
    // Someone else's membership (other school) cannot be selected.
    const foreign = await teacher.query(api.users.session, { membershipId: B.memberships.admin });
    expect(foreign).toMatchObject({ status: "noSchool", code: "NO_SCHOOL_ACCESS" });
    expect(await errorCode(teacher.query(api.attendance.dailyOverview, { date: "2026-07-01", membershipId: B.memberships.admin }))).toBe("NO_SCHOOL_ACCESS");
    // Suspended → no school access.
    await t.run((ctx) => ctx.db.patch(A.memberships.classTeacher, { status: "suspended" }));
    expect((await teacher.query(api.users.session, {})).status).toBe("noSchool");
    expect(await errorCode(teacher.query(api.attendance.dailyOverview, { date: "2026-07-01" }))).toBe("NO_SCHOOL_ACCESS");
  });

  test("client-side identity is built only from the viewer; no role can be claimed", () => {
    const base = { membershipId: "m1", loginId: "TCH-00009", email: null, displayName: "T", permissionSets: [] as string[], students: [], guardian: null };
    expect(liveWorkspaceUser({ ...base, role: "teacher", teacher: { teacherId: "t1", name: "T" } } as never)).toMatchObject({ role: "teacher", teacherId: "t1" });
    expect(liveWorkspaceUser({ ...base, role: "admin", teacher: null } as never)).toMatchObject({ role: "admin" });
    expect(() => liveStaffUser({ ...base, role: "student", teacher: null } as never)).toThrow();
  });

  test("live accounts only open pages backed by Convex; demo-data pages are gated", () => {
    for (const p of [
      "/admin/accounts", "/admin/attendance", "/admin/notifications", "/admin/students/new", "/admin/students/abc123", "/teacher/attendance", "/teacher/notifications", "/teacher/students/abc", "/student/fees",
      // Connected in the integration pass (finance & communications, academics, teacher screens):
      "/admin/dashboard", "/admin/students", "/admin/students/abc/edit", "/admin/academics", "/admin/fees", "/admin/fees/abc123", "/admin/notices", "/admin/reports", "/admin/settings",
      "/teacher/classes", "/teacher/homework", "/teacher/homework/abc", "/teacher/examinations", "/teacher/examinations/marks", "/teacher/timetable", "/teacher/notices",
      // Connected in the MVP-completion pass (exams lifecycle, timetable builder, homework oversight,
      // teachers & staff, teacher landing page, staff profiles, audit log):
      "/admin/examinations", "/admin/examinations/abc", "/admin/examinations/marks", "/admin/timetable", "/admin/homework", "/admin/teachers",
      "/admin/audit", "/admin/profile", "/teacher/dashboard", "/teacher/profile",
    ]) {
      expect(isLiveRoute(p), p).toBe(true);
    }
    // Pages that are not in the navigation are never live by accident.
    for (const p of ["/admin/unknown", "/teacher/payroll", "/admin/payroll/run"]) {
      expect(isLiveRoute(p), p).toBe(false);
    }
    expect(liveNavItems({ role: "teacher", permissionSets: [] }).map((i) => i.href)).toEqual(["/teacher/dashboard", "/teacher/classes", "/teacher/attendance", "/teacher/homework", "/teacher/examinations", "/teacher/timetable", "/teacher/notices", "/teacher/notifications", "/teacher/profile"]);
    expect(liveNavItems({ role: "admin", permissionSets: [] }).map((i) => i.href)).toEqual(["/admin/dashboard", "/admin/students", "/admin/academics", "/admin/teachers", "/admin/accounts", "/admin/attendance", "/admin/fees", "/admin/examinations", "/admin/timetable", "/admin/homework", "/admin/notices", "/admin/notifications", "/admin/reports", "/admin/audit", "/admin/settings", "/admin/profile"]);
    // A restricted (accountant-only) admin sees finance pages only.
    expect(liveNavItems({ role: "admin", permissionSets: ["accountant"] }).map((i) => i.href)).toEqual(["/admin/dashboard", "/admin/students", "/admin/fees", "/admin/notifications", "/admin/reports", "/admin/profile"]);
  });
});

/**
 * Guardian sign-ins were REMOVED (account roles: admin, teacher, student only).
 * This file used to test guardian child switching; it now proves the removal:
 *   - a leftover guardian membership (as an old deployment may still hold) grants
 *     no access to any portal, staff function or file — even for the student it
 *     was linked to, and even when called directly with ids;
 *   - such a membership cannot be activated, re-enabled or given credentials;
 *   - students are notified on their own account only;
 *   - migrations:removeGuardianAccounts deletes those memberships (dry run first),
 *     deletes a sign-in that has nothing else, keeps users with other access, and
 *     never touches parent CONTACT data on students.
 * (Kept under its old name so the history of the file is preserved; rename with
 * `git mv` when committing if preferred.)
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

const TODAY = "2026-10-12";

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  return { t, A, B };
}

describe("legacy guardian sign-ins grant nothing", () => {
  test("every portal, staff and file function refuses them, for linked and unlinked students alike", async () => {
    const { t, A, B } = await setup();
    const g = await as(t, A.users.legacyGuardian);
    const calls: [string, () => Promise<unknown>][] = [
      ["session.viewer", () => g.query(api.users.viewer, {})],
      ["myProfile", () => g.query(api.studentPortal.myProfile, {})],
      ["myProfile(linked id)", () => g.query(api.studentPortal.myProfile, { studentId: A.studentA })],
      ["myTimetable", () => g.query(api.timetable.myStudentTimetable, { studentId: A.studentA })],
      ["myHomework", () => g.query(api.homework.myHomework, { studentId: A.studentA })],
      ["myResults", () => g.query(api.exams.myResults, { studentId: A.studentA })],
      ["myFees", () => g.query(api.fees.myFees, { studentId: A.studentA })],
      ["myNotices", () => g.query(api.studentPortal.myNotices, { studentId: A.studentA, today: TODAY })],
      ["attendance.studentHistory", () => g.query(api.attendance.studentHistory, { studentId: A.studentA })],
      ["fees.studentLedger", () => g.query(api.fees.studentLedger, { studentId: A.studentA })],
      ["academics.getStudentProfile", () => g.query(api.students.getStudentProfile, { studentId: A.studentA })],
      ["academics.enrollmentHistory", () => g.query(api.students.enrollmentHistory, { studentId: A.studentA })],
      ["files.listForOwner", () => g.query(api.files.listForOwner, { ownerType: "student", ownerId: A.studentA })],
      ["notifications.list", () => g.query(api.notifications.list, {})],
      ["other school student", () => g.query(api.studentPortal.myProfile, { studentId: B.studentA })],
      ["admin mutation", () => g.mutation(api.academics.createClass, { name: "X", level: 9 })],
      ["teacher mutation", () => g.mutation(api.attendance.mark, { sectionId: A.sectionA, date: TODAY, entries: [{ studentId: A.studentA, status: "present" }] })],
    ];
    for (const [name, call] of calls) {
      expect([name, await errorCode(call())]).toEqual([name, "NO_SCHOOL_ACCESS"]);
    }
    const s = await g.query(api.users.session, {});
    expect(s.status).toBe("noSchool");
  });

  test("it cannot be re-enabled or given new credentials; its Login ID cannot be activated", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    await t.run((ctx) => ctx.db.patch(A.memberships.legacyGuardian, { status: "suspended", loginId: "GRD-00001" }));
    expect(await errorCode(admin.mutation(api.memberships.updateAccess, { targetMembershipId: A.memberships.legacyGuardian, status: "active" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.action(api.accounts.setStatus, { targetMembershipId: A.memberships.legacyGuardian, status: "active" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.action(api.accounts.issueTemporaryPassword, { targetMembershipId: A.memberships.legacyGuardian }))).toBe("INVALID_ARGUMENT");
    // An invited (never activated) legacy membership is not activated by creating its Login ID.
    await t.run((ctx) => ctx.db.patch(A.memberships.legacyGuardian, { status: "invited", userId: undefined }));
    const { activatePendingAccount } = await import("../../convex/model/accounts");
    await expect(t.run((ctx) => activatePendingAccount(ctx, { loginId: "GRD-00001", mustChangePassword: true }))).rejects.toThrow(/created by your school/);
  });

  test("only the three account roles grant access: no fourth role, no student link on a staff login", async () => {
    const { t, A } = await setup();
    const mk = (extra: Record<string, unknown>) => t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: `odd-${Math.random()}@x.test` });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, displayName: "Odd", status: "active", permissionSets: [], ...extra } as never);
      return userId;
    });
    const cases: [string, Record<string, unknown>][] = [
      ["admin role linked to a student", { role: "admin", studentId: A.studentA }],
      ["teacher role linked to a student", { role: "teacher", teacherId: A.classTeacher, studentId: A.studentA }],
    ];
    for (const [name, extra] of cases) {
      const c = await as(t, await mk(extra));
      expect([name, await errorCode(c.query(api.users.viewer, {}))]).toEqual([name, "NO_SCHOOL_ACCESS"]);
      expect([name, await errorCode(c.query(api.studentPortal.myProfile, { studentId: A.studentA }))]).toEqual([name, "NO_SCHOOL_ACCESS"]);
      expect([name, (await c.query(api.users.session, {})).status]).toEqual([name, "noSchool"]);
    }
    // A student login without a student record (as a guardian-style login would look without its
    // guardian link) reads no student's data, its "own" or anyone else's.
    const unlinked = await as(t, await mk({ role: "student" }));
    expect(await unlinked.query(api.fees.myFees, {})).toEqual({ state: "no_student_record" });
    for (const call of [
      () => unlinked.query(api.studentPortal.myProfile, { studentId: A.studentA }),
      () => unlinked.query(api.attendance.studentHistory, { studentId: A.studentA }),
      () => unlinked.query(api.fees.studentLedger, { studentId: A.studentA }),
      () => unlinked.query(api.students.getStudentProfile, { studentId: A.studentA }),
    ]) expect(["NOT_FOUND", "FORBIDDEN"]).toContain(await errorCode(call()));
    // A fourth role value cannot even be stored: the schema only accepts admin / teacher / student.
    for (const role of ["parent", "guardian"]) {
      await expect(mk({ role, studentId: A.studentA })).rejects.toThrow(new RegExp(`Validator error.*"${role}"`));
    }
    // The real three keep working.
    for (const u of [A.users.admin, A.users.classTeacher, A.users.student]) {
      expect((await (await as(t, u)).query(api.users.session, {})).status).toBe("signedIn");
    }
  });

  test("events reach the student's own account only", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const { noticeId } = await admin.mutation(api.notices.createDraft, { title: "Trip", body: "Details", type: "notice", priority: "normal", publishDate: "2026-01-05", audience: { kind: "sections", sectionIds: [A.sectionA] } });
    await admin.mutation(api.notices.publish, { noticeId });
    const rows = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()));
    expect(rows.some((n) => n.userId === A.users.student)).toBe(true);
    expect(rows.some((n) => n.userId === A.users.legacyGuardian)).toBe(false);
  });
});

describe("migrations:removeGuardianAccounts", () => {
  const counts = (t: T) => t.run(async (ctx) => ({
    memberships: (await ctx.db.query("schoolMemberships").collect()).length,
    legacy: (await ctx.db.query("schoolMemberships").collect()).filter((m) => m.guardianId).length,
    users: (await ctx.db.query("users").collect()).length,
    contacts: (await ctx.db.query("guardians").collect()).length,
    links: (await ctx.db.query("guardianLinks").collect()).length,
  }));

  test("dry run reports and writes nothing; apply deletes the memberships and orphaned sign-ins, keeps contacts and other access", async () => {
    const { t, A, B } = await setup();
    // A teacher who ALSO had a guardian sign-in keeps their teacher access.
    await t.run(async (ctx) => {
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: A.users.classTeacher, displayName: "Old", role: "student", status: "active", permissionSets: [], guardianId: A.parentContactId, loginId: "GRD-00002" });
      // Sign-in data of the guardian-only user: a password account + a session.
      await ctx.db.insert("authAccounts", { userId: A.users.legacyGuardian, provider: "password", providerAccountId: "GRD-00001", secret: "hash" });
    });
    await as(t, A.users.legacyGuardian); // creates an auth session for that user
    await t.run(async (ctx) => {
      // Notifications delivered before the change: the guardian-only user's go with the sign-in; the teacher's stay.
      await ctx.db.insert("notifications", { schoolId: A.schoolId, userId: A.users.legacyGuardian, type: "notice", title: "Old", message: "x", isRead: false });
      await ctx.db.insert("notifications", { schoolId: A.schoolId, userId: A.users.classTeacher, type: "notice", title: "Keep", message: "x", isRead: false });
    });
    const before = await counts(t);
    expect(before.legacy).toBe(3); // A: fixture + teacher's extra; B: fixture

    const dry = await t.mutation(internal.migrations.removeGuardianAccounts, {});
    expect(dry).toMatchObject({ applied: false, memberships: 3, remaining: false });
    expect(dry.report.filter((r) => r.signInDeleted)).toHaveLength(2); // the two guardian-only users
    expect(await counts(t)).toEqual(before);

    const res = await t.mutation(internal.migrations.removeGuardianAccounts, { apply: true });
    expect(res).toMatchObject({ applied: true, memberships: 3, remaining: false });
    const after = await counts(t);
    expect(after.legacy).toBe(0);
    expect(after.memberships).toBe(before.memberships - 3);
    expect(after.users).toBe(before.users - 2);
    expect(after.contacts).toBe(before.contacts); // parent contact data untouched
    expect(after.links).toBe(before.links);
    expect(await t.run((ctx) => ctx.db.get(A.users.legacyGuardian))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("authAccounts").collect()).filter((a) => a.providerAccountId === "GRD-00001"))).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.query("authSessions").collect()).filter((s) => s.userId === A.users.legacyGuardian))).toEqual([]);
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).map((n) => [n.userId, n.title]));
    expect(notes).toContainEqual([A.users.classTeacher, "Keep"]);
    expect(notes.some(([u]) => u === A.users.legacyGuardian)).toBe(false);
    // Students, enrollments and their parent contacts are untouched.
    expect(await t.run((ctx) => ctx.db.get(A.studentA))).not.toBeNull();
    expect((await (await as(t, A.users.admin)).query(api.students.getStudentProfile, { studentId: A.studentA }))?.parentContacts.map((c) => c.name)).toEqual(["Parent Contact"]);
    // The teacher still signs in as a teacher.
    const s = await (await as(t, A.users.classTeacher)).query(api.users.session, {});
    expect(s.status === "signedIn" && s.viewer.role).toBe("teacher");
    // Audited per school, no secrets.
    const audits = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === "account.deleted"));
    expect(audits.map((a) => a.schoolId).sort()).toEqual([A.schoolId, A.schoolId, B.schoolId].sort());
    expect(JSON.stringify(audits)).not.toContain("hash");
    // Idempotent.
    expect(await t.mutation(internal.migrations.removeGuardianAccounts, { apply: true })).toMatchObject({ memberships: 0 });
  });
  // Internal-only visibility (not callable from a client) is enforced by Convex itself; convex-test
  // cannot model it, so it is checked against the sandbox deployment in scripts/convex-integration.test.ts.
});

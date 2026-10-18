/**
 * P1-A/B/C + P2 audit viewer: restricted-admin accountant, staff logins and
 * access changes, staff profiles, student documents / enrollment history,
 * teacher records, leave (apply / withdraw / decide → notified once), staff
 * attendance and the audit feed. Server enforcement and tenant isolation.
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { resolvePermissions, ROLE_PERMISSIONS, PERMISSION_SETS } from "../../convex/core/permissions";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

const audits = (t: T, action: string) => t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === action));
async function addAdmin(t: T, schoolId: Id<"schools">, name: string, permissionSets: "accountant"[] = []) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: `${name}@x.test` });
    const membershipId = await ctx.db.insert("schoolMemberships", { schoolId, userId, displayName: name, role: "admin", status: "active", permissionSets, loginId: `ADMIN-${name.toUpperCase()}` });
    return { userId, membershipId };
  });
}

describe("restricted-admin accountant", () => {
  test("permission resolution: an admin with the accountant set gets exactly the accountant permissions", () => {
    expect([...resolvePermissions("admin", ["accountant"])].sort()).toEqual([...PERMISSION_SETS.accountant].sort());
    expect(resolvePermissions("admin", []).size).toBe(ROLE_PERMISSIONS.admin.size);
    const acct = resolvePermissions("admin", ["accountant"]);
    for (const p of ["users:manage", "settings:manage", "academics:manage", "staff:manage", "attendance:read:all", "audit:read", "students:write", "exams:manage"] as const) expect(acct.has(p)).toBe(false);
  });

  test("server enforcement: finance works, everything else is refused; the restriction is audited and reversible", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const acc = await addAdmin(t, A.schoolId, "acc");
    const accountant = await as(t, acc.userId);
    // Full admin until restricted.
    expect(await errorCode(accountant.query(api.audit.list, {}))).toBe("NO_ERROR");
    await admin.mutation(api.memberships.updateAccess, { targetMembershipId: acc.membershipId, permissionSets: ["accountant"] });
    expect((await audits(t, "membership.access_changed")).at(-1)?.metadata).toMatchObject({ to: { permissionSets: ["accountant"] } });

    const { structureId } = await accountant.mutation(api.fees.createStructure, { name: "Tuition", classIds: [A.classId], components: [{ label: "Tuition", amountMinor: 1000 }], installments: [{ label: "T1", dueDate: "2026-06-01", amountMinor: 1000 }], activate: true });
    await accountant.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    await accountant.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 500, method: "cash", paidOn: "2026-06-01", clientRequestId: "acct-req-00001" });
    expect((await accountant.query(api.reports.feeSummary, {})).classes.length).toBeGreaterThan(0);
    expect((await accountant.query(api.reports.adminDashboard, {})).overview).toBeNull();

    for (const call of [
      () => accountant.query(api.audit.list, {}),
      () => accountant.query(api.reports.studentStatistics, {}),
      () => accountant.query(api.reports.lowAttendance, {}),
      () => accountant.query(api.accounts.listStaffAccounts, {}),
      () => accountant.mutation(api.memberships.updateAccess, { targetMembershipId: A.memberships.admin, status: "suspended" }),
      () => accountant.mutation(api.academics.createClass, { name: "Grade 9", level: 9 }),
      () => accountant.query(api.staff.listTeachers, {}),
      () => accountant.mutation(api.exams.create, { name: "X", classIds: [A.classId], startDate: "2026-10-20", endDate: "2026-10-21" }),
    ]) expect(await errorCode(call())).toBe("FORBIDDEN");
    // Students list without account details.
    const page = await accountant.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.every((p) => p.account === null)).toBe(true);
    expect(await errorCode(accountant.query(api.accounts.listPeople, { kind: "teacher", paginationOpts: { numItems: 10, cursor: null } }))).toBe("FORBIDDEN");

    await admin.mutation(api.memberships.updateAccess, { targetMembershipId: acc.membershipId, permissionSets: [] });
    expect(await errorCode(accountant.query(api.audit.list, {}))).toBe("NO_ERROR");
  });

  test("access management: users:manage only, never one's own access, never another school's member; staff list", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const acc = await addAdmin(t, A.schoolId, "acc", ["accountant"]);
    expect(await errorCode(admin.mutation(api.memberships.updateAccess, { targetMembershipId: A.memberships.admin, status: "suspended" }))).toBe("FORBIDDEN");
    expect(await errorCode(admin.mutation(api.memberships.updateAccess, { targetMembershipId: B.memberships.admin, status: "suspended" }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.memberships.updateAccess, { targetMembershipId: A.memberships.classTeacher, permissionSets: ["accountant"] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.memberships.updateAccess, { targetMembershipId: acc.membershipId, status: "suspended" }))).toBe("FORBIDDEN");

    const list = await admin.query(api.accounts.listStaffAccounts, {});
    expect(list.map((r) => [r.displayName, r.accountantOnly, r.isSelf])).toEqual([["acc", true, false], ["admin", false, true]]);
    expect((await (await as(t, B.users.admin)).query(api.accounts.listStaffAccounts, {})).map((r) => r.displayName)).toEqual(["admin"]);

    await admin.mutation(api.memberships.updateAccess, { targetMembershipId: acc.membershipId, status: "suspended" });
    expect(await errorCode((await as(t, acc.userId)).query(api.fees.overview, {}))).not.toBe("NO_ERROR");
  });

  test("staff login reservation: admin role, accountant-only set, validated name, users:manage only", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const r = await admin.mutation(internal.accounts.reserveForPerson, { callerMembershipId: A.memberships.admin, person: { kind: "staff", displayName: "Meera (Accounts)", accountantOnly: true } });
    expect(r.loginId).toMatch(/^ADMIN-\d{3}$/);
    const m = await t.run((ctx) => ctx.db.get(r.membershipId));
    expect(m).toMatchObject({ role: "admin", permissionSets: ["accountant"], status: "invited", displayName: "Meera (Accounts)" });
    expect(await errorCode(admin.mutation(internal.accounts.reserveForPerson, { callerMembershipId: A.memberships.admin, person: { kind: "staff", displayName: "  ", accountantOnly: false } }))).toBe("INVALID_ARGUMENT");
    const ct = await as(t, A.users.classTeacher);
    expect(await errorCode(ct.mutation(internal.accounts.reserveForPerson, { callerMembershipId: A.memberships.classTeacher, person: { kind: "staff", displayName: "X", accountantOnly: false } }))).toBe("FORBIDDEN");
  });
});

describe("staff profile", () => {
  test("teacher sees own record and duties, edits own phone only; admin renames self; students refused; audited", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const ct = await as(t, A.users.classTeacher);
    const p = await ct.query(api.profile.mine, {});
    expect(p).toMatchObject({ role: "teacher", canRename: false, canEditPhone: true, duties: { classTeacherOf: ["8-A"], subjects: ["Mathematics · 8-B"] } });
    expect(await errorCode(ct.mutation(api.profile.updateMine, { displayName: "Boss" }))).toBe("FORBIDDEN");
    expect(await errorCode(ct.mutation(api.profile.updateMine, { phone: "call me" }))).toBe("INVALID_ARGUMENT");
    await ct.mutation(api.profile.updateMine, { phone: "+91 98765 43210" });
    expect((await ct.query(api.profile.mine, {})).teacher?.phone).toBe("+91 98765 43210");

    const admin = await as(t, A.users.admin);
    expect((await admin.query(api.profile.mine, {})).teacher).toBeNull();
    await admin.mutation(api.profile.updateMine, { displayName: "Principal Rao" });
    expect((await admin.query(api.profile.mine, {})).displayName).toBe("Principal Rao");
    expect(await errorCode(admin.mutation(api.profile.updateMine, { phone: "123456" }))).toBe("FORBIDDEN");
    for (const u of [A.users.student, A.users.guardian]) expect(await errorCode((await as(t, u)).query(api.profile.mine, {}))).toBe("FORBIDDEN");
    expect(await audits(t, "profile.updated")).toHaveLength(2);
  });
});

describe("student documents and enrollment history", () => {
  test("documents: admins upload/read/delete; linked family read; teachers and other schools cannot read", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const fileId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["%PDF-1.4"]));
      return ctx.db.insert("files", { schoolId: A.schoolId, storageId, kind: "student_document", ownerType: "student", ownerId: A.studentA, fileName: "tc.pdf", contentType: "application/pdf", size: 8, uploadedByUserId: A.users.admin });
    });
    const list = (u: Id<"users">) => as(t, u).then((c) => c.query(api.files.listForOwner, { ownerType: "student", ownerId: A.studentA }));
    expect((await list(A.users.admin)).map((f) => f.fileName)).toEqual(["tc.pdf"]);
    expect((await list(A.users.student)).map((f) => f.fileName)).toEqual(["tc.pdf"]);
    expect((await list(A.users.guardian)).map((f) => f.fileName)).toEqual(["tc.pdf"]);
    // Subject teacher of 8-A (assigned scope) must NOT see student documents.
    expect(await errorCode(list(A.users.subjectTeacher))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.subjectTeacher)).query(api.files.getUrl, { fileId }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, B.users.admin)).query(api.files.getUrl, { fileId }))).toBe("NOT_FOUND");
    // An accountant-only admin cannot read them either.
    const acc = await addAdmin(t, A.schoolId, "acc", ["accountant"]);
    expect(await errorCode((await as(t, acc.userId)).query(api.files.getUrl, { fileId }))).toBe("NOT_FOUND");
    // Only admins delete; it is audited.
    expect(await errorCode((await as(t, A.users.guardian)).mutation(api.files.remove, { fileId }))).toBe("FORBIDDEN");
    await admin.mutation(api.files.remove, { fileId });
    expect(await list(A.users.admin)).toEqual([]);
    expect(await audits(t, "file.deleted")).toHaveLength(1);
  });

  test("enrollment history survives transfer and withdrawal; family can read it, teachers and other schools cannot", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.academics.enrollStudent, { studentId: A.studentA, sectionId: A.sectionB, startDate: "2026-07-01" });
    const enr = (await admin.query(api.academics.enrollmentHistory, { studentId: A.studentA })).find((e) => e.status === "active")!;
    await admin.mutation(api.academics.endEnrollment, { enrollmentId: enr.enrollmentId, status: "withdrawn", endDate: "2026-09-30" });
    const h = await admin.query(api.academics.enrollmentHistory, { studentId: A.studentA });
    expect(h.map((e) => [e.section, e.status])).toEqual([["8-B", "withdrawn"], ["8-A", "transferred"]]);
    expect((await (await as(t, A.users.guardian)).query(api.academics.enrollmentHistory, { studentId: A.studentA })).length).toBe(2);
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.academics.enrollmentHistory, { studentId: A.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, B.users.admin)).query(api.academics.enrollmentHistory, { studentId: A.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.guardian)).query(api.academics.enrollmentHistory, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await audits(t, "enrollment.transferred")).toHaveLength(1);
    expect(await audits(t, "enrollment.ended")).toHaveLength(1);
  });
});

describe("teachers & staff", () => {
  test("teacher records: list and edit (staff:manage), names sync to the sign-in, audited, isolated", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const rows = await admin.query(api.staff.listTeachers, {});
    expect(rows.map((r) => [r.name, r.classTeacherOf, r.subjectLoad])).toEqual([["Class T", ["8-A"], 1], ["Subject T", ["8-B"], 1]]);
    await admin.mutation(api.staff.updateTeacher, { teacherId: A.classTeacher, title: "Mrs.", firstName: "Lata", designation: "Senior Teacher", specializationSubjectIds: [A.subjectId] });
    const m = await t.run((ctx) => ctx.db.get(A.memberships.classTeacher));
    expect(m?.displayName).toBe("Mrs. Lata T");
    expect(await errorCode(admin.mutation(api.staff.updateTeacher, { teacherId: A.classTeacher, email: "nope" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.staff.updateTeacher, { teacherId: A.classTeacher, firstName: " " }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.staff.updateTeacher, { teacherId: B.classTeacher, firstName: "X" }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.staff.updateTeacher, { teacherId: A.classTeacher, firstName: "Me" }))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.staff.listTeachers, {}))).toBe("FORBIDDEN");
    await admin.mutation(api.staff.updateTeacher, { teacherId: A.subjectTeacher, status: "inactive" });
    expect((await admin.query(api.staff.staffAttendanceByDate, { date: "2026-10-05" })).map((r) => r.name)).toEqual(["Mrs. Lata T"]);
    expect(await audits(t, "teacher.updated")).toHaveLength(2);
  });

  test("leave: apply, overlap refused, withdraw pending only, decide once with one notification; staff attendance links approved leave", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const ct = await as(t, A.users.classTeacher);
    const { leaveRequestId: first } = await ct.mutation(api.staff.applyLeave, { type: "casual", fromDate: "2026-10-05", toDate: "2026-10-06", reason: "Family" });
    expect(await errorCode(ct.mutation(api.staff.applyLeave, { type: "sick", fromDate: "2026-10-06", toDate: "2026-10-07", reason: "x" }))).toBe("CONFLICT");
    await ct.mutation(api.staff.withdrawLeave, { leaveRequestId: first });
    const { leaveRequestId } = await ct.mutation(api.staff.applyLeave, { type: "sick", fromDate: "2026-10-05", toDate: "2026-10-05", reason: "Fever" });
    expect(await errorCode((await as(t, A.users.subjectTeacher)).mutation(api.staff.withdrawLeave, { leaveRequestId }))).toBe("FORBIDDEN");
    expect(await errorCode(ct.mutation(api.staff.decideLeave, { leaveRequestId, decision: "approved" }))).toBe("FORBIDDEN");
    await admin.mutation(api.staff.decideLeave, { leaveRequestId, decision: "approved", note: "Get well" });
    expect(await errorCode(admin.mutation(api.staff.decideLeave, { leaveRequestId, decision: "rejected" }))).toBe("CONFLICT");
    expect(await errorCode(ct.mutation(api.staff.withdrawLeave, { leaveRequestId }))).toBe("CONFLICT");
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.dedupeKey === `leave.decided:${leaveRequestId}`));
    expect(notes.map((n) => n.userId)).toEqual([A.users.classTeacher]);
    expect((await ct.query(api.staff.myLeave, {})).map((r) => [r.status, r.decisionNote])).toEqual([["approved", "Get well"]]);

    const day = await admin.query(api.staff.staffAttendanceByDate, { date: "2026-10-05" });
    expect(day.find((r) => r.teacherId === A.classTeacher)?.approvedLeave?.type).toBe("sick");
    await admin.mutation(api.staff.markStaffAttendance, { date: "2026-10-05", entries: [{ teacherId: A.classTeacher, status: "on_leave" }, { teacherId: A.subjectTeacher, status: "present" }] });
    const marked = await t.run(async (ctx) => (await ctx.db.query("staffAttendance").collect()).find((r) => r.teacherId === A.classTeacher));
    expect(marked?.leaveRequestId).toBe(leaveRequestId);
    expect(await errorCode(admin.mutation(api.staff.markStaffAttendance, { date: "2999-01-01", entries: [{ teacherId: A.classTeacher, status: "present" }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(ct.mutation(api.staff.markStaffAttendance, { date: "2026-10-05", entries: [{ teacherId: A.classTeacher, status: "present" }] }))).toBe("FORBIDDEN");
  });
});

describe("audit viewer", () => {
  test("feed: audit:read only, newest first, actor named in this school, filter by action, isolated", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    await admin.mutation(api.academics.createClass, { name: "Grade 9", level: 9 });
    await admin.mutation(api.academics.createClass, { name: "Grade 10", level: 10 });
    await (await as(t, B.users.admin)).mutation(api.academics.createClass, { name: "Grade 11", level: 11 });
    const f = await admin.query(api.audit.feed, { paginationOpts: { numItems: 10, cursor: null } });
    expect(f.page.map((r) => r.summary.includes("Grade 10") || r.summary.includes("Grade 9"))).toEqual([true, true]);
    expect(f.page[0].actor?.name).toBe("admin");
    expect(f.page.some((r) => r.summary.includes("Grade 11"))).toBe(false);
    const actions = await admin.query(api.audit.actions, {});
    const filtered = await admin.query(api.audit.feed, { action: actions[0], paginationOpts: { numItems: 10, cursor: null } });
    expect(filtered.page.every((r) => r.action === actions[0])).toBe(true);
    for (const u of [A.users.classTeacher, A.users.student]) expect(await errorCode((await as(t, u)).query(api.audit.feed, { paginationOpts: { numItems: 10, cursor: null } }))).toBe("FORBIDDEN");
  });
});

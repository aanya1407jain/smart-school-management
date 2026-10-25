/**
 * Audit semantics: `auditLogs.actorRole` is the role of WHO acted; the affected
 * account's role is `metadata.targetRole`. Student accounts created by an
 * administrator must read actor = admin, target = student — and the created
 * memberships must really be student memberships linked to their students.
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { activatePendingAccount, reserveAccount } from "../../convex/model/accounts";

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const admin = await as(t, A.users.admin);
  const students = await t.run(async (ctx) => {
    const ids: Id<"students">[] = [];
    for (const first of ["Kabir", "Lina", "Omar"]) {
      const id = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: `AR-${first}`, scholarNo: `AR-${first}`.toUpperCase(), scholarNoKey: `AR-${first}`.toUpperCase(), firstName: first, lastName: "Rao", status: "active", admissionDate: "2026-04-01" });
      await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: id, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionA, status: "active", startDate: "2026-04-01" });
      ids.push(id);
    }
    return ids;
  });
  return { t, A, admin, students };
}

const createdEvents = (t: T) => t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === "account.created"));
const membership = (t: T, id: string) => t.run((ctx) => ctx.db.get(id as Id<"schoolMemberships">)) as Promise<Doc<"schoolMemberships">>;

describe("audit: actor role vs target role", () => {
  test("individual student account: actorRole = admin (who), targetRole = student (created account)", async () => {
    const { t, A, admin, students } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: students[0] } });
    const [ev] = await createdEvents(t);
    expect(ev.actorUserId).toBe(A.users.admin);
    expect(ev.actorRole).toBe("admin");
    expect(ev.entity).toEqual({ table: "schoolMemberships", id: r.membershipId });
    expect(ev.metadata).toEqual({ targetRole: "student", targetKind: "student", targetLoginId: r.loginId });
    // Independent of the audit log: the membership really is a student account linked to the student.
    const m = await membership(t, r.membershipId);
    expect(m).toMatchObject({ role: "student", studentId: students[0], status: "active", loginId: r.loginId, permissionSets: [] });
    expect(m.guardianId).toBeUndefined();
    expect(m.teacherId).toBeUndefined();
  });

  test("bulk student accounts: every account.created is actor admin / target student; run events are the admin's", async () => {
    const { t, A, admin, students } = await setup();
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: students } });
    await admin.mutation(api.bulkAccounts.startJob, { jobId });
    const creds = [];
    for (;;) {
      const res = await admin.action(api.bulkAccounts.processBatch, { jobId });
      creds.push(...res.credentials);
      if (res.credentials.length) await admin.mutation(api.bulkAccounts.acknowledge, { jobId, itemIds: res.credentials.map((c) => c.itemId) });
      if (res.done) break;
    }
    expect(creds).toHaveLength(3);
    const events = await createdEvents(t);
    expect(events).toHaveLength(3);
    for (const ev of events) {
      expect(ev.actorRole).toBe("admin");
      expect(ev.actorUserId).toBe(A.users.admin);
      expect(ev.metadata).toMatchObject({ targetRole: "student", targetKind: "student" });
      const m = await membership(t, ev.entity.id);
      expect(m.role).toBe("student");
      expect(students).toContain(m.studentId);
      expect((ev.metadata as { targetLoginId: string }).targetLoginId).toBe(m.loginId);
    }
    // Each student got exactly one student membership.
    const all = await t.run(async (ctx) => (await ctx.db.query("schoolMemberships").collect()).filter((m) => m.studentId && students.includes(m.studentId)));
    expect(all.map((m) => m.role)).toEqual(["student", "student", "student"]);
    // Run-level events describe the job, acted by the admin.
    const runEvents = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action.startsWith("accounts.bulk_")));
    expect(runEvents.map((e) => [e.action, e.actorRole, e.entity.table])).toEqual([
      ["accounts.bulk_started", "admin", "bulkAccountJobs"],
      ["accounts.bulk_completed", "admin", "bulkAccountJobs"],
    ]);
  });

  test("teacher and office accounts record their own target role/kind; actor stays admin", async () => {
    const { t, A, admin } = await setup();
    const extraTeacher = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-AR", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
    await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: extraTeacher } });
    await admin.action(api.accounts.create, { person: { kind: "staff", displayName: "Office", accountantOnly: true } });
    const events = await createdEvents(t);
    expect(events.map((e) => [e.actorRole, (e.metadata as { targetRole: string }).targetRole, (e.metadata as { targetKind: string }).targetKind])).toEqual([
      ["admin", "teacher", "teacher"],
      ["admin", "admin", "admin"],
    ]);
  });

  test("a guardian account can no longer be created through the API (only admin, teacher, student)", async () => {
    const { t, A, admin } = await setup();
    const contactId = A.parentContactId;
    // Rejected by the argument validator: "guardian" is no longer a person kind.
    expect(await errorCode(admin.action(api.accounts.create, { person: { kind: "guardian", guardianId: contactId } } as never))).toMatch(/^THROWN: .*(ArgumentValidationError|Validator)/s);
    expect(await t.run(async (ctx) => (await ctx.db.query("schoolMemberships").collect()).filter((m) => m.guardianId && m._id !== A.memberships.legacyGuardian).length)).toBe(0);
  });

  test("actorRole is derived from the creator's membership, not assumed to be admin", async () => {
    const { t, A, students } = await setup();
    // Simulate a reservation recorded by a non-admin member (not possible through the
    // public API today — creation requires admin-only permissions — but the audit must not lie).
    await t.run(async (ctx) => {
      const { loginId } = await reserveAccount(ctx, { schoolId: A.schoolId, role: "student", kind: "student", year: "2026", displayName: "Kabir Rao", studentId: students[0], createdByUserId: A.users.classTeacher });
      await activatePendingAccount(ctx, { loginId, mustChangePassword: true });
    });
    const [ev] = await createdEvents(t);
    expect(ev.actorUserId).toBe(A.users.classTeacher);
    expect(ev.actorRole).toBe("teacher");
    expect(ev.metadata).toMatchObject({ targetRole: "student" });
  });

  test("credential, status and access events carry the target account's role", async () => {
    const { t, admin, students } = await setup();
    const r = await admin.action(api.accounts.create, { person: { kind: "student", studentId: students[1] } });
    await admin.action(api.accounts.issueTemporaryPassword, { targetMembershipId: r.membershipId });
    await admin.action(api.accounts.setStatus, { targetMembershipId: r.membershipId, status: "suspended" });
    await admin.mutation(api.memberships.updateAccess, { targetMembershipId: r.membershipId, status: "active" });
    const rows = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.entity.id === r.membershipId));
    expect(rows.map((e) => [e.action, e.actorRole, (e.metadata as { targetRole?: string }).targetRole])).toEqual([
      ["account.created", "admin", "student"],
      ["account.credentials_issued", "admin", "student"],
      ["account.disabled", "admin", "student"],
      ["membership.access_changed", "admin", "student"],
    ]);
  });

  test("accountCreationReport verifies real membership roles independently and writes nothing", async () => {
    const { t, admin, students } = await setup();
    for (const s of students) await admin.action(api.accounts.create, { person: { kind: "student", studentId: s } });
    const count = () => t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).length + (await ctx.db.query("schoolMemberships").collect()).length);
    const before = await count();
    const rep = await t.query(internal.audit.accountCreationReport, { schoolSlug: "alpha" });
    expect(rep).toEqual({ found: true, accountCreatedEvents: 3, byActorRole: { admin: 3 }, byTargetRole: { student: 3 }, problems: [] });
    expect(await count()).toBe(before);
  });
});

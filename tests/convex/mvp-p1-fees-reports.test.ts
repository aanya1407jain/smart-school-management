/**
 * P1-H/I/J: fee corrections (revoke concession, cancel assignment, structure
 * edit), fee-due reminders (dedupe per installment + recipient, settings,
 * isolation) and the per-student low-attendance report.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

const plan = {
  name: "Tuition 2026-27",
  components: [{ label: "Tuition", amountMinor: 30000 }],
  installments: [
    { label: "Term 1", dueDate: "2026-05-01", amountMinor: 10000 },
    { label: "Term 2", dueDate: "2026-10-20", amountMinor: 10000 },
    { label: "Term 3", dueDate: "2027-01-01", amountMinor: 10000 },
  ],
};

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  const admin = await as(t, A.users.admin);
  const { structureId } = await admin.mutation(api.fees.createStructure, { ...plan, classIds: [A.classId], activate: true });
  return { t, A, B, admin, structureId };
}
const audits = (t: T, action: string) => t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === action));
const pay = (studentId: Id<"students">, amountMinor: number, id: string) => ({ studentId, amountMinor, method: "cash" as const, paidOn: "2026-06-01", clientRequestId: `req-${id}-0001` });

describe("fee corrections", () => {
  test("revoking a concession restores the balance, keeps the row, needs a reason, is audited and fee-manager only", async () => {
    const { t, A, B, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    await admin.mutation(api.fees.addConcession, { studentId: A.studentA, kind: "fixed", value: 5000, reason: "Sibling" });
    let l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals.outstandingMinor).toBe(25000);
    const concessionId = l.concessions[0].concessionId;

    expect(await errorCode(admin.mutation(api.fees.revokeConcession, { concessionId, reason: "  " }))).toBe("INVALID_ARGUMENT");
    for (const u of [A.users.classTeacher, A.users.student]) {
      expect(await errorCode((await as(t, u)).mutation(api.fees.revokeConcession, { concessionId, reason: "x" }))).toBe("FORBIDDEN");
    }
    expect(await errorCode((await as(t, B.users.admin)).mutation(api.fees.revokeConcession, { concessionId, reason: "x" }))).toBe("NOT_FOUND");

    await admin.mutation(api.fees.revokeConcession, { concessionId, reason: "Sibling left" });
    l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals.outstandingMinor).toBe(30000);
    expect(l.concessions.map((c) => c.status)).toEqual(["revoked"]); // kept, not deleted
    const logs = await audits(t, "fees.concession_revoked");
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toMatchObject({ reason: "Sibling left" });
  });

  test("cancelling an assignment is refused while payments are allocated, then allowed after reversal; rows are kept as cancelled", async () => {
    const { t, A, B, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    const { paymentId } = await admin.mutation(api.fees.recordPayment, pay(A.studentA, 4000, "p1"));
    expect(await errorCode(admin.mutation(api.fees.cancelAssignment, { studentId: A.studentA, structureId, reason: "Left transport" }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.fees.cancelAssignment, { studentId: A.studentA, structureId, reason: "" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode((await as(t, B.users.admin)).mutation(api.fees.cancelAssignment, { studentId: A.studentA, structureId, reason: "x" }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.fees.cancelAssignment, { studentId: A.studentA, structureId, reason: "x" }))).toBe("FORBIDDEN");

    await admin.mutation(api.fees.reversePayment, { paymentId, reason: "Cheque bounced" });
    expect(await admin.mutation(api.fees.cancelAssignment, { studentId: A.studentA, structureId, reason: "Withdrawn" })).toEqual({ cancelled: 3 });
    const l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals.outstandingMinor).toBe(0);
    expect(l.standing).toBe("not_assigned");
    const rows = await t.run(async (ctx) => (await ctx.db.query("studentFees").collect()).map((r) => r.status));
    expect(rows).toEqual(["cancelled", "cancelled", "cancelled"]);
    const payments = await t.run(async (ctx) => (await ctx.db.query("feePayments").collect()).length);
    expect(payments).toBe(2); // original + reversal, append-only
    expect(await audits(t, "fees.assignment_cancelled")).toHaveLength(1);
    expect(await audits(t, "fees.payment_reversed")).toHaveLength(1);
  });

  test("structure edit: amounts change only while unused; name and classes can change later; archived is locked", async () => {
    const { t, A, B, admin, structureId } = await setup();
    await admin.mutation(api.fees.updateStructure, { structureId, components: [{ label: "Tuition", amountMinor: 36000 }], installments: plan.installments.map((i) => ({ ...i, amountMinor: 12000 })) });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    expect((await admin.query(api.fees.studentLedger, { studentId: A.studentA })).totals.grossMinor).toBe(36000);
    expect(await errorCode(admin.mutation(api.fees.updateStructure, { structureId, installments: plan.installments }))).toBe("CONFLICT");
    await admin.mutation(api.fees.updateStructure, { structureId, name: "Tuition (renamed)" });
    expect((await admin.query(api.fees.listStructures, {})).map((s) => [s.name, s.inUse])).toEqual([["Tuition (renamed)", true]]);
    expect(await errorCode((await as(t, B.users.admin)).mutation(api.fees.updateStructure, { structureId, name: "x" }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.fees.updateStructure, { structureId, name: "x" }))).toBe("FORBIDDEN");
    expect(await audits(t, "fees.structure_updated")).toHaveLength(2);
  });
});

describe("fee-due reminders", () => {
  afterEach(() => { vi.useRealTimers(); });
  const feeNotes = (t: T) => t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.type === "fees").map((n) => ({ userId: n.userId, title: n.title, key: n.dedupeKey })));

  test("due-soon and overdue reminders go once per installment and recipient; paid installments and other schools are skipped", async () => {
    const { t, A, B, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA, A.studentB] } });
    // Bala (studentB) has no login: no recipients. Asha's Term 1 (overdue since 05-01) is outside the 30-day lookback on 10-18.
    const today = "2026-10-18";
    let r = await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today });
    expect(r.done).toBe(true);
    let notes = await feeNotes(t);
    // Term 2 (due 10-20) for Asha → her own login only (no parent/guardian accounts exist).
    expect(notes.map((n) => [n.title, n.userId])).toEqual([["Fee due soon", A.users.student]]);
    expect(new Set(notes.map((n) => n.key)).size).toBe(1);
    expect(notes[0].key).toMatch(/^fees\.due:/);

    // Re-run: nothing new.
    r = await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today });
    expect(r.sent).toBe(0);
    expect(await feeNotes(t)).toHaveLength(1);

    // After the due date: one overdue reminder, once.
    await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today: "2026-10-25" });
    await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today: "2026-10-26" });
    notes = await feeNotes(t);
    expect(notes.filter((n) => n.title === "Fee overdue")).toHaveLength(1);

    // Paying it off stops further reminders for that installment (Term 3 is due 01-01 but fully paid).
    await admin.mutation(api.fees.recordPayment, pay(A.studentA, 30000, "full"));
    const before = (await feeNotes(t)).length;
    expect((await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today: "2026-12-29" })).sent).toBe(0);
    expect((await feeNotes(t)).length).toBe(before);

    // School B has no fees and gets nothing; nothing of A reaches B's users.
    await t.mutation(internal.feeReminders.remindSchool, { schoolId: B.schoolId, cursor: null, today });
    const bUsers = new Set<string>(Object.values(B.users));
    expect((await feeNotes(t)).some((n) => bUsers.has(n.userId))).toBe(false);
  });

  test("respects the school's feeReminders setting and skips inactive schools", async () => {
    const { t, A, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", A.schoolId)).unique())!;
      await ctx.db.patch(s._id, { notifications: { ...s.notifications, feeReminders: false } });
    });
    expect(await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today: "2026-10-18" })).toMatchObject({ sent: 0, skipped: "disabled" });
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", A.schoolId)).unique())!;
      await ctx.db.patch(s._id, { notifications: { ...s.notifications, feeReminders: true } });
      await ctx.db.patch(A.schoolId, { status: "suspended" });
    });
    expect(await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today: "2026-10-18" })).toMatchObject({ sent: 0, skipped: "inactive" });
    expect(await feeNotes(t)).toHaveLength(0);
  });

  test("the daily job fans out to active schools and uses each school's local date", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T03:00:00Z") });
    const { t, A, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    expect(await t.mutation(internal.feeReminders.runDaily, {})).toEqual({ scheduled: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await feeNotes(t)).map((n) => n.title)).toEqual(["Fee due soon"]);
  });
});

describe("low-attendance report", () => {
  test("lists students below the school's threshold using its late rule; section filter; admin/report readers only", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const ct = await as(t, A.users.classTeacher);
    const st = await as(t, A.users.subjectTeacher);
    // Asha (8-A): 2 present, 1 late, 2 absent → 60% (late counts) — below 85.
    const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    const asha = ["present", "present", "late", "absent", "absent"] as const;
    for (let i = 0; i < days.length; i++) await ct.mutation(api.attendance.mark, { sectionId: A.sectionA, date: days[i], entries: [{ studentId: A.studentA, status: asha[i] }] });
    // Bala (8-B): all present → not listed.
    for (const d of days) await st.mutation(api.attendance.mark, { sectionId: A.sectionB, date: d, entries: [{ studentId: A.studentB, status: "present" }] });

    const r = await admin.query(api.attendanceReports.lowAttendance, { from: "2026-10-01", to: "2026-10-10" });
    expect(r.threshold).toBe(85);
    expect(r.students.map((s) => [s.name, s.percentage, s.absent, s.late, s.classLabel])).toEqual([["Asha S", 60, 2, 1, "8-A"]]);
    expect((await admin.query(api.attendanceReports.lowAttendance, { sectionId: A.sectionB, from: "2026-10-01", to: "2026-10-10" })).students).toEqual([]);

    // Raising the threshold / changing the late rule is reflected.
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", A.schoolId)).unique())!;
      await ctx.db.patch(s._id, { attendance: { lateCountsAsPresent: false, lowAttendanceThreshold: 85 } });
    });
    expect((await admin.query(api.attendanceReports.lowAttendance, { from: "2026-10-01", to: "2026-10-10" })).students[0].percentage).toBe(40);

    // Other school: nothing of A; A's section id is not found there.
    expect((await (await as(t, B.users.admin)).query(api.attendanceReports.lowAttendance, {})).students).toEqual([]);
    expect(await errorCode((await as(t, B.users.admin)).query(api.attendanceReports.lowAttendance, { sectionId: A.sectionA }))).toBe("NOT_FOUND");
    for (const u of [A.users.student, A.users.classTeacher]) {
      expect(await errorCode((await as(t, u)).query(api.attendanceReports.lowAttendance, {}))).toBe("FORBIDDEN");
    }
    expect(await errorCode(admin.query(api.attendanceReports.lowAttendance, { from: "2026-10-10", to: "2026-10-01" }))).toBe("INVALID_ARGUMENT");
  });
});

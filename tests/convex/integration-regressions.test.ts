/**
 * Regression tests for the defects found in the integration audit of
 * PR #11 (finance & communications) and the academics workspace commit:
 * payment retries, overpayment, foreign allocations, future dates, receipt
 * sequencing, notice audiences, draft-publish notifications, notice
 * lifecycle, concession totals, academics admin actions, canonical roster
 * order and admin / accountant permission boundaries.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { addDays, todayIn } from "../../convex/model/calendar";
import { startOfDayMs } from "../../convex/notices";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;
const TODAY = todayIn("Asia/Kolkata");
let seq = 0;
const rid = () => `req-${Date.now()}-${++seq}`;

/** One active structure (2 × 1000) assigned to the whole class. */
async function feesFor(t: T, S: School) {
  const admin = await as(t, S.users.admin);
  const { structureId } = await admin.mutation(api.fees.createStructure, {
    name: "Tuition", classIds: [S.classId], activate: true,
    components: [{ label: "Tuition", amountMinor: 2000 }],
    installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 1000 }, { label: "Term 2", dueDate: "2026-12-01", amountMinor: 1000 }],
  });
  await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: S.classId } });
  return { admin, structureId };
}
const pay = (S: School, extra: Record<string, unknown> = {}) => ({ studentId: S.studentA, amountMinor: 500, method: "cash" as const, paidOn: "2026-06-01", clientRequestId: rid(), ...extra });
const receiptsOf = (t: T, studentId: Id<"students">) => t.run(async (ctx) => (await ctx.db.query("receipts").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()).length);
const paymentsOf = (t: T, studentId: Id<"students">) => t.run(async (ctx) => (await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", studentId)).collect()).length);

afterEach(() => vi.useRealTimers());

describe("payment integrity", () => {
  test("a retried payment request (same key) creates exactly one payment and one receipt", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { admin } = await feesFor(t, A);
    const req = pay(A);
    const first = await admin.mutation(api.fees.recordPayment, req);
    const retry = await admin.mutation(api.fees.recordPayment, req);
    const retry2 = await admin.mutation(api.fees.recordPayment, { ...req, reference: "changed text is ignored on retry" });
    expect(first.duplicate).toBe(false);
    expect(retry).toMatchObject({ duplicate: true, paymentId: first.paymentId, receiptId: first.receiptId, receiptNo: first.receiptNo });
    expect(retry2.paymentId).toBe(first.paymentId);
    expect(await paymentsOf(t, A.studentA)).toBe(1);
    expect(await receiptsOf(t, A.studentA)).toBe(1);
    // The same key for a different amount or student is refused, not silently merged.
    expect(await errorCode(admin.mutation(api.fees.recordPayment, { ...req, amountMinor: 600 }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, { ...req, studentId: A.studentB }))).toBe("CONFLICT");
    // A missing / too-short key is rejected.
    expect(await errorCode(admin.mutation(api.fees.recordPayment, { ...req, clientRequestId: "short" }))).toBe("INVALID_ARGUMENT");
  });

  test("payments above the outstanding balance are rejected and nothing is written", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { admin } = await feesFor(t, A);
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 2001 })))).toBe("INVALID_ARGUMENT");
    expect(await paymentsOf(t, A.studentA)).toBe(0);
    await admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 2000 }));
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 1 })))).toBe("CONFLICT"); // nothing outstanding
    const l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals).toMatchObject({ paidMinor: 2000, outstandingMinor: 0 });
    // Non-integer / zero / negative amounts are refused too.
    for (const amountMinor of [0, -5, 10.5]) expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(A, { amountMinor })))).toBe("INVALID_ARGUMENT");
  });

  test("allocations cannot be pointed at another student's or another school's fee rows", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const { admin } = await feesFor(t, A);
    await feesFor(t, B);
    const foreignFee = await t.run(async (ctx) => (await ctx.db.query("studentFees").collect()).find((f) => f.schoolId === B.schoolId)!._id);
    // The API has no client-supplied allocation list: the server allocates to the student's own rows.
    await expect(admin.mutation(api.fees.recordPayment, { ...pay(A), allocations: [{ studentFeeId: foreignFee, amountMinor: 500 }] } as never)).rejects.toThrow(/Validator|extra field|allocations/i);
    // Another school's student is not found.
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(A, { studentId: B.studentA })))).toBe("NOT_FOUND");
    const r = await admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 1500 }));
    const own = await t.run(async (ctx) => (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", A.studentA).eq("academicYearId", A.yearId)).collect()).map((f) => f._id));
    expect(r.allocations.every((x) => own.includes(x.studentFeeId))).toBe(true);
    expect(r.allocations.map((x) => x.amountMinor)).toEqual([1000, 500]); // oldest due date first
  });

  test("future payment dates are rejected using the school's own timezone", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    // A UTC+14 school: its "today" can be a day ahead of UTC.
    await t.run((ctx) => ctx.db.patch(A.schoolId, { timezone: "Pacific/Kiritimati" }));
    const { admin } = await feesFor(t, A);
    const schoolToday = todayIn("Pacific/Kiritimati");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(A, { paidOn: addDays(schoolToday, 1) })))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(A, { paidOn: "2026-02-30" })))).toBe("INVALID_ARGUMENT");
    expect((await admin.mutation(api.fees.recordPayment, pay(A, { paidOn: schoolToday }))).duplicate).toBe(false);
  });

  test("receipt numbers stay unique and sequential when payments are submitted together", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { admin } = await feesFor(t, A);
    const results = await Promise.all([
      admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 100 })),
      admin.mutation(api.fees.recordPayment, pay(A, { studentId: A.studentB, amountMinor: 100 })),
      admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 100 })),
      admin.mutation(api.fees.recordPayment, pay(A, { studentId: A.studentB, amountMinor: 100 })),
    ]);
    const numbers = results.map((r) => Number(r.receiptNo.split("/").pop())).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(4);
    expect(numbers[3] - numbers[0]).toBe(3);
  });
});

describe("fee totals", () => {
  test("percentage and fixed concessions: overview, balances and fee report equal the sum of student ledgers", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { admin } = await feesFor(t, A);
    await admin.mutation(api.fees.addConcession, { studentId: A.studentA, kind: "percent", value: 2500, reason: "Sibling" }); // 25 %
    await admin.mutation(api.fees.addConcession, { studentId: A.studentB, kind: "fixed", value: 300, reason: "Merit" });
    await admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 700 }));
    const la = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    const lb = await admin.query(api.fees.studentLedger, { studentId: A.studentB });
    expect(la.totals).toMatchObject({ grossMinor: 2000, concessionMinor: 500, netMinor: 1500, paidMinor: 700, outstandingMinor: 800 });
    expect(lb.totals).toMatchObject({ grossMinor: 2000, concessionMinor: 300, netMinor: 1700, paidMinor: 0, outstandingMinor: 1700 });
    const o = await admin.query(api.fees.overview, {});
    expect(o.totals).toMatchObject({ grossMinor: 4000, concessionMinor: 800, netMinor: 3200, paidMinor: 700, outstandingMinor: 2500 });
    expect(o.collectionRate).toBeCloseTo((700 / 3200) * 100, 1);
    const b = await admin.query(api.fees.listBalances, {});
    expect(b.rows.reduce((a, r) => a + r.outstandingMinor, 0)).toBe(2500);
    expect(b.rows.reduce((a, r) => a + r.concessionMinor, 0)).toBe(800);
    const rep = await admin.query(api.reports.feeSummary, {});
    expect(rep.totals).toMatchObject({ grossMinor: 4000, concessionMinor: 800, paidMinor: 700, outstandingMinor: 2500 });
    // A reversed payment drops out everywhere.
    const paid = la.payments[0];
    await admin.mutation(api.fees.reversePayment, { paymentId: paid.paymentId, reason: "Bounced cheque" });
    expect((await admin.query(api.fees.overview, {})).totals.paidMinor).toBe(0);
    const listed = await admin.query(api.fees.listPayments, {});
    expect(listed.rows.find((r) => r.paymentId === paid.paymentId)?.reversed).toBe(true);
  });

  test("balances report real next-due installments and standings; payments list shows real receipts", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { admin } = await feesFor(t, A);
    const r = await admin.mutation(api.fees.recordPayment, pay(A, { amountMinor: 1000, reference: "UPI-77" }));
    const rows = (await admin.query(api.fees.listBalances, {})).rows;
    const asha = rows.find((x) => x.studentId === A.studentA)!;
    expect(asha.nextDue).toMatchObject({ dueDate: "2026-12-01", outstandingMinor: 1000 });
    expect(asha.lastPaymentOn).toBe("2026-06-01");
    const bala = rows.find((x) => x.studentId === A.studentB)!;
    expect(bala.standing).toBe(TODAY > "2026-05-01" ? "overdue" : "due_soon");
    const p = (await admin.query(api.fees.listPayments, { search: "upi-77" })).rows;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ receiptNo: r.receiptNo, receiptId: r.receiptId, reference: "UPI-77", method: "cash", classLabel: "8-A" });
  });
});

describe("notices", () => {
  const draft = { title: "PTM", body: "Parent-teacher meeting", type: "notice" as const, priority: "normal" as const, publishDate: TODAY };

  test("audiences are validated against the school: another school's class or section is NOT_FOUND", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.notices.createDraft, { ...draft, audience: { kind: "sections", sectionIds: [B.sectionA] } }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.notices.createDraft, { ...draft, audience: { kind: "classes", classIds: [B.classId] } }))).toBe("NOT_FOUND");
    const { noticeId } = await admin.mutation(api.notices.createDraft, { ...draft, audience: { kind: "sections", sectionIds: [A.sectionA] } });
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId, audience: { kind: "sections", sectionIds: [A.sectionA, B.sectionB] } }))).toBe("NOT_FOUND");
  });

  test("publishing a normal-priority draft notifies its audience once", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const { noticeId } = await admin.mutation(api.notices.createDraft, { ...draft, audience: { kind: "sections", sectionIds: [A.sectionA] } });
    const r = await admin.mutation(api.notices.publish, { noticeId });
    expect(r.notified).toBeGreaterThan(0);
    await admin.mutation(api.notices.publish, { noticeId }); // idempotent
    const notes = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.type === "notice"));
    expect(notes.length).toBe(r.notified);
    expect(new Set(notes.map((n) => n.userId)).size).toBe(notes.length); // one per person
    expect(notes.some((n) => n.userId === A.users.admin)).toBe(false); // not the publisher
    expect(notes.some((n) => n.userId === A.users.student)).toBe(true);
    expect(notes.some((n) => n.userId === A.users.legacyGuardian)).toBe(false); // leftover guardian sign-ins get nothing
  });

  test("a future-dated notice is notified on its publish date (school-local), not before and only once", async () => {
    vi.useFakeTimers();
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const publishDate = addDays(TODAY, 2);
    const { noticeId } = await admin.mutation(api.notices.createDraft, { ...draft, publishDate, audience: { kind: "all" } });
    const r = await admin.mutation(api.notices.publish, { noticeId });
    expect(r).toMatchObject({ notified: 0, scheduled: true });
    const count = () => t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.type === "notice").length);
    expect(await count()).toBe(0);
    vi.setSystemTime(startOfDayMs(publishDate, "Asia/Kolkata") + 60_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await count();
    expect(after).toBeGreaterThan(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await count()).toBe(after);
  });

  test("lifecycle: restore returns an archived notice to draft, republishing never re-notifies, and nothing can hard-delete", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const pub = await admin.mutation(api.notices.createDraft, { ...draft, audience: { kind: "all" } });
    await admin.mutation(api.notices.publish, { noticeId: pub.noticeId });
    const before = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length);
    await admin.mutation(api.notices.archive, { noticeId: pub.noticeId });
    expect(await errorCode(admin.mutation(api.notices.publish, { noticeId: pub.noticeId }))).toBe("CONFLICT");
    expect((await admin.mutation(api.notices.restore, { noticeId: pub.noticeId })).status).toBe("draft");
    expect((await admin.query(api.notices.feed, {})).some((n) => n.noticeId === pub.noticeId)).toBe(false); // off the board until republished
    await admin.mutation(api.notices.publish, { noticeId: pub.noticeId });
    expect(await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length)).toBe(before);
    const d = await admin.mutation(api.notices.createDraft, { ...draft, audience: { kind: "all" } });
    await admin.mutation(api.notices.archive, { noticeId: d.noticeId });
    expect((await admin.mutation(api.notices.restore, { noticeId: d.noticeId })).status).toBe("draft");
    expect(await errorCode(admin.mutation(api.notices.restore, { noticeId: d.noticeId }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.notices.update, { noticeId: pub.noticeId, title: "x" }))).toBe("CONFLICT"); // published = immutable
    expect("remove" in api.notices).toBe(false);
    // Managers see author and readable audience.
    const list = await admin.query(api.notices.listManaged, {});
    expect(list.find((n) => n.noticeId === pub.noticeId)).toMatchObject({ audienceLabel: "Whole school", status: "published" });
  });
});

describe("academics admin actions", () => {
  test("current year: only managers, not a closed year, not another school's; planned becomes active", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const next = await admin.mutation(api.academics.createAcademicYear, { name: "2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "planned" });
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.academics.setCurrentAcademicYear, { academicYearId: next }))).toBe("FORBIDDEN");
    expect(await errorCode(admin.mutation(api.academics.setCurrentAcademicYear, { academicYearId: B.yearId }))).toBe("NOT_FOUND");
    expect(await admin.mutation(api.academics.setCurrentAcademicYear, { academicYearId: next })).toMatchObject({ changed: true });
    const years = await admin.query(api.academics.listAcademicYears, {});
    expect(years.find((y) => y._id === next)).toMatchObject({ isCurrent: true, status: "active" });
    await t.run((ctx) => ctx.db.patch(A.yearId, { status: "closed" }));
    expect(await errorCode(admin.mutation(api.academics.setCurrentAcademicYear, { academicYearId: A.yearId }))).toBe("CONFLICT");
  });

  test("teacher assignment, curriculum and class teacher are enforced on the server", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const science = await admin.mutation(api.academics.createSubject, { name: "Science", code: "SCI" });
    // Not in the curriculum yet → rejected.
    expect(await errorCode(admin.mutation(api.academics.assignSubjectTeacher, { sectionId: A.sectionA, subjectId: science, teacherId: A.classTeacher }))).toBe("INVALID_RELATIONSHIP");
    await admin.mutation(api.academics.setClassSubjects, { classId: A.classId, academicYearId: A.yearId, subjectIds: [A.subjectId, science] });
    await admin.mutation(api.academics.assignSubjectTeacher, { sectionId: A.sectionA, subjectId: science, teacherId: A.classTeacher });
    const rows = await admin.query(api.academics.listTeacherAssignments, { sectionId: A.sectionA });
    expect(rows.map((r) => r.subjectName).sort()).toEqual(["Mathematics", "Science"]);
    // Teachers cannot assign; a teacher owns at most one section per year.
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.academics.assignSubjectTeacher, { sectionId: A.sectionA, subjectId: science, teacherId: A.classTeacher }))).toBe("FORBIDDEN");
    expect(await errorCode(admin.mutation(api.academics.setClassTeacher, { sectionId: A.sectionB, teacherId: A.classTeacher }))).toBe("CONFLICT");
    // Removing a subject that still has an assignment is refused.
    expect(await errorCode(admin.mutation(api.academics.setClassSubjects, { classId: A.classId, academicYearId: A.yearId, subjectIds: [A.subjectId] }))).toBe("INVALID_RELATIONSHIP");
    expect((await admin.query(api.academics.listTeachers, {})).map((x) => x.teacherId).sort()).toEqual([A.classTeacher, A.subjectTeacher].sort());
  });

  test("unenrolled students are listed and enrolling them keeps the canonical alphabetical roll order", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const admin = await as(t, A.users.admin);
    const names = [["Zoë", "Khan"], ["D'Souza", "Ann"], ["aarav", "Mehta"], ["Aarav", "Iyer"], ["Élan", "Roy"]];
    const ids: Id<"students">[] = [];
    await t.run(async (ctx) => {
      for (const [firstName, lastName] of names) ids.push(await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: `N-${firstName}`, firstName, lastName, status: "active" }));
    });
    const un = await admin.query(api.academics.listUnenrolledStudents, {});
    expect(un.students.map((s) => s.studentId).sort()).toEqual([...ids].sort());
    for (const id of ids) await admin.mutation(api.academics.enrollStudent, { studentId: id, sectionId: A.sectionA, startDate: "2026-06-01" });
    expect((await admin.query(api.academics.listUnenrolledStudents, {})).students).toHaveLength(0);
    const roster = await admin.query(api.academics.sectionRoster, { sectionId: A.sectionA });
    // The server's order IS the roll-number order: 1..n with no gaps — the UI must render it as-is.
    expect(roster.students.map((s) => s.rollNo)).toEqual(roster.students.map((_, i) => i + 1));
    expect(roster.students.map((s) => s.name)).toEqual(["Aarav Iyer", "aarav Mehta", "Asha S", "D'Souza Ann", "Élan Roy", "Zoë Khan"]);
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.academics.listUnenrolledStudents, {}))).toBe("FORBIDDEN");
  });
});

describe("admin and accountant boundaries", () => {
  test("dashboard: admin sees everything; a finance-only member sees fee figures only; teachers and students are refused", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const { admin } = await feesFor(t, A);
    const full = await admin.query(api.reports.adminDashboard, {});
    expect(full.overview).not.toBeNull();
    expect(full.fees).toMatchObject({ outstandingMinor: 4000, collectedMinor: 0 });
    expect(full.overview!.students).toBe(2);
    // Finance-only member (accountant set on a non-admin membership; built directly, the invite flow restricts sets to admins).
    await t.run((ctx) => ctx.db.patch(A.memberships.subjectTeacher, { permissionSets: ["accountant"] }));
    const acct = await as(t, A.users.subjectTeacher);
    const fin = await acct.query(api.reports.adminDashboard, {});
    expect(fin.overview).toBeNull();
    expect(fin.fees).not.toBeNull();
    expect((await acct.query(api.fees.listBalances, {})).rows.length).toBe(2);
    expect(await errorCode(acct.query(api.reports.studentStatistics, {}))).toBe("FORBIDDEN");
    expect(await errorCode(acct.mutation(api.academics.setCurrentAcademicYear, { academicYearId: A.yearId }))).toBe("FORBIDDEN");
    for (const u of [A.users.classTeacher, A.users.student]) {
      const c = await as(t, u);
      expect(await errorCode(c.query(api.reports.adminDashboard, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.fees.overview, {}))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.fees.listPayments, {}))).toBe("FORBIDDEN");
    }
    // A student reads only their own ledger; a leftover guardian sign-in reads nothing.
    const s = await as(t, A.users.student);
    expect((await s.query(api.fees.studentLedger, { studentId: A.studentA })).studentId).toBe(A.studentA);
    expect(await errorCode(s.query(api.fees.studentLedger, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode((await as(t, A.users.legacyGuardian)).query(api.fees.studentLedger, { studentId: A.studentA }))).toBe("NO_SCHOOL_ACCESS");
  });

  test("reports are school-scoped and count each student once", async () => {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    const stats = await admin.query(api.reports.studentStatistics, {});
    expect(stats.total).toBe(2);
    expect(stats.bySection.map((s) => [s.label, s.students])).toEqual([["8-A", 1], ["8-B", 1]]);
    expect(stats.parentContacts).toBe(1);
    await t.run((ctx) => ctx.db.insert("attendanceSessions", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, date: "2026-07-06", markedByUserId: A.users.classTeacher, markedByTeacherId: A.classTeacher, markedAt: 1, presentCount: 3, absentCount: 1, lateCount: 0, excusedCount: 2 }));
    const att = await admin.query(api.reports.attendanceReport, { from: "2026-07-01", to: "2026-07-31" });
    expect(att.monthly).toEqual([{ month: "2026-07", percentage: 75, late: 0, absent: 1, registers: 1 }]);
    expect(att.bySection.find((s) => s.label === "8-A")?.percentage).toBe(75);
    expect(att.bySection.find((s) => s.label === "8-B")?.percentage).toBeNull();
    expect(await errorCode(admin.query(api.reports.attendanceReport, { from: "2026-01-01", to: "2027-06-01" }))).toBe("INVALID_ARGUMENT");
  });
});

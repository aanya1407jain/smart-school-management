/**
 * A-02 fees: structures, assignment, concessions, allocation, receipts,
 * retry safety, reversals, authorization and tenant isolation.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { allocate } from "../../convex/fees";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;

const plan = {
  name: "Tuition 2026-27",
  components: [{ label: "Tuition", amountMinor: 30000 }],
  installments: [
    { label: "Term 1", dueDate: "2026-05-01", amountMinor: 10000 },
    { label: "Term 2", dueDate: "2026-09-01", amountMinor: 10000 },
    { label: "Term 3", dueDate: "2027-01-01", amountMinor: 10000 },
  ],
};

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  const admin = await as(t, A.users.admin);
  const { structureId } = await admin.mutation(api.fees.createStructure, { ...plan, classIds: [A.classId] });
  await admin.mutation(api.fees.setStructureStatus, { structureId, status: "active" });
  return { t, A, B, admin, structureId };
}

const counts = (t: T) => t.run(async (ctx) => ({
  payments: (await ctx.db.query("feePayments").collect()).length,
  receipts: (await ctx.db.query("receipts").collect()).length,
  fees: (await ctx.db.query("studentFees").collect()).length,
}));

describe("allocation rule (pure)", () => {
  test("oldest due first, partial, never beyond outstanding", () => {
    const o = (id: string, dueDate: string, outstandingMinor: number) => ({ obligationId: id as Id<"studentFees">, dueDate, outstandingMinor });
    expect(allocate(15000, [o("b", "2026-09-01", 10000), o("a", "2026-05-01", 10000)])).toEqual({ allocations: [{ studentFeeId: "a", amountMinor: 10000 }, { studentFeeId: "b", amountMinor: 5000 }], unallocated: 0 });
    expect(allocate(500, [o("a", "2026-05-01", 0), o("b", "2026-09-01", 300)])).toEqual({ allocations: [{ studentFeeId: "b", amountMinor: 300 }], unallocated: 200 });
  });
});

describe("structures and assignment", () => {
  test("validation: totals must match, due dates inside the year, unique names", async () => {
    const { admin, A } = await setup();
    expect(await errorCode(admin.mutation(api.fees.createStructure, { ...plan, name: "X", classIds: [A.classId], installments: [{ label: "One", dueDate: "2026-05-01", amountMinor: 1 }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.fees.createStructure, { ...plan, name: "Y", classIds: [A.classId], installments: plan.installments.map((i, k) => (k === 0 ? { ...i, dueDate: "2030-01-01" } : i)) }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.fees.createStructure, { ...plan, classIds: [A.classId] }))).toBe("CONFLICT");
    expect(await errorCode(admin.mutation(api.fees.createStructure, { ...plan, name: "Z", classIds: [A.classId], components: [{ label: "T", amountMinor: -5 }] }))).toBe("INVALID_ARGUMENT");
  });

  test("assigns one obligation per installment; re-assigning is a no-op; amounts lock once used", async () => {
    const { t, A, admin, structureId } = await setup();
    const r1 = await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: A.classId } });
    expect(r1.assigned).toBe(2); // Asha (8-A) and Bala (8-B)
    const before = await counts(t);
    expect(before.fees).toBe(6);
    const r2 = await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    expect(r2).toEqual({ assigned: 0, skipped: [{ studentId: A.studentA, reason: "already_assigned" }] });
    expect((await counts(t)).fees).toBe(6);
    expect(await errorCode(admin.mutation(api.fees.updateStructure, { structureId, components: [{ label: "Tuition", amountMinor: 1 }] }))).toBe("CONFLICT");
  });

  test("ineligible or foreign students are rejected", async () => {
    const { A, B, admin, structureId } = await setup();
    expect(await errorCode(admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [B.studentA] } }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "section", sectionId: B.sectionA } }))).toBe("NOT_FOUND");
    void A;
  });
});

describe("payments, concessions and receipts", () => {
  async function assigned() {
    const s = await setup();
    await s.admin.mutation(api.fees.assignStructure, { structureId: s.structureId, target: { kind: "students", studentIds: [s.A.studentA] } });
    return s;
  }
  const pay = (amountMinor: number, id: string, studentId: Id<"students">) => ({ studentId, amountMinor, method: "cash" as const, paidOn: "2026-06-01", clientRequestId: id });

  test("partial then full payment: oldest installment first, balances reconcile, receipts sequential", async () => {
    const { admin, A } = await assigned();
    const p1 = await admin.mutation(api.fees.recordPayment, pay(15000, "req-0000001", A.studentA));
    expect(p1.allocations.map((a) => a.amountMinor)).toEqual([10000, 5000]);
    const p2 = await admin.mutation(api.fees.recordPayment, pay(15000, "req-0000002", A.studentA));
    expect(p2.receiptNo).not.toBe(p1.receiptNo);
    expect(Number(p2.receiptNo.split("/").pop())).toBe(Number(p1.receiptNo.split("/").pop()) + 1);
    const ledger = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(ledger.totals).toEqual({ grossMinor: 30000, concessionMinor: 0, netMinor: 30000, paidMinor: 30000, outstandingMinor: 0, overdueMinor: 0, dueSoonMinor: 0 });
    expect(ledger.standing).toBe("paid");
    expect(ledger.payments).toHaveLength(2);
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(1, "req-0000003", A.studentA)))).toBe("CONFLICT"); // nothing outstanding
  });

  test("invalid amounts and overpayment are rejected; nothing is written", async () => {
    const { t, admin, A } = await assigned();
    const before = await counts(t);
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(0, "req-a0000001", A.studentA)))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(10.5, "req-a0000002", A.studentA)))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(30001, "req-a0000003", A.studentA)))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, { ...pay(100, "req-a0000004", A.studentA), paidOn: "2999-01-01" }))).toBe("INVALID_ARGUMENT");
    expect(await counts(t)).toEqual(before);
  });

  test("a retried request (same clientRequestId) returns the original payment — no double charge", async () => {
    const { t, admin, A } = await assigned();
    const a = await admin.mutation(api.fees.recordPayment, pay(5000, "retry-123456", A.studentA));
    const b = await admin.mutation(api.fees.recordPayment, pay(5000, "retry-123456", A.studentA));
    expect(b).toMatchObject({ paymentId: a.paymentId, receiptNo: a.receiptNo, duplicate: true });
    expect(await counts(t)).toMatchObject({ payments: 1, receipts: 1 });
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(6000, "retry-123456", A.studentA)))).toBe("CONFLICT");
  });

  test("concessions reduce what is outstanding; payments cannot exceed it", async () => {
    const { admin, A } = await assigned();
    await admin.mutation(api.fees.addConcession, { studentId: A.studentA, kind: "percent", value: 1000, reason: "Sibling" }); // 10%
    let l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals).toMatchObject({ concessionMinor: 3000, outstandingMinor: 27000 });
    expect(await errorCode(admin.mutation(api.fees.recordPayment, pay(27001, "req-c0000001", A.studentA)))).toBe("INVALID_ARGUMENT");
    await admin.mutation(api.fees.recordPayment, pay(27000, "req-c0000002", A.studentA));
    l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals.outstandingMinor).toBe(0);
    expect(await errorCode(admin.mutation(api.fees.addConcession, { studentId: A.studentA, kind: "percent", value: 20000, reason: "x" }))).toBe("INVALID_ARGUMENT");
  });

  test("reversal is append-only: the original stops counting, the receipt shows it reversed, it cannot be reversed twice", async () => {
    const { admin, A } = await assigned();
    const p = await admin.mutation(api.fees.recordPayment, pay(10000, "req-r0000001", A.studentA));
    await admin.mutation(api.fees.reversePayment, { paymentId: p.paymentId, reason: "Cheque bounced" });
    const l = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    expect(l.totals.paidMinor).toBe(0);
    expect((await admin.query(api.fees.receipt, { receiptId: p.receiptId })).payment.reversed).toBe(true);
    expect(await errorCode(admin.mutation(api.fees.reversePayment, { paymentId: p.paymentId, reason: "again" }))).toBe("CONFLICT");
  });

  test("collection summary counts each effective payment once", async () => {
    const { admin, A } = await assigned();
    await admin.mutation(api.fees.recordPayment, pay(4000, "req-s0000001", A.studentA));
    const p = await admin.mutation(api.fees.recordPayment, { ...pay(6000, "req-s0000002", A.studentA), method: "upi" });
    await admin.mutation(api.fees.reversePayment, { paymentId: p.paymentId, reason: "x" });
    const s = await admin.query(api.fees.collectionSummary, { from: "2026-04-01", to: "2027-03-31" });
    expect(s).toMatchObject({ totalMinor: 4000, payments: 1, reversed: 1, byMethod: { cash: 4000 } });
  });
});

describe("authorization and isolation", () => {
  test("teachers and students cannot write fees; students read only their own ledger; a legacy guardian sign-in reads none", async () => {
    const { t, A, B, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: A.classId } });
    const teacher = await as(t, A.users.classTeacher);
    const student = await as(t, A.users.student);
    const legacyGuardian = await as(t, A.users.legacyGuardian);
    expect(await errorCode(teacher.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 1, method: "cash", paidOn: "2026-06-01", clientRequestId: "t-12345678" }))).toBe("FORBIDDEN");
    expect(await errorCode(student.mutation(api.fees.addConcession, { studentId: A.studentA, kind: "fixed", value: 100, reason: "x" }))).toBe("FORBIDDEN");
    expect((await student.query(api.fees.studentLedger, { studentId: A.studentA })).totals.grossMinor).toBe(30000);
    expect(await errorCode(legacyGuardian.query(api.fees.studentLedger, { studentId: A.studentA }))).toBe("NO_SCHOOL_ACCESS");
    expect(await errorCode(student.query(api.fees.studentLedger, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(teacher.query(api.fees.studentLedger, { studentId: A.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.query(api.fees.studentLedger, { studentId: B.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(student.query(api.fees.collectionSummary, { from: "2026-04-01", to: "2026-05-01" }))).toBe("FORBIDDEN");
  });

  test("the accountant permission set can record payments without being an admin", async () => {
    const { t, A, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    await t.run((ctx) => ctx.db.patch(A.memberships.subjectTeacher, { permissionSets: ["accountant"] }));
    const accountant = await as(t, A.users.subjectTeacher);
    const r = await accountant.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 1000, method: "cash", paidOn: "2026-06-01", clientRequestId: "acct-1234567" });
    expect(r.receiptNo).toMatch(/\/0001$/);
  });
});

/**
 * PR #11 (AP-01) scenarios, adapted to the final fees API: structures are
 * activated before assignment, assignment takes a `target`, payments carry a
 * `clientRequestId`, the ledger is `studentLedger`, receipts are read by
 * `receiptId`, and list queries return `{ rows }`.
 */
describe("AP-01 scenarios from PR #11 (final API)", () => {
  let req = 0;
  const rid = () => `ap01-request-${++req}`;

  test("admin creates a fee structure, amounts are validated, and it is assigned to a class", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-a");
    const admin = await as(t, f.users.admin);
    const teacher = await as(t, f.users.classTeacher);
    const base = { classIds: [f.classId], components: [{ label: "Tuition", amountMinor: 500000 }] };

    expect(await errorCode(teacher.mutation(api.fees.createStructure, { ...base, name: "Tuition 2026", installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 500000 }] }))).toBe("FORBIDDEN");
    expect(await errorCode(admin.mutation(api.fees.createStructure, { ...base, name: "Tuition 2026", installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 400000 }] }))).toBe("INVALID_ARGUMENT");

    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Annual Tuition", classIds: [f.classId], activate: true,
      components: [{ label: "Tuition", amountMinor: 600000 }, { label: "Activity", amountMinor: 100000 }],
      installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 350000 }, { label: "Term 2", dueDate: "2026-10-01", amountMinor: 350000 }],
    });
    const first = await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: f.classId } });
    expect(first.assigned).toBe(2); // studentA (8-A) and studentB (8-B)
    const obligations = await t.run(async (ctx) => (await ctx.db.query("studentFees").collect()).filter((o) => o.feeStructureId === structureId).length);
    expect(obligations).toBe(4); // 2 students × 2 installments

    const again = await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: f.classId } });
    expect(again.assigned).toBe(0);
    expect(again.skipped.every((s) => s.reason === "already_assigned")).toBe(true);

    const structures = await admin.query(api.fees.listStructures, {});
    expect(structures).toHaveLength(1);
    expect(structures[0].totalMinor).toBe(700000);
    expect(structures[0].classNames).toContain("Grade 8");
    expect(structures[0].assignedCount).toBe(2);
  });

  test("payments issue sequential receipts, update the ledger, notify the student (only), and reverse once", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-b");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Standard Fee", classIds: [f.classId], activate: true, components: [{ label: "Tuition", amountMinor: 400000 }],
      installments: [{ label: "Installment 1", dueDate: "2026-05-01", amountMinor: 200000 }, { label: "Installment 2", dueDate: "2026-09-01", amountMinor: 200000 }],
    });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [f.studentA] } });

    const initial = await student.query(api.fees.studentLedger, { studentId: f.studentA });
    expect(initial.totals).toMatchObject({ grossMinor: 400000, outstandingMinor: 400000, paidMinor: 0 });

    const p1 = await admin.mutation(api.fees.recordPayment, { studentId: f.studentA, amountMinor: 150000, method: "upi", paidOn: "2026-05-02", reference: "UPI/123456", note: "Partial installment 1", clientRequestId: rid() });
    const p2 = await admin.mutation(api.fees.recordPayment, { studentId: f.studentA, amountMinor: 100000, method: "cash", paidOn: "2026-05-03", clientRequestId: rid() });
    expect(p1.receiptNo).toMatch(/\/0001$/);
    expect(p2.receiptNo).toMatch(/\/0002$/);

    const ledger = await student.query(api.fees.studentLedger, { studentId: f.studentA });
    expect(ledger.totals).toMatchObject({ paidMinor: 250000, outstandingMinor: 150000 });
    expect(ledger.payments).toHaveLength(2);

    const receipt = await admin.query(api.fees.receipt, { receiptId: p1.receiptId });
    expect(receipt.receiptNo).toBe(p1.receiptNo);
    expect(receipt.payment).toMatchObject({ amountMinor: 150000, method: "upi", reversed: false });
    expect(receipt.student.name).toBe("Asha S");
    expect(receipt.school.name).toBe("School school-b");

    const studentFees = (await student.query(api.notifications.list, {})).filter((n) => n.type === "fees");
    expect(studentFees).toHaveLength(2);
    expect(studentFees.some((n) => n.message.includes(p1.receiptNo))).toBe(true);
    expect(studentFees.some((n) => n.message.includes(p2.receiptNo))).toBe(true);
    // No parent/guardian accounts: a leftover guardian sign-in gets no fee notifications.
    expect(await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).some((n) => n.userId === f.users.legacyGuardian))).toBe(false);

    await admin.mutation(api.fees.reversePayment, { paymentId: p2.paymentId, reason: "Cheque bounce / duplicate" });
    const after = await student.query(api.fees.studentLedger, { studentId: f.studentA });
    expect(after.totals).toMatchObject({ paidMinor: 150000, outstandingMinor: 250000 });
    expect(await errorCode(admin.mutation(api.fees.reversePayment, { paymentId: p2.paymentId, reason: "Try again" }))).toBe("CONFLICT");
  });

  test("a percentage concession reduces the balance listing; nothing collected yet", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-c");
    const admin = await as(t, f.users.admin);
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Annual Fee", classIds: [f.classId], activate: true, components: [{ label: "Tuition", amountMinor: 500000 }],
      installments: [{ label: "Full", dueDate: "2026-04-15", amountMinor: 500000 }],
    });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: f.classId } });
    await admin.mutation(api.fees.addConcession, { studentId: f.studentA, kind: "percent", value: 2000, reason: "Sibling scholarship" });

    const { rows } = await admin.query(api.fees.listBalances, {});
    const a = rows.find((r) => r.studentId === f.studentA);
    expect(a).toMatchObject({ netMinor: 400000, outstandingMinor: 400000, standing: "overdue" });
    const b = rows.find((r) => r.studentId === f.studentB);
    expect(b?.outstandingMinor).toBe(500000);
    const overdue = await admin.query(api.fees.listBalances, { standing: "overdue" });
    expect(overdue.rows.map((r) => r.studentId).sort()).toEqual([f.studentA, f.studentB].sort());

    const summary = await admin.query(api.fees.collectionSummary, { from: "2026-04-01", to: "2026-10-01" });
    expect(summary).toMatchObject({ totalMinor: 0, payments: 0 });
  });

  test("listPayments: fee managers only, school-isolated, with method / date / search / class filters", async () => {
    const t = makeTest();
    const f1 = await createSchool(t, "school-x");
    const f2 = await createSchool(t, "school-y");
    const admin1 = await as(t, f1.users.admin);
    const admin2 = await as(t, f2.users.admin);
    expect(await errorCode((await as(t, f1.users.classTeacher)).query(api.fees.listPayments, {}))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, f1.users.student)).query(api.fees.listPayments, {}))).toBe("FORBIDDEN");

    const setupFee = async (admin: typeof admin1, f: School, amountMinor: number) => {
      const { structureId } = await admin.mutation(api.fees.createStructure, {
        name: "Standard Fee", classIds: [f.classId], activate: true, components: [{ label: "Tuition", amountMinor }],
        installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor }],
      });
      await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: f.classId } });
    };
    await setupFee(admin1, f1, 500000);
    await setupFee(admin2, f2, 300000);
    const pay1 = await admin1.mutation(api.fees.recordPayment, { studentId: f1.studentA, amountMinor: 200000, method: "upi", paidOn: "2026-05-02", reference: "UPI/TXN/999", clientRequestId: rid() });
    const pay2 = await admin1.mutation(api.fees.recordPayment, { studentId: f1.studentB, amountMinor: 150000, method: "cash", paidOn: "2026-05-10", reference: "CASH-RECEIPT-01", clientRequestId: rid() });
    const payS2 = await admin2.mutation(api.fees.recordPayment, { studentId: f2.studentA, amountMinor: 300000, method: "online", paidOn: "2026-05-05", reference: "NETBANK/S2/001", clientRequestId: rid() });

    const s1 = (await admin1.query(api.fees.listPayments, {})).rows;
    expect(s1.map((p) => p.paymentId).sort()).toEqual([pay1.paymentId, pay2.paymentId].sort());
    const s2 = (await admin2.query(api.fees.listPayments, {})).rows;
    expect(s2.map((p) => p.paymentId)).toEqual([payS2.paymentId]);
    expect(s2[0].method).toBe("online");

    expect(s1[0]).toMatchObject({ paidOn: "2026-05-10", method: "cash", amountMinor: 150000 });
    expect(s1[0].receiptNo).toBeTruthy();
    expect(s1[0].studentName).toBeTruthy();
    expect(s1[0].admissionNo).toBeTruthy();
    expect(s1[0].classLabel).toBe("8-B");

    expect((await admin1.query(api.fees.listPayments, { method: "upi" })).rows.map((p) => p.paymentId)).toEqual([pay1.paymentId]);
    expect((await admin1.query(api.fees.listPayments, { from: "2026-05-05", to: "2026-05-15" })).rows.map((p) => p.paymentId)).toEqual([pay2.paymentId]);
    expect((await admin1.query(api.fees.listPayments, { search: "TXN/999" })).rows.map((p) => p.paymentId)).toEqual([pay1.paymentId]);
    expect((await admin1.query(api.fees.listPayments, { classId: f1.classId })).rows).toHaveLength(2);
    // A class id from another school is rejected, not silently empty.
    expect(await errorCode(admin1.query(api.fees.listPayments, { classId: f2.classId }))).toBe("NOT_FOUND");
  });

  test("strict overpayment restriction and FIFO allocation validation", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-overpayment");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    // Setup 2 installments of 100000 paise (₹1,000 each) -> Total 200000 paise (₹2,000)
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Two-Term Fee",
      classIds: [f.classId],
      components: [{ label: "Tuition", amountMinor: 200000 }],
      installments: [
        { label: "Term 1", dueDate: "2026-05-01", amountMinor: 100000 },
        { label: "Term 2", dueDate: "2026-10-01", amountMinor: 100000 },
      ],
      activate: true,
    });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [f.studentA] } });

    // 1. Overpayment rejection: trying to pay 250000 paise when total due is 200000 paise
    const overpayErr = await errorCode(
      admin.mutation(api.fees.recordPayment, {
        studentId: f.studentA,
        amountMinor: 250000,
        method: "cash",
        paidOn: "2026-05-02",
        clientRequestId: "req-overpay-1",
      }),
    );
    expect(overpayErr).toBe("INVALID_ARGUMENT");

    // 2. FIFO Auto-allocation: pay 140000 paise
    // Should allocate 100000 to Term 1 (fully paid) and 40000 to Term 2 (60000 remaining)
    const p1 = await admin.mutation(api.fees.recordPayment, {
      studentId: f.studentA,
      amountMinor: 140000,
      method: "bank_transfer",
      paidOn: "2026-05-05",
      reference: "NEFT-1400",
      clientRequestId: "req-fifo-1",
    });
    expect(p1.receiptNo).toBeDefined();

    const ledgerAfterP1 = await student.query(api.fees.studentLedger, { studentId: f.studentA });
    expect(ledgerAfterP1.totals.paidMinor).toBe(140000);
    expect(ledgerAfterP1.totals.outstandingMinor).toBe(60000);

    const term1 = ledgerAfterP1.obligations.find((o) => o.label.includes("Term 1"));
    const term2 = ledgerAfterP1.obligations.find((o) => o.label.includes("Term 2"));
    expect(term1?.paidMinor).toBe(100000);
    expect(term1?.outstandingMinor).toBe(0);
    expect(term2?.paidMinor).toBe(40000);
    expect(term2?.outstandingMinor).toBe(60000);

    // 3. Second overpayment attempt: paying 70000 when only 60000 remains
    const secondOverpayErr = await errorCode(
      admin.mutation(api.fees.recordPayment, {
        studentId: f.studentA,
        amountMinor: 70000,
        method: "cash",
        paidOn: "2026-05-10",
        clientRequestId: "req-overpay-2",
      }),
    );
    expect(secondOverpayErr).toBe("INVALID_ARGUMENT");

    // 4. Explicit allocation overpayment: allocating 80000 to Term 2 when only 60000 is due
    if (term2) {
      const explicitOverpayErr = await errorCode(
        admin.mutation(api.fees.recordPayment, {
          studentId: f.studentA,
          amountMinor: 60000,
          method: "cash",
          paidOn: "2026-05-10",
          allocations: [{ studentFeeId: term2.obligationId, amountMinor: 80000 }],
          clientRequestId: "req-alloc-overpay",
        }),
      );
      expect(explicitOverpayErr).toBe("INVALID_ARGUMENT");

      // 4b. Duplicate allocation entry for the same obligation is rejected
      const dupAllocErr = await errorCode(
        admin.mutation(api.fees.recordPayment, {
          studentId: f.studentA,
          amountMinor: 60000,
          method: "cash",
          paidOn: "2026-05-10",
          allocations: [
            { studentFeeId: term2.obligationId, amountMinor: 30000 },
            { studentFeeId: term2.obligationId, amountMinor: 30000 },
          ],
          clientRequestId: "req-alloc-dup",
        }),
      );
      expect(dupAllocErr).toBe("INVALID_ARGUMENT");
    }

    // 5. Exact payment of remaining 60000 succeeds and clears all obligations
    const p2 = await admin.mutation(api.fees.recordPayment, {
      studentId: f.studentA,
      amountMinor: 60000,
      method: "cash",
      paidOn: "2026-05-10",
      clientRequestId: "req-exact-payment",
    });
    expect(p2.receiptNo).toBeDefined();

    const finalLedger = await student.query(api.fees.studentLedger, { studentId: f.studentA });
    expect(finalLedger.totals.paidMinor).toBe(200000);
    expect(finalLedger.totals.outstandingMinor).toBe(0);
  });
});

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
  test("teachers and students cannot write fees; students/guardians read only their own ledger", async () => {
    const { t, A, B, admin, structureId } = await setup();
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "class", classId: A.classId } });
    const teacher = await as(t, A.users.classTeacher);
    const student = await as(t, A.users.student);
    const guardian = await as(t, A.users.guardian);
    expect(await errorCode(teacher.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 1, method: "cash", paidOn: "2026-06-01", clientRequestId: "t-12345678" }))).toBe("FORBIDDEN");
    expect(await errorCode(student.mutation(api.fees.addConcession, { studentId: A.studentA, kind: "fixed", value: 100, reason: "x" }))).toBe("FORBIDDEN");
    expect((await student.query(api.fees.studentLedger, { studentId: A.studentA })).totals.grossMinor).toBe(30000);
    expect((await guardian.query(api.fees.studentLedger, { studentId: A.studentA })).totals.grossMinor).toBe(30000);
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

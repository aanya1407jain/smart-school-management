/**
 * In-process tests for Fees, Payments, Receipts, and Concessions.
 * Run with: npx vitest run tests/convex/fees.test.ts
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

describe("Fees, payments and receipts (AP-01)", () => {
  test("admin creates fee structure, validates amounts and assigns to class", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-a");
    const admin = await as(t, f.users.admin);
    const teacher = await as(t, f.users.classTeacher);

    // Non-admin cannot create structure
    const teacherErr = await errorCode(
      teacher.mutation(api.fees.createStructure, {
        name: "Tuition 2026",
        classIds: [f.classId],
        components: [{ label: "Tuition", amountMinor: 500000 }],
        installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 500000 }],
      }),
    );
    expect(teacherErr).toBe("FORBIDDEN");

    // Amount mismatch is rejected
    const mismatchErr = await errorCode(
      admin.mutation(api.fees.createStructure, {
        name: "Tuition 2026",
        classIds: [f.classId],
        components: [{ label: "Tuition", amountMinor: 500000 }],
        installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 400000 }],
      }),
    );
    expect(mismatchErr).toBe("INVALID_ARGUMENT");

    // Admin creates valid structure
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Annual Tuition",
      classIds: [f.classId],
      components: [
        { label: "Tuition", amountMinor: 600000 },
        { label: "Activity", amountMinor: 100000 },
      ],
      installments: [
        { label: "Term 1", dueDate: "2026-05-01", amountMinor: 350000 },
        { label: "Term 2", dueDate: "2026-10-01", amountMinor: 350000 },
      ],
    });
    expect(structureId).toBeDefined();

    // Assign to class
    const assignResult = await admin.mutation(api.fees.assignStructure, {
      structureId,
      classId: f.classId,
    });
    // studentA and studentB are enrolled in this class
    expect(assignResult.assignedStudents).toBe(2);
    expect(assignResult.createdObligations).toBe(4); // 2 students * 2 installments

    // Second assignment skips existing
    const reassignResult = await admin.mutation(api.fees.assignStructure, {
      structureId,
      classId: f.classId,
    });
    expect(reassignResult.createdObligations).toBe(0);

    // List structures
    const structures = await admin.query(api.fees.listStructures, {});
    expect(structures.length).toBe(1);
    expect(structures[0].totalMinor).toBe(700000);
    expect(structures[0].classNames).toContain("Grade 8");
  });

  test("atomic receipt generation, payment recording, ledger update, and notification delivery", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-b");
    const admin = await as(t, f.users.admin);
    const student = await as(t, f.users.student);

    // 1. Setup structure and assign to studentA
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Standard Fee",
      classIds: [f.classId],
      components: [{ label: "Tuition", amountMinor: 400000 }],
      installments: [
        { label: "Installment 1", dueDate: "2026-05-01", amountMinor: 200000 },
        { label: "Installment 2", dueDate: "2026-09-01", amountMinor: 200000 },
      ],
    });
    await admin.mutation(api.fees.assignStructure, { structureId, studentId: f.studentA });

    // Initial student ledger shows full outstanding
    const initialLedger = await student.query(api.fees.getStudentLedger, { studentId: f.studentA });
    expect(initialLedger.totals.grossMinor).toBe(400000);
    expect(initialLedger.totals.outstandingMinor).toBe(400000);
    expect(initialLedger.totals.paidMinor).toBe(0);

    // 2. Record first payment of 1500.00 (150000 paise)
    const p1 = await admin.mutation(api.fees.recordPayment, {
      studentId: f.studentA,
      amountMinor: 150000,
      method: "upi",
      paidOn: "2026-05-02",
      reference: "UPI/123456",
      note: "Partial installment 1",
    });
    expect(p1.receiptNo).toBe("SC/26-27/0001");

    // 3. Record second payment of 1000.00 (100000 paise)
    const p2 = await admin.mutation(api.fees.recordPayment, {
      studentId: f.studentA,
      amountMinor: 100000,
      method: "cash",
      paidOn: "2026-05-03",
    });
    expect(p2.receiptNo).toBe("SC/26-27/0002");

    // 4. Verify student ledger after payments
    const updatedLedger = await student.query(api.fees.getStudentLedger, { studentId: f.studentA });
    expect(updatedLedger.totals.paidMinor).toBe(250000);
    expect(updatedLedger.totals.outstandingMinor).toBe(150000);
    expect(updatedLedger.payments.length).toBe(2);
    expect(updatedLedger.payments[0].receiptNo).toBe("SC/26-27/0002");
    expect(updatedLedger.payments[1].receiptNo).toBe("SC/26-27/0001");

    // 5. Verify printable receipt query
    const receipt = await admin.query(api.fees.getReceipt, { paymentId: p1.paymentId });
    expect(receipt.receiptNo).toBe("SC/26-27/0001");
    expect(receipt.amountMinor).toBe(150000);
    expect(receipt.method).toBe("upi");
    expect(receipt.studentName).toBe("Asha S");
    expect(receipt.school.name).toBe("School school-b");

    // 6. Verify notification was sent to student and linked guardian
    const studentNotifs = await student.query(api.notifications.list, {});
    const feeNotifs = studentNotifs.filter((n) => n.type === "fees");
    expect(feeNotifs.length).toBe(2);
    expect(feeNotifs.some((n) => n.message.includes("SC/26-27/0001"))).toBe(true);
    expect(feeNotifs.some((n) => n.message.includes("SC/26-27/0002"))).toBe(true);

    const guardian = await as(t, f.users.guardian);
    const guardianNotifs = await guardian.query(api.notifications.list, {});
    expect(guardianNotifs.some((n) => n.type === "fees")).toBe(true);

    // 7. Test payment reversal
    const rev = await admin.mutation(api.fees.reversePayment, {
      paymentId: p2.paymentId,
      reason: "Cheque bounce / duplicate",
    });
    expect(rev.ok).toBe(true);

    // After reversal, outstanding balance is restored
    const ledgerAfterReversal = await student.query(api.fees.getStudentLedger, { studentId: f.studentA });
    expect(ledgerAfterReversal.totals.paidMinor).toBe(150000);
    expect(ledgerAfterReversal.totals.outstandingMinor).toBe(250000);

    // Cannot reverse twice
    const doubleRevErr = await errorCode(
      admin.mutation(api.fees.reversePayment, {
        paymentId: p2.paymentId,
        reason: "Try again",
      }),
    );
    expect(doubleRevErr).toBe("INVALID_ARGUMENT");
  });

  test("fee concessions and balance listing with standing filters", async () => {
    const t = makeTest();
    const f = await createSchool(t, "school-c");
    const admin = await as(t, f.users.admin);

    // Create and assign structure (500000 paise)
    const { structureId } = await admin.mutation(api.fees.createStructure, {
      name: "Annual Fee",
      classIds: [f.classId],
      components: [{ label: "Tuition", amountMinor: 500000 }],
      installments: [{ label: "Full", dueDate: "2026-04-15", amountMinor: 500000 }],
    });
    await admin.mutation(api.fees.assignStructure, { structureId, classId: f.classId });

    // Grant 20% concession (2000 basis points) to studentA
    await admin.mutation(api.fees.createConcession, {
      studentId: f.studentA,
      kind: "percent",
      value: 2000,
      reason: "Sibling scholarship",
    });

    // Check balances
    const balances = await admin.query(api.fees.listBalances, {});
    const aBal = balances.find((b) => b.studentId === f.studentA);
    expect(aBal).toBeDefined();
    expect(aBal?.netMinor).toBe(400000); // 500000 - 20% (100000)
    expect(aBal?.outstandingMinor).toBe(400000);

    // Collection summary
    const summary = await admin.query(api.fees.collectionSummary, {});
    expect(summary.collectedMinor).toBe(0);
    expect(summary.netMinor).toBeGreaterThan(0);
  });

  test("school-wide listPayments query with authorization, tenant isolation, and filters", async () => {
    const t = makeTest();
    const f1 = await createSchool(t, "school-x");
    const f2 = await createSchool(t, "school-y");

    const admin1 = await as(t, f1.users.admin);
    const teacher1 = await as(t, f1.users.classTeacher);
    const student1 = await as(t, f1.users.student);
    const admin2 = await as(t, f2.users.admin);

    // 1. Authorization: Non-admin users cannot access school-wide payment list
    const teacherErr = await errorCode(teacher1.query(api.fees.listPayments, {}));
    expect(teacherErr).toBe("FORBIDDEN");

    const studentErr = await errorCode(student1.query(api.fees.listPayments, {}));
    expect(studentErr).toBe("FORBIDDEN");

    // 2. Setup fee structure in school 1
    const { structureId: s1 } = await admin1.mutation(api.fees.createStructure, {
      name: "Standard Fee S1",
      classIds: [f1.classId],
      components: [{ label: "Tuition", amountMinor: 500000 }],
      installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 500000 }],
    });
    await admin1.mutation(api.fees.assignStructure, { structureId: s1, classId: f1.classId });

    // Record two payments in school 1: one UPI on 2026-05-02, one Cash on 2026-05-10
    const pay1 = await admin1.mutation(api.fees.recordPayment, {
      studentId: f1.studentA,
      amountMinor: 200000,
      method: "upi",
      paidOn: "2026-05-02",
      reference: "UPI/TXN/999",
    });

    const pay2 = await admin1.mutation(api.fees.recordPayment, {
      studentId: f1.studentB,
      amountMinor: 150000,
      method: "cash",
      paidOn: "2026-05-10",
      reference: "CASH-RECEIPT-01",
    });

    // Setup and record one payment in school 2
    const { structureId: s2 } = await admin2.mutation(api.fees.createStructure, {
      name: "Standard Fee S2",
      classIds: [f2.classId],
      components: [{ label: "Tuition", amountMinor: 300000 }],
      installments: [{ label: "Term 1", dueDate: "2026-05-01", amountMinor: 300000 }],
    });
    await admin2.mutation(api.fees.assignStructure, { structureId: s2, classId: f2.classId });

    const paySchool2 = await admin2.mutation(api.fees.recordPayment, {
      studentId: f2.studentA,
      amountMinor: 300000,
      method: "online",
      paidOn: "2026-05-05",
      reference: "NETBANK/S2/001",
    });

    // 3. Tenant isolation: admin 1 only sees school 1 payments, admin 2 only sees school 2 payments
    const paymentsS1 = await admin1.query(api.fees.listPayments, {});
    expect(paymentsS1.length).toBe(2);
    expect(paymentsS1.some((p) => p.paymentId === pay1.paymentId)).toBe(true);
    expect(paymentsS1.some((p) => p.paymentId === pay2.paymentId)).toBe(true);
    expect(paymentsS1.some((p) => p.paymentId === paySchool2.paymentId)).toBe(false);

    const paymentsS2 = await admin2.query(api.fees.listPayments, {});
    expect(paymentsS2.length).toBe(1);
    expect(paymentsS2[0].paymentId).toBe(paySchool2.paymentId);
    expect(paymentsS2[0].method).toBe("online");

    // 4. Verification of item structure
    const firstRow = paymentsS1[0]; // ordered desc by date (2026-05-10 first)
    expect(firstRow.paidOn).toBe("2026-05-10");
    expect(firstRow.method).toBe("cash");
    expect(firstRow.amountMinor).toBe(150000);
    expect(firstRow.receiptNo).toBeDefined();
    expect(firstRow.studentName).toBeDefined();
    expect(firstRow.admissionNo).toBeDefined();
    expect(firstRow.classLabel).toBeDefined();

    // 5. Method filter
    const upiOnly = await admin1.query(api.fees.listPayments, { method: "upi" });
    expect(upiOnly.length).toBe(1);
    expect(upiOnly[0].paymentId).toBe(pay1.paymentId);
    expect(upiOnly[0].method).toBe("upi");

    // 6. Date range filter
    const dateFiltered = await admin1.query(api.fees.listPayments, { from: "2026-05-05", to: "2026-05-15" });
    expect(dateFiltered.length).toBe(1);
    expect(dateFiltered[0].paymentId).toBe(pay2.paymentId);

    // 7. Search filter by reference or receipt
    const searchByRef = await admin1.query(api.fees.listPayments, { search: "TXN/999" });
    expect(searchByRef.length).toBe(1);
    expect(searchByRef[0].paymentId).toBe(pay1.paymentId);

    // 8. Class filter
    const classFiltered = await admin1.query(api.fees.listPayments, { classId: f1.classId });
    expect(classFiltered.length).toBe(2);
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
    });
    await admin.mutation(api.fees.assignStructure, { structureId, studentId: f.studentA });

    // 1. Overpayment rejection: trying to pay 250000 paise when total due is 200000 paise
    const overpayErr = await errorCode(
      admin.mutation(api.fees.recordPayment, {
        studentId: f.studentA,
        amountMinor: 250000,
        method: "cash",
        paidOn: "2026-05-02",
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
    });
    expect(p1.receiptNo).toBeDefined();

    const ledgerAfterP1 = await student.query(api.fees.getStudentLedger, { studentId: f.studentA });
    expect(ledgerAfterP1.totals.paidMinor).toBe(140000);
    expect(ledgerAfterP1.totals.outstandingMinor).toBe(60000);

    const term1 = ledgerAfterP1.obligations.find((o) => o.label === "Term 1");
    const term2 = ledgerAfterP1.obligations.find((o) => o.label === "Term 2");
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
        }),
      );
      expect(explicitOverpayErr).toBe("INVALID_ARGUMENT");
    }

    // 5. Exact payment of remaining 60000 succeeds and clears all obligations
    const p2 = await admin.mutation(api.fees.recordPayment, {
      studentId: f.studentA,
      amountMinor: 60000,
      method: "cash",
      paidOn: "2026-05-10",
    });
    expect(p2.receiptNo).toBeDefined();

    const finalLedger = await student.query(api.fees.getStudentLedger, { studentId: f.studentA });
    expect(finalLedger.totals.paidMinor).toBe(200000);
    expect(finalLedger.totals.outstandingMinor).toBe(0);
  });
});

/**
 * Fees, payments, receipts, concessions, and student ledger backend API.
 *
 * All money amounts are stored in integer MINOR units (e.g. paise).
 * Concurrent payments allocate monotonically unique receipt numbers
 * using atomic serializable counters (convex/model/counters.ts).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, requirePermission, requireStudentAccess } from "./core/authorization";
import { invalid, notFound } from "./core/errors";
import {
  assertAmountMinor,
  assertIsoDate,
  assertNonEmpty,
  vConcessionKind,
  vPaymentMethod,
} from "./core/validators";
import { writeAudit } from "./model/audit";
import { nextReceiptNumber } from "./model/counters";
import { notifyUsers, userIdsForStudent } from "./model/notifications";
import { currentYear, feeLedger } from "./model/studentRecords";
import { fullName } from "./model/academics";

// ------------------------------------------------------------------ helpers

async function resolveAcademicYear(
  ctx: any,
  academicYearId?: Id<"academicYears">,
): Promise<Doc<"academicYears">> {
  if (academicYearId) {
    return await getInSchool(ctx, "academicYears", academicYearId, "Academic year");
  }
  const year = await currentYear(ctx, ctx.actor.schoolId);
  if (!year) throw invalid("No active academic year is configured for this school");
  return year;
}

// ------------------------------------------------------------------ fee structures

export const listStructures = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const year = await resolveAcademicYear(ctx, args.academicYearId);
    const structures = await ctx.db
      .query("feeStructures")
      .withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id))
      .collect();

    const result = [];
    for (const fs of structures) {
      const classNames = [];
      for (const cid of fs.classIds) {
        const cls = await ctx.db.get(cid);
        if (cls && cls.schoolId === ctx.actor.schoolId) classNames.push(cls.name);
      }
      const assignedCount = (
        await ctx.db
          .query("studentFees")
          .withIndex("by_student_year")
          .filter((q) => q.eq(q.field("feeStructureId"), fs._id))
          .collect()
      ).length;

      const totalMinor = fs.components.reduce((sum, c) => sum + c.amountMinor, 0);
      result.push({
        ...fs,
        totalMinor,
        classNames,
        assignedCount,
      });
    }
    return result;
  },
});

export const getStructure = schoolQuery({
  args: { structureId: v.id("feeStructures") },
  handler: async (ctx, { structureId }) => {
    requirePermission(ctx.actor, "fees:manage");
    const fs = await getInSchool(ctx, "feeStructures", structureId, "Fee structure");
    const totalMinor = fs.components.reduce((sum, c) => sum + c.amountMinor, 0);
    return { ...fs, totalMinor };
  },
});

export const createStructure = schoolMutation({
  args: {
    academicYearId: v.optional(v.id("academicYears")),
    name: v.string(),
    classIds: v.array(v.id("classes")),
    components: v.array(v.object({ label: v.string(), amountMinor: v.number() })),
    installments: v.array(v.object({ label: v.string(), dueDate: v.string(), amountMinor: v.number() })),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const year = await resolveAcademicYear(ctx, args.academicYearId);
    const name = assertNonEmpty(args.name, "name");
    if (!args.classIds.length) throw invalid("Select at least one class");
    if (!args.components.length) throw invalid("Add at least one fee component");
    if (!args.installments.length) throw invalid("Add at least one installment");

    let componentTotal = 0;
    for (const c of args.components) {
      assertNonEmpty(c.label, "component label");
      assertAmountMinor(c.amountMinor, `Component "${c.label}"`);
      componentTotal += c.amountMinor;
    }

    let installmentTotal = 0;
    for (const ins of args.installments) {
      assertNonEmpty(ins.label, "installment label");
      assertIsoDate(ins.dueDate, "installment dueDate");
      assertAmountMinor(ins.amountMinor, `Installment "${ins.label}"`);
      installmentTotal += ins.amountMinor;
    }

    if (componentTotal !== installmentTotal) {
      throw invalid(`Component total (${componentTotal}) must equal installment total (${installmentTotal})`);
    }

    for (const cid of args.classIds) {
      await getInSchool(ctx, "classes", cid, "Class");
    }

    const structureId = await ctx.db.insert("feeStructures", {
      schoolId: ctx.actor.schoolId,
      academicYearId: year._id,
      name,
      classIds: args.classIds,
      components: args.components,
      installments: args.installments,
      status: "active",
    });

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "fee.structure_created",
      entity: { table: "feeStructures", id: structureId },
      summary: `Created fee structure "${name}" (${args.installments.length} installments, ${componentTotal} minor units)`,
    });

    return { structureId };
  },
});

export const assignStructure = schoolMutation({
  args: {
    structureId: v.id("feeStructures"),
    classId: v.optional(v.id("classes")),
    studentId: v.optional(v.id("students")),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const fs = await getInSchool(ctx, "feeStructures", args.structureId, "Fee structure");

    const targetStudentIds: Id<"students">[] = [];
    if (args.studentId) {
      const student = await getInSchool(ctx, "students", args.studentId, "Student");
      targetStudentIds.push(student._id);
    } else if (args.classId) {
      const cls = await getInSchool(ctx, "classes", args.classId, "Class");
      const sections = await ctx.db
        .query("sections")
        .withIndex("by_class_year", (q) => q.eq("classId", cls._id).eq("academicYearId", fs.academicYearId))
        .collect();

      for (const sec of sections) {
        const enrs = await ctx.db
          .query("enrollments")
          .withIndex("by_section_status", (q) => q.eq("sectionId", sec._id).eq("status", "active"))
          .collect();
        for (const e of enrs) {
          if (e.schoolId === ctx.actor.schoolId) targetStudentIds.push(e.studentId);
        }
      }
    } else {
      throw invalid("Provide either a classId or a studentId to assign fee structure");
    }

    let createdCount = 0;
    for (const sid of targetStudentIds) {
      // Check existing obligations for this structure
      const existing = await ctx.db
        .query("studentFees")
        .withIndex("by_student_year", (q) => q.eq("studentId", sid).eq("academicYearId", fs.academicYearId))
        .filter((q) => q.eq(q.field("feeStructureId"), fs._id))
        .first();

      if (existing) continue; // Already assigned

      for (const ins of fs.installments) {
        await ctx.db.insert("studentFees", {
          schoolId: ctx.actor.schoolId,
          studentId: sid,
          academicYearId: fs.academicYearId,
          feeStructureId: fs._id,
          label: ins.label,
          amountMinor: ins.amountMinor,
          dueDate: ins.dueDate,
          status: "active",
        });
        createdCount += 1;
      }
    }

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "fee.structure_assigned",
      entity: { table: "feeStructures", id: fs._id },
      summary: `Assigned structure "${fs.name}" to ${targetStudentIds.length} student(s) (${createdCount} obligations created)`,
    });

    return { assignedStudents: targetStudentIds.length, createdObligations: createdCount };
  },
});

// ------------------------------------------------------------------ payments & receipts

export const recordPayment = schoolMutation({
  args: {
    studentId: v.id("students"),
    amountMinor: v.number(),
    method: vPaymentMethod,
    paidOn: v.string(),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    allocations: v.optional(
      v.array(v.object({ studentFeeId: v.id("studentFees"), amountMinor: v.number() })),
    ),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const student = await getInSchool(ctx, "students", args.studentId, "Student");
    assertAmountMinor(args.amountMinor, "amountMinor");
    assertIsoDate(args.paidOn, "paidOn");

    const school = await ctx.db.get(ctx.actor.schoolId);
    if (!school) throw notFound("School");

    const year = await currentYear(ctx, ctx.actor.schoolId);
    if (!year) throw invalid("No active academic year configured for receipt allocation");

    // Fetch active obligations for this student in this academic year
    const obligations = (
      await ctx.db
        .query("studentFees")
        .withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id))
        .collect()
    )
      .filter((o) => o.schoolId === ctx.actor.schoolId && o.status === "active")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    if (obligations.length === 0) {
      throw invalid("No active fee obligations found for this student in current academic year");
    }

    // Determine allocations
    const finalAllocations: { studentFeeId: Id<"studentFees">; amountMinor: number }[] = [];
    if (args.allocations && args.allocations.length > 0) {
      let sum = 0;
      for (const a of args.allocations) {
        assertAmountMinor(a.amountMinor, "allocation amount");
        sum += a.amountMinor;
        finalAllocations.push({ studentFeeId: a.studentFeeId, amountMinor: a.amountMinor });
      }
      if (sum !== args.amountMinor) {
        throw invalid(`Allocation sum (${sum}) does not match payment amount (${args.amountMinor})`);
      }
    } else {
      // Auto-allocate against obligations in due-date order
      const allPayments = (
        await ctx.db
          .query("feePayments")
          .withIndex("by_student_paid", (q) => q.eq("studentId", student._id))
          .collect()
      ).filter((p) => p.schoolId === ctx.actor.schoolId && p.academicYearId === year._id);

      const reversed = new Set(allPayments.map((p) => p.reversalOfPaymentId).filter(Boolean));
      const activePayments = allPayments.filter((p) => p.status === "completed" && !p.reversalOfPaymentId && !reversed.has(p._id));

      const alreadyPaid = new Map<Id<"studentFees">, number>();
      for (const p of activePayments) {
        for (const al of p.allocations) {
          alreadyPaid.set(al.studentFeeId, (alreadyPaid.get(al.studentFeeId) ?? 0) + al.amountMinor);
        }
      }

      let remaining = args.amountMinor;
      for (const ob of obligations) {
        if (remaining <= 0) break;
        const paidSoFar = alreadyPaid.get(ob._id) ?? 0;
        const due = Math.max(0, ob.amountMinor - paidSoFar);
        if (due > 0) {
          const take = Math.min(due, remaining);
          finalAllocations.push({ studentFeeId: ob._id, amountMinor: take });
          remaining -= take;
        }
      }
      if (remaining > 0 && obligations.length > 0) {
        const lastOb = obligations[obligations.length - 1];
        const existingAlloc = finalAllocations.find((a) => a.studentFeeId === lastOb._id);
        if (existingAlloc) {
          existingAlloc.amountMinor += remaining;
        } else {
          finalAllocations.push({ studentFeeId: lastOb._id, amountMinor: remaining });
        }
      }
    }

    // Atomic receipt number generation via counter
    const receiptNo = await nextReceiptNumber(ctx, school, year);

    // Insert payment record
    const paymentId = await ctx.db.insert("feePayments", {
      schoolId: ctx.actor.schoolId,
      studentId: student._id,
      academicYearId: year._id,
      amountMinor: args.amountMinor,
      method: args.method,
      reference: args.reference,
      paidOn: args.paidOn,
      status: "completed",
      allocations: finalAllocations,
      recordedByUserId: ctx.actor.userId,
      note: args.note,
    });

    // Insert receipt record
    const receiptId = await ctx.db.insert("receipts", {
      schoolId: ctx.actor.schoolId,
      paymentId,
      studentId: student._id,
      receiptNo,
      issuedAt: Date.now(),
    });

    // Write audit trail
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "fee.payment_recorded",
      entity: { table: "feePayments", id: paymentId },
      summary: `Recorded fee payment of ${args.amountMinor} minor units for ${fullName(student)} (Receipt #${receiptNo})`,
      metadata: { receiptNo, method: args.method, studentId: student._id },
    });

    // Notify student and linked guardians
    const userIds = await userIdsForStudent(ctx, ctx.actor.schoolId, student._id);
    const amountFormatted = `₹${(args.amountMinor / 100).toFixed(2)}`;
    await notifyUsers(ctx, ctx.actor.schoolId, userIds, {
      type: "fees",
      title: "Fee payment received",
      message: `Payment of ${amountFormatted} has been confirmed. Receipt #${receiptNo}.`,
      href: "/student/fees",
      entity: { table: "receipts", id: receiptId },
    });

    return {
      paymentId,
      receiptId,
      receiptNo,
      amountMinor: args.amountMinor,
      paidOn: args.paidOn,
    };
  },
});

export const reversePayment = schoolMutation({
  args: {
    paymentId: v.id("feePayments"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const original = await getInSchool(ctx, "feePayments", args.paymentId, "Payment");
    if (original.status !== "completed") {
      throw invalid("Only completed payments can be reversed");
    }
    if (original.reversalOfPaymentId) {
      throw invalid("Cannot reverse a reversal transaction");
    }

    const existingReversal = await ctx.db
      .query("feePayments")
      .withIndex("by_student_paid", (q) => q.eq("studentId", original.studentId))
      .filter((q) => q.eq(q.field("reversalOfPaymentId"), original._id))
      .first();

    if (existingReversal) {
      throw invalid("This payment has already been reversed");
    }

    const reason = assertNonEmpty(args.reason, "reason");

    const reversalId = await ctx.db.insert("feePayments", {
      schoolId: ctx.actor.schoolId,
      studentId: original.studentId,
      academicYearId: original.academicYearId,
      amountMinor: original.amountMinor,
      method: original.method,
      reference: `REV:${original._id}`,
      paidOn: new Date().toISOString().slice(0, 10),
      status: "reversed",
      reversalOfPaymentId: original._id,
      allocations: original.allocations,
      recordedByUserId: ctx.actor.userId,
      note: `Reversal: ${reason}`,
    });

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "fee.payment_reversed",
      entity: { table: "feePayments", id: original._id },
      summary: `Reversed payment ${original._id} of ${original.amountMinor} minor units: ${reason}`,
      metadata: { originalPaymentId: original._id, reversalId },
    });

    return { ok: true, reversalId };
  },
});

export const createConcession = schoolMutation({
  args: {
    studentId: v.id("students"),
    academicYearId: v.optional(v.id("academicYears")),
    studentFeeId: v.optional(v.id("studentFees")),
    kind: vConcessionKind,
    value: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const student = await getInSchool(ctx, "students", args.studentId, "Student");
    const year = await resolveAcademicYear(ctx, args.academicYearId);
    const reason = assertNonEmpty(args.reason, "reason");

    if (args.kind === "percent") {
      if (!Number.isInteger(args.value) || args.value <= 0 || args.value > 10000) {
        throw invalid("Percentage concession must be between 1 and 10000 basis points");
      }
    } else {
      assertAmountMinor(args.value, "Concession amount");
    }

    if (args.studentFeeId) {
      await getInSchool(ctx, "studentFees", args.studentFeeId, "Fee obligation");
    }

    const concessionId = await ctx.db.insert("feeConcessions", {
      schoolId: ctx.actor.schoolId,
      studentId: student._id,
      academicYearId: year._id,
      studentFeeId: args.studentFeeId,
      kind: args.kind,
      value: args.value,
      reason,
      approvedByUserId: ctx.actor.userId,
      status: "active",
    });

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "fee.concession_granted",
      entity: { table: "feeConcessions", id: concessionId },
      summary: `Granted ${args.kind === "percent" ? `${args.value / 100}%` : `${args.value} minor units`} concession to ${fullName(student)}: ${reason}`,
    });

    return { concessionId };
  },
});

// ------------------------------------------------------------------ student ledger & balance queries

export const getStudentLedger = schoolQuery({
  args: {
    studentId: v.id("students"),
    academicYearId: v.optional(v.id("academicYears")),
  },
  handler: async (ctx, args) => {
    const student = await requireStudentAccess(ctx, args.studentId, {
      all: "fees:manage",
      assigned: undefined,
      own: "fees:read:own",
    });
    const year = await resolveAcademicYear(ctx, args.academicYearId);
    return await feeLedger(ctx, student, year);
  },
});

export const listBalances = schoolQuery({
  args: {
    academicYearId: v.optional(v.id("academicYears")),
    classId: v.optional(v.id("classes")),
    sectionId: v.optional(v.id("sections")),
    standing: v.optional(
      v.union(v.literal("all"), v.literal("paid"), v.literal("partial"), v.literal("overdue"), v.literal("unpaid")),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const year = await resolveAcademicYear(ctx, args.academicYearId);

    let enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id))
      .collect();

    enrollments = enrollments.filter((e) => e.status === "active");

    if (args.classId) {
      enrollments = enrollments.filter((e) => e.classId === args.classId);
    }
    if (args.sectionId) {
      enrollments = enrollments.filter((e) => e.sectionId === args.sectionId);
    }

    const today = new Date().toISOString().slice(0, 10);
    const searchLower = args.search?.trim().toLowerCase();

    const rows = [];
    for (const e of enrollments) {
      const student = await ctx.db.get(e.studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId || student.status !== "active") continue;

      const name = fullName(student);
      if (searchLower) {
        const matches =
          name.toLowerCase().includes(searchLower) ||
          student.admissionNo.toLowerCase().includes(searchLower);
        if (!matches) continue;
      }

      const ledger = await feeLedger(ctx, student, year);
      const net = ledger.totals.grossMinor - ledger.totals.concessionMinor;
      const paid = ledger.totals.paidMinor;
      const outstanding = ledger.totals.outstandingMinor;

      let overdue = 0;
      for (const ob of ledger.obligations) {
        if (ob.dueDate < today && ob.outstandingMinor > 0) {
          overdue += ob.outstandingMinor;
        }
      }

      let standing: "paid" | "partial" | "overdue" | "unpaid" = "unpaid";
      if (outstanding === 0 && net > 0) standing = "paid";
      else if (overdue > 0) standing = "overdue";
      else if (paid > 0) standing = "partial";

      if (args.standing && args.standing !== "all" && standing !== args.standing) {
        continue;
      }

      const klass = await ctx.db.get(e.classId);
      const section = await ctx.db.get(e.sectionId);
      const classLabel = section?.displayName ?? (klass ? klass.name : "");

      rows.push({
        studentId: student._id,
        name,
        admissionNo: student.admissionNo,
        classId: e.classId,
        sectionId: e.sectionId,
        classLabel,
        netMinor: net,
        paidMinor: paid,
        outstandingMinor: outstanding,
        overdueMinor: overdue,
        standing,
        lastPaymentOn: ledger.payments[0]?.paidOn ?? null,
      });
    }

    return rows;
  },
});

export const getReceipt = schoolQuery({
  args: {
    receiptId: v.optional(v.id("receipts")),
    paymentId: v.optional(v.id("feePayments")),
  },
  handler: async (ctx, args) => {
    let receipt: Doc<"receipts"> | null = null;
    if (args.receiptId) {
      receipt = await getInSchool(ctx, "receipts", args.receiptId, "Receipt");
    } else if (args.paymentId) {
      const p = await getInSchool(ctx, "feePayments", args.paymentId, "Payment");
      receipt = await ctx.db
        .query("receipts")
        .withIndex("by_payment", (q) => q.eq("paymentId", p._id))
        .first();
    }
    if (!receipt || receipt.schoolId !== ctx.actor.schoolId) throw notFound("Receipt");

    await requireStudentAccess(ctx, receipt.studentId, {
      all: "fees:manage",
      assigned: undefined,
      own: "fees:read:own",
    });

    const payment = await ctx.db.get(receipt.paymentId);
    if (!payment || payment.schoolId !== ctx.actor.schoolId) throw notFound("Payment");

    const student = await ctx.db.get(receipt.studentId);
    if (!student || student.schoolId !== ctx.actor.schoolId) throw notFound("Student");

    const school = await ctx.db.get(ctx.actor.schoolId);
    if (!school) throw notFound("School");

    const allocationsWithLabels = [];
    for (const al of payment.allocations) {
      const ob = await ctx.db.get(al.studentFeeId);
      allocationsWithLabels.push({
        label: ob?.label ?? "Fee installment",
        amountMinor: al.amountMinor,
      });
    }

    return {
      receiptNo: receipt.receiptNo,
      issuedAt: receipt.issuedAt,
      studentName: fullName(student),
      admissionNo: student.admissionNo,
      amountMinor: payment.amountMinor,
      method: payment.method,
      reference: payment.reference ?? null,
      paidOn: payment.paidOn,
      note: payment.note ?? null,
      status: payment.status,
      allocations: allocationsWithLabels,
      school: {
        name: school.name,
        code: school.code,
        address: school.address ?? null,
        phone: school.phone ?? null,
        email: school.email ?? null,
      },
    };
  },
});

export const collectionSummary = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const year = await resolveAcademicYear(ctx, args.academicYearId);

    const payments = (
      await ctx.db
        .query("feePayments")
        .withIndex("by_school_paid", (q) => q.eq("schoolId", ctx.actor.schoolId))
        .collect()
    ).filter((p) => p.academicYearId === year._id);

    const reversed = new Set(payments.map((p) => p.reversalOfPaymentId).filter(Boolean));
    const validPayments = payments.filter((p) => p.status === "completed" && !p.reversalOfPaymentId && !reversed.has(p._id));

    let collectedMinor = 0;
    for (const p of validPayments) collectedMinor += p.amountMinor;

    const obligations = (
      await ctx.db
        .query("studentFees")
        .withIndex("by_student_year")
        .filter((q) => q.eq(q.field("schoolId"), ctx.actor.schoolId))
        .filter((q) => q.eq(q.field("academicYearId"), year._id))
        .filter((q) => q.eq(q.field("status"), "active"))
        .collect()
    );

    let grossMinor = 0;
    for (const ob of obligations) grossMinor += ob.amountMinor;

    const concessions = (
      await ctx.db
        .query("feeConcessions")
        .withIndex("by_student_year")
        .filter((q) => q.eq(q.field("schoolId"), ctx.actor.schoolId))
        .filter((q) => q.eq(q.field("academicYearId"), year._id))
        .filter((q) => q.eq(q.field("status"), "active"))
        .collect()
    );

    let concessionMinor = 0;
    for (const c of concessions) {
      if (c.kind === "fixed") concessionMinor += c.value;
    }

    const netMinor = Math.max(0, grossMinor - concessionMinor);
    const outstandingMinor = Math.max(0, netMinor - collectedMinor);
    const collectionRate = netMinor > 0 ? (collectedMinor / netMinor) * 100 : 0;

    return {
      collectedMinor,
      outstandingMinor,
      netMinor,
      collectionRate,
      paymentsCount: validPayments.length,
    };
  },
});

export const listPayments = schoolQuery({
  args: {
    academicYearId: v.optional(v.id("academicYears")),
    classId: v.optional(v.id("classes")),
    method: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "fees:manage");
    const year = await resolveAcademicYear(ctx, args.academicYearId);
    const limit = Math.min(args.limit ?? 250, 500);

    let payments = await ctx.db
      .query("feePayments")
      .withIndex("by_school_paid", (q) => {
        const base = q.eq("schoolId", ctx.actor.schoolId);
        if (args.from && args.to) return base.gte("paidOn", args.from).lte("paidOn", args.to);
        if (args.from) return base.gte("paidOn", args.from);
        if (args.to) return base.lte("paidOn", args.to);
        return base;
      })
      .order("desc")
      .collect();

    payments = payments.filter((p) => p.academicYearId === year._id);

    if (args.method && args.method.trim() !== "") {
      payments = payments.filter((p) => p.method === args.method);
    }

    const searchLower = args.search?.trim().toLowerCase();
    const rows = [];

    for (const p of payments) {
      const student = await ctx.db.get(p.studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId) continue;

      const receipt = await ctx.db
        .query("receipts")
        .withIndex("by_payment", (q) => q.eq("paymentId", p._id))
        .first();

      const enrollment = await ctx.db
        .query("enrollments")
        .withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id))
        .first();

      let classId: Id<"classes"> | null = enrollment ? enrollment.classId : null;
      let classLabel = "—";
      if (enrollment) {
        const section = await ctx.db.get(enrollment.sectionId);
        const klass = await ctx.db.get(enrollment.classId);
        classLabel = section?.displayName ?? (klass ? klass.name : "—");
      }

      if (args.classId && classId !== args.classId) {
        continue;
      }

      const sName = fullName(student);
      const receiptNo = receipt?.receiptNo ?? "—";

      if (searchLower) {
        const matches =
          sName.toLowerCase().includes(searchLower) ||
          student.admissionNo.toLowerCase().includes(searchLower) ||
          receiptNo.toLowerCase().includes(searchLower) ||
          (p.reference && p.reference.toLowerCase().includes(searchLower));
        if (!matches) continue;
      }

      rows.push({
        _id: p._id,
        id: p._id,
        paymentId: p._id,
        receiptId: receipt?._id ?? p._id,
        receiptNo,
        paidOn: p.paidOn,
        studentId: student._id,
        studentName: sName,
        admissionNo: student.admissionNo,
        classId,
        classLabel,
        method: p.method,
        reference: p.reference ?? "—",
        amountMinor: p.amountMinor,
        status: p.status,
      });

      if (rows.length >= limit) break;
    }

    return rows;
  },
});

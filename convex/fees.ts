/**
 * Fees: structures, student obligations, concessions, payments and receipts (A-02).
 *
 * Permissions: `fees:manage` (admin, and the optional "accountant" permission
 * set) writes everything and reads every ledger; `reports:finance` may read
 * collection summaries; students read their own ledger and
 * receipts (`fees:read:own`). Every id is loaded inside the caller's school.
 *
 * Money is integer minor units (paise). Records are separate and append-only
 * where it matters:
 *  - a structure's installments become one `studentFees` obligation each for
 *    every eligible student (active enrollment in the structure's year, in one
 *    of its classes). Assigning the same structure to a student twice is a
 *    no-op for that student (reported as skipped);
 *  - concessions are separate rows (percent in basis points, or fixed);
 *  - a payment is ALLOCATED to the student's outstanding obligations of that
 *    year oldest due date first (then creation order); it may not exceed the
 *    total outstanding (no credit balances). The payment, its allocations and
 *    its receipt number are written in ONE transaction;
 *  - receipt numbers come from the per-school, per-year counter
 *    (model/counters.ts) inside that transaction, so they are unique and
 *    sequential even under concurrent payments (Convex serializable
 *    transactions retry on conflict);
 *  - retry safety: `recordPayment` requires a client-generated
 *    `clientRequestId`. Re-sending the same request returns the ORIGINAL
 *    payment and receipt instead of charging again;
 *  - a reversal is a new row pointing at the original; balances and receipts
 *    then exclude the original (model/studentRecords.ts feeLedger).
 * No payment gateway is integrated: payments are recorded by staff after the
 * money was received (cash, UPI, card, bank transfer, cheque).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { moduleQuery, moduleMutation } from "./core/functions";
import type { Actor } from "./core/actor";
import { enrollmentFor, getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, requireAnyPermission, requirePermission, requireStudentAccess } from "./core/authorization";
import { conflict, invalid, invalidRelationship, notFound } from "./core/errors";
import { assertAmountMinor, assertIsoDate, assertNonEmpty, vConcessionKind, vPaymentMethod } from "./core/validators";
import { fullName } from "./model/academics";
import { daysBetween, MAX_RANGE_DAYS, todayIn } from "./model/calendar";
import { nextReceiptNumber } from "./model/counters";
import { feeLedger } from "./model/studentRecords";
import { computeLedger, obligationStatus, standingOf, type FeeStanding } from "./model/feeMath";
import { activeEnrollments as activeEnrollmentsOf, MAX_AGGREGATE_ROWS, schoolYearFees as schoolYearFeesOf } from "./model/feeData";

const activeEnrollments = (ctx: Ctx, yearId: Id<"academicYears">) => activeEnrollmentsOf(ctx, ctx.actor.schoolId, yearId);
const schoolYearFees = (ctx: Ctx, yearId: Id<"academicYears">) => schoolYearFeesOf(ctx, ctx.actor.schoolId, yearId);
import { writeAudit } from "./model/audit";
import { notifyUsers, userIdsForStudent } from "./model/notifications";

const financeQuery = moduleQuery("finance");
const financeMutation = moduleMutation("finance");

type Ctx = QueryCtx & { actor: Actor };

/** Largest number of students one assignment call may touch. */
export const MAX_ASSIGN_STUDENTS = 500;
const OWN = { all: "fees:manage", own: "fees:read:own" } as const;

const vComponent = v.object({ label: v.string(), amountMinor: v.number() });
const vInstallment = v.object({ label: v.string(), dueDate: v.string(), amountMinor: v.number() });

async function yearOrCurrent(ctx: Ctx, academicYearId?: Id<"academicYears">) {
  const id = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
  return (await ctx.db.get(id))!;
}

async function sectionLabels(ctx: Ctx, academicYearId: Id<"academicYears">) {
  const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", academicYearId)).collect();
  return new Map(sections.map((s) => [s._id, s.displayName]));
}

const vStanding = v.union(v.literal("paid"), v.literal("clear"), v.literal("due_soon"), v.literal("overdue"), v.literal("not_assigned"));

function validatePlan(year: Doc<"academicYears">, components: { label: string; amountMinor: number }[], installments: { label: string; dueDate: string; amountMinor: number }[]) {
  if (components.length === 0) throw invalid("Add at least one fee component.", { components: "Required" });
  if (installments.length === 0) throw invalid("Add at least one installment.", { installments: "Required" });
  if (installments.length > 24) throw invalid("At most 24 installments.", { installments: "Too many" });
  const comps = components.map((c, i) => ({ label: assertNonEmpty(c.label, `components[${i}].label`, 80), amountMinor: assertAmountMinor(c.amountMinor, `components[${i}].amountMinor`) }));
  const labels = new Set<string>();
  const inst = installments.map((x, i) => {
    const label = assertNonEmpty(x.label, `installments[${i}].label`, 80);
    if (labels.has(label.toLowerCase())) throw invalid(`Installment "${label}" is listed twice.`, { installments: "Duplicate" });
    labels.add(label.toLowerCase());
    assertIsoDate(x.dueDate, `installments[${i}].dueDate`);
    if (x.dueDate < year.startDate || x.dueDate > year.endDate) throw invalid(`Due dates must fall within ${year.name}.`, { installments: "Outside the year" });
    return { label, dueDate: x.dueDate, amountMinor: assertAmountMinor(x.amountMinor, `installments[${i}].amountMinor`) };
  });
  const total = comps.reduce((a, c) => a + c.amountMinor, 0);
  const instTotal = inst.reduce((a, c) => a + c.amountMinor, 0);
  if (total !== instTotal) throw invalid(`Installments (${instTotal}) must add up to the components (${total}).`, { installments: "Total mismatch" });
  return { components: comps, installments: inst.sort((a, b) => a.dueDate.localeCompare(b.dueDate)) };
}

function structureView(s: Doc<"feeStructures">) {
  const total = s.components.reduce((a, c) => a + c.amountMinor, 0);
  return { structureId: s._id, academicYearId: s.academicYearId, name: s.name, classIds: s.classIds, components: s.components, installments: s.installments, status: s.status, totalMinor: total };
}

// ================================================================ structures
export const listStructures = financeQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    requireAnyPermission(ctx.actor, ["fees:manage", "reports:finance"]);
    const year = await yearOrCurrent(ctx, academicYearId);
    const rows = await ctx.db.query("feeStructures").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)).collect();
    const enrollments = await activeEnrollments(ctx, year._id);
    const out = [];
    for (const s of rows) {
      const obligations = await ctx.db.query("studentFees").withIndex("by_structure", (q) => q.eq("feeStructureId", s._id)).take(MAX_AGGREGATE_ROWS + 1);
      if (obligations.length > MAX_AGGREGATE_ROWS) throw conflict(`"${s.name}" has too many fee rows to summarise.`);
      const assigned = new Set(obligations.filter((o) => o.status === "active" && o.schoolId === ctx.actor.schoolId).map((o) => o.studentId));
      const eligible = new Set(enrollments.filter((e) => s.classIds.includes(e.classId)).map((e) => e.studentId));
      const classNames: string[] = [];
      for (const id of s.classIds) {
        const c = await ctx.db.get(id);
        if (c && c.schoolId === ctx.actor.schoolId) classNames.push(c.name);
      }
      out.push({ ...structureView(s), inUse: obligations.length > 0, classNames, assignedCount: [...assigned].filter((id) => eligible.has(id)).length, eligibleCount: eligible.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createStructure = financeMutation({
  args: {
    academicYearId: v.optional(v.id("academicYears")), name: v.string(), classIds: v.array(v.id("classes")), components: v.array(vComponent), installments: v.array(vInstallment),
    /** Create it already active (ready to assign) instead of as a draft. */
    activate: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "fees:manage");
    const year = await yearOrCurrent(ctx, a.academicYearId);
    if (a.classIds.length === 0) throw invalid("Choose at least one class.", { classIds: "Required" });
    for (const id of a.classIds) await getInSchool(ctx, "classes", id, "Class");
    const name = assertNonEmpty(a.name, "name", 120);
    const existing = await ctx.db.query("feeStructures").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)).collect();
    if (existing.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) throw conflict(`A fee structure named "${name}" already exists for ${year.name}.`);
    const plan = validatePlan(year, a.components, a.installments);
    const structureId = await ctx.db.insert("feeStructures", { schoolId: ctx.actor.schoolId, academicYearId: year._id, name, classIds: [...new Set(a.classIds)], ...plan, status: a.activate ? "active" : "draft" });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.structure_created", entity: { table: "feeStructures", id: structureId }, summary: `Created fee structure "${name}" (${year.name})` });
    return { structureId };
  },
});

/** Edit a structure. Amounts and installments can only change while no student has been assigned it. */
export const updateStructure = financeMutation({
  args: { structureId: v.id("feeStructures"), name: v.optional(v.string()), classIds: v.optional(v.array(v.id("classes"))), components: v.optional(v.array(vComponent)), installments: v.optional(v.array(vInstallment)) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "fees:manage");
    const s = await getInSchool(ctx, "feeStructures", a.structureId, "Fee structure");
    if (s.status === "archived") throw conflict("An archived structure cannot be changed.");
    const inUse = !!(await ctx.db.query("studentFees").withIndex("by_structure", (q) => q.eq("feeStructureId", s._id)).first());
    const patch: Partial<Doc<"feeStructures">> = {};
    if (a.name !== undefined) patch.name = assertNonEmpty(a.name, "name", 120);
    if (a.classIds !== undefined) {
      if (a.classIds.length === 0) throw invalid("Choose at least one class.", { classIds: "Required" });
      for (const id of a.classIds) await getInSchool(ctx, "classes", id, "Class");
      patch.classIds = [...new Set(a.classIds)];
    }
    if (a.components !== undefined || a.installments !== undefined) {
      if (inUse) throw conflict("Students are already assigned this structure; amounts can no longer change. Use concessions or a new structure.");
      const year = (await ctx.db.get(s.academicYearId))!;
      Object.assign(patch, validatePlan(year, a.components ?? s.components, a.installments ?? s.installments));
    }
    await ctx.db.patch(s._id, patch);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.structure_updated", entity: { table: "feeStructures", id: s._id }, summary: `Updated fee structure "${patch.name ?? s.name}"`, metadata: { fields: Object.keys(patch) } });
    return { ok: true };
  },
});

export const setStructureStatus = financeMutation({
  args: { structureId: v.id("feeStructures"), status: v.union(v.literal("active"), v.literal("archived")) },
  handler: async (ctx, { structureId, status }) => {
    requirePermission(ctx.actor, "fees:manage");
    const s = await getInSchool(ctx, "feeStructures", structureId, "Fee structure");
    if (s.status === status) return { ok: true };
    if (s.status === "archived") throw conflict("An archived structure cannot be reactivated.");
    await ctx.db.patch(s._id, { status });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.structure_status", entity: { table: "feeStructures", id: s._id }, summary: `${s.name}: ${s.status} → ${status}` });
    return { ok: true };
  },
});

// ================================================================ assignment
/**
 * Create the structure's obligations for students: an explicit list, every
 * active student of a section, or of a class (in the structure's year).
 * Ineligible students are rejected for explicit lists and skipped for
 * section/class targets; already-assigned students are skipped.
 */
export const assignStructure = financeMutation({
  args: {
    structureId: v.id("feeStructures"),
    target: v.union(
      v.object({ kind: v.literal("students"), studentIds: v.array(v.id("students")) }),
      v.object({ kind: v.literal("section"), sectionId: v.id("sections") }),
      v.object({ kind: v.literal("class"), classId: v.id("classes") }),
    ),
  },
  handler: async (ctx, { structureId, target }) => {
    requirePermission(ctx.actor, "fees:manage");
    const s = await getInSchool(ctx, "feeStructures", structureId, "Fee structure");
    if (s.status !== "active") throw conflict("Activate the structure before assigning it.");
    let studentIds: Id<"students">[] = [];
    if (target.kind === "students") {
      if (new Set(target.studentIds).size !== target.studentIds.length) throw invalid("A student is listed twice.");
      studentIds = target.studentIds;
    } else {
      const sectionIds: Id<"sections">[] = [];
      if (target.kind === "section") {
        const section = await getInSchool(ctx, "sections", target.sectionId, "Section");
        if (section.academicYearId !== s.academicYearId || !s.classIds.includes(section.classId)) throw invalidRelationship("That section is not covered by this structure.");
        sectionIds.push(section._id);
      } else {
        await getInSchool(ctx, "classes", target.classId, "Class");
        if (!s.classIds.includes(target.classId)) throw invalidRelationship("That class is not covered by this structure.");
        const rows = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", target.classId).eq("academicYearId", s.academicYearId)).collect();
        sectionIds.push(...rows.filter((x) => x.schoolId === ctx.actor.schoolId).map((x) => x._id));
      }
      for (const id of sectionIds) {
        const es = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", id).eq("status", "active")).take(MAX_ASSIGN_STUDENTS + 1);
        studentIds.push(...es.filter((e) => e.schoolId === ctx.actor.schoolId).map((e) => e.studentId));
      }
    }
    if (studentIds.length === 0) throw invalid("No students to assign.");
    if (studentIds.length > MAX_ASSIGN_STUDENTS) throw invalid(`At most ${MAX_ASSIGN_STUDENTS} students per assignment; assign section by section.`);

    let assigned = 0;
    const skipped: { studentId: Id<"students">; reason: string }[] = [];
    for (const studentId of studentIds) {
      const student = await getInSchool(ctx, "students", studentId, "Student");
      const enr = await enrollmentFor(ctx, student._id, s.academicYearId);
      if (!enr || enr.status !== "active" || !s.classIds.includes(enr.classId)) {
        if (target.kind === "students") throw invalidRelationship(`${fullName(student)} is not actively enrolled in a class covered by this structure.`);
        skipped.push({ studentId, reason: "not_eligible" });
        continue;
      }
      const existing = await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", s.academicYearId)).collect();
      if (existing.some((o) => o.feeStructureId === s._id && o.status === "active")) {
        skipped.push({ studentId, reason: "already_assigned" });
        continue;
      }
      for (const inst of s.installments) {
        await ctx.db.insert("studentFees", {
          schoolId: ctx.actor.schoolId, studentId: student._id, academicYearId: s.academicYearId, feeStructureId: s._id,
          label: `${s.name} — ${inst.label}`, amountMinor: inst.amountMinor, dueDate: inst.dueDate, status: "active",
        });
      }
      assigned++;
    }
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.structure_assigned", entity: { table: "feeStructures", id: s._id }, summary: `Assigned "${s.name}" to ${assigned} student(s)`, metadata: { assigned, skipped: skipped.length, target: target.kind } });
    return { assigned, skipped };
  },
});

/** Cancel a student's obligations of one structure — only if nothing has been paid against them. */
export const cancelAssignment = financeMutation({
  args: { studentId: v.id("students"), structureId: v.id("feeStructures"), reason: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "fees:manage");
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const s = await getInSchool(ctx, "feeStructures", a.structureId, "Fee structure");
    const reason = assertNonEmpty(a.reason, "reason", 300);
    const year = (await ctx.db.get(s.academicYearId))!;
    const ledger = await feeLedger(ctx, student, year);
    const rows = (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", s.academicYearId)).collect())
      .filter((o) => o.feeStructureId === s._id && o.status === "active");
    if (rows.length === 0) throw notFound("Assignment");
    for (const o of rows) {
      if ((ledger.obligations.find((l) => l.obligationId === o._id)?.paidMinor ?? 0) > 0) throw conflict("Payments are allocated to this assignment; reverse them first.");
    }
    for (const o of rows) await ctx.db.patch(o._id, { status: "cancelled" });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.assignment_cancelled", entity: { table: "students", id: student._id }, summary: `Cancelled "${s.name}" for ${fullName(student)}`, metadata: { reason, obligations: rows.length } });
    return { cancelled: rows.length };
  },
});

// ================================================================ concessions
export const addConcession = financeMutation({
  args: {
    studentId: v.id("students"), academicYearId: v.optional(v.id("academicYears")), studentFeeId: v.optional(v.id("studentFees")),
    kind: vConcessionKind, value: v.number(), reason: v.string(),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "fees:manage");
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const year = await yearOrCurrent(ctx, a.academicYearId);
    if (a.studentFeeId) {
      const o = await getInSchool(ctx, "studentFees", a.studentFeeId, "Fee");
      if (o.studentId !== student._id || o.academicYearId !== year._id || o.status !== "active") throw invalidRelationship("That fee does not belong to this student and year.");
    }
    if (a.kind === "percent" && (!Number.isInteger(a.value) || a.value < 1 || a.value > 10000)) throw invalid("A percentage concession is 1–10000 basis points (0.01%–100%).", { value: "Invalid" });
    if (a.kind === "fixed") assertAmountMinor(a.value, "value");
    const reason = assertNonEmpty(a.reason, "reason", 300);
    const concessionId = await ctx.db.insert("feeConcessions", {
      schoolId: ctx.actor.schoolId, studentId: student._id, academicYearId: year._id, ...(a.studentFeeId ? { studentFeeId: a.studentFeeId } : {}),
      kind: a.kind, value: a.value, reason, approvedByUserId: ctx.actor.userId, status: "active",
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.concession_added", entity: { table: "feeConcessions", id: concessionId }, summary: `Concession for ${fullName(student)} (${a.kind} ${a.value})`, metadata: { reason } });
    return { concessionId };
  },
});

export const revokeConcession = financeMutation({
  args: { concessionId: v.id("feeConcessions"), reason: v.string() },
  handler: async (ctx, { concessionId, reason }) => {
    requirePermission(ctx.actor, "fees:manage");
    const c = await getInSchool(ctx, "feeConcessions", concessionId, "Concession");
    const why = assertNonEmpty(reason, "reason", 300);
    if (c.status === "revoked") return { ok: true };
    await ctx.db.patch(c._id, { status: "revoked" });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.concession_revoked", entity: { table: "feeConcessions", id: c._id }, summary: "Revoked a concession", metadata: { reason: why } });
    return { ok: true };
  },
});

// ================================================================ payments
/** Pure allocation rule (exported for tests): oldest due date first, never more than outstanding. */
export function allocate(amountMinor: number, outstanding: { obligationId: Id<"studentFees">; dueDate: string; outstandingMinor: number }[]) {
  let left = amountMinor;
  const allocations: { studentFeeId: Id<"studentFees">; amountMinor: number }[] = [];
  for (const o of [...outstanding].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (left <= 0) break;
    if (o.outstandingMinor <= 0) continue;
    const take = Math.min(left, o.outstandingMinor);
    allocations.push({ studentFeeId: o.obligationId, amountMinor: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

export const recordPayment = financeMutation({
  args: {
    studentId: v.id("students"), academicYearId: v.optional(v.id("academicYears")), amountMinor: v.number(), method: vPaymentMethod,
    paidOn: v.string(), reference: v.optional(v.string()), note: v.optional(v.string()),
    allocations: v.optional(
      v.array(v.object({ studentFeeId: v.id("studentFees"), amountMinor: v.number() })),
    ),
    /** Client-generated unique id of this request (e.g. crypto.randomUUID()); a retry with the same id returns the original payment. */
    clientRequestId: v.string(),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "fees:manage");
    const requestId = a.clientRequestId.trim();
    if (requestId.length < 8 || requestId.length > 100) throw invalid("clientRequestId must be 8–100 characters.", { clientRequestId: "Invalid" });
    const prior = await ctx.db.query("feePayments").withIndex("by_school_request", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("clientRequestId", requestId)).first();
    if (prior) {
      if (prior.studentId !== a.studentId || prior.amountMinor !== a.amountMinor) throw conflict("This request id was already used for a different payment.");
      const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", prior._id)).first();
      return { paymentId: prior._id, receiptId: receipt!._id, receiptNo: receipt!.receiptNo, allocations: prior.allocations, duplicate: true };
    }
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const year = await yearOrCurrent(ctx, a.academicYearId);
    assertAmountMinor(a.amountMinor, "amountMinor");
    assertIsoDate(a.paidOn, "paidOn");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    if (a.paidOn > todayIn(school.timezone)) throw invalid("The payment date cannot be in the future.", { paidOn: "Future date" });
    const ledger = await feeLedger(ctx, student, year);

    let allocations: { studentFeeId: Id<"studentFees">; amountMinor: number }[];
    if (a.allocations && a.allocations.length > 0) {
      let sum = 0;
      const obligationMap = new Map(ledger.obligations.map((o) => [o.obligationId, o]));
      const seenFeeIds = new Set<Id<"studentFees">>();
      for (const alloc of a.allocations) {
        assertAmountMinor(alloc.amountMinor, "allocation amount");
        if (seenFeeIds.has(alloc.studentFeeId)) {
          throw invalid(`Invalid allocations: duplicate obligation ${alloc.studentFeeId}`, {
            allocations: "Duplicate obligation",
          });
        }
        seenFeeIds.add(alloc.studentFeeId);
        const ob = obligationMap.get(alloc.studentFeeId);
        if (!ob) {
          throw invalid(`Invalid allocations: obligation ${alloc.studentFeeId} does not exist or does not belong to student`, {
            allocations: "Foreign or missing obligation",
          });
        }
        if (alloc.amountMinor > ob.outstandingMinor) {
          throw invalid(
            `Invalid allocations: allocation amount (${alloc.amountMinor}) exceeds obligation outstanding balance (${ob.outstandingMinor}) for ${ob.label}`,
            { allocations: "Exceeds balance" },
          );
        }
        sum += alloc.amountMinor;
      }
      if (sum !== a.amountMinor) {
        throw invalid(`Invalid allocations: allocation sum (${sum}) does not match payment amount (${a.amountMinor})`, {
          allocations: "Sum mismatch",
        });
      }
      allocations = a.allocations;
    } else {
      const allocated = allocate(a.amountMinor, ledger.obligations);
      if (allocated.allocations.length === 0) throw conflict("This student has nothing outstanding for the year.");
      if (allocated.unallocated > 0) throw invalid(`The amount exceeds the outstanding balance (${ledger.totals.outstandingMinor}).`, { amountMinor: "More than outstanding" });
      allocations = allocated.allocations;
    }

    const paymentId = await ctx.db.insert("feePayments", {
      schoolId: ctx.actor.schoolId, studentId: student._id, academicYearId: year._id, amountMinor: a.amountMinor, method: a.method,
      ...(a.reference?.trim() ? { reference: assertNonEmpty(a.reference, "reference", 120) } : {}),
      paidOn: a.paidOn, status: "completed", allocations, recordedByUserId: ctx.actor.userId,
      ...(a.note?.trim() ? { note: assertNonEmpty(a.note, "note", 300) } : {}), clientRequestId: requestId,
    });
    const receiptNo = await nextReceiptNumber(ctx, school, year);
    const receiptId = await ctx.db.insert("receipts", { schoolId: ctx.actor.schoolId, paymentId, studentId: student._id, receiptNo, issuedAt: Date.now() });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.payment_recorded", entity: { table: "feePayments", id: paymentId },
      summary: `Recorded ${a.amountMinor} for ${fullName(student)} (receipt ${receiptNo})`, metadata: { receiptNo, method: a.method, allocations: allocations.length },
    });
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    if (settings.notifications.feeReminders) {
      await notifyUsers(ctx, ctx.actor.schoolId, await userIdsForStudent(ctx, ctx.actor.schoolId, student._id), {
        type: "fees", title: "Payment received", message: `Receipt ${receiptNo} has been issued.`, href: "/student/fees",
        entity: { table: "receipts", id: receiptId }, dedupeKey: `fees.payment:${paymentId}`,
      });
    }
    return { paymentId, receiptId, receiptNo, allocations, duplicate: false };
  },
});

/** Reverse a payment (append-only: a new row points at the original). Its allocations stop counting. */
export const reversePayment = financeMutation({
  args: { paymentId: v.id("feePayments"), reason: v.string() },
  handler: async (ctx, { paymentId, reason }) => {
    requirePermission(ctx.actor, "fees:manage");
    const p = await getInSchool(ctx, "feePayments", paymentId, "Payment");
    if (p.reversalOfPaymentId || p.status !== "completed") throw conflict("Only an original completed payment can be reversed.");
    const all = await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", p.studentId)).collect();
    if (all.some((x) => x.reversalOfPaymentId === p._id)) throw conflict("This payment is already reversed.");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const reversalId = await ctx.db.insert("feePayments", {
      schoolId: p.schoolId, studentId: p.studentId, academicYearId: p.academicYearId, amountMinor: p.amountMinor, method: p.method,
      paidOn: todayIn(school.timezone), status: "reversed", reversalOfPaymentId: p._id, allocations: [], recordedByUserId: ctx.actor.userId,
      note: assertNonEmpty(reason, "reason", 300),
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "fees.payment_reversed", entity: { table: "feePayments", id: p._id }, summary: `Reversed a payment of ${p.amountMinor}`, metadata: { reversalId, reason } });
    return { reversalId };
  },
});

// ================================================================ reads
/** A student's ledger for a year: obligations (with status), concessions, payments, receipts, balance and standing. */
export const studentLedger = financeQuery({
  args: { studentId: v.id("students"), academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { studentId, academicYearId }) => {
    const student = await requireStudentAccess(ctx, studentId, OWN);
    const year = await yearOrCurrent(ctx, academicYearId);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    const concessionRows = (await ctx.db.query("feeConcessions").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect())
      .filter((c) => c.schoolId === ctx.actor.schoolId);
    const concessions = concessionRows.map((c) => ({ concessionId: c._id, kind: c.kind, value: c.value, reason: c.reason, status: c.status, studentFeeId: c.studentFeeId ?? null, createdAt: c._creationTime }));
    const ledger = await feeLedger(ctx, student, year);
    const enr = await enrollmentFor(ctx, student._id, year._id);
    const section = enr ? await ctx.db.get(enr.sectionId) : null;
    const { standing, overdueMinor, dueSoonMinor, nextDue } = standingOf(ledger.obligations, today);
    // Which structures this student has, and which active ones of their class they could still be given (fee managers only).
    const own = (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect())
      .filter((o) => o.schoolId === ctx.actor.schoolId && o.status === "active");
    const assignedIds = [...new Set(own.map((o) => o.feeStructureId))];
    const structures: { structureId: Id<"feeStructures">; name: string; totalMinor: number }[] = [];
    for (const id of assignedIds) {
      const s = await ctx.db.get(id);
      if (s) structures.push({ structureId: s._id, name: s.name, totalMinor: s.components.reduce((a, c) => a + c.amountMinor, 0) });
    }
    const manager = hasPermission(ctx.actor, "fees:manage");
    const available = manager && enr && enr.status === "active"
      ? (await ctx.db.query("feeStructures").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)).collect())
        .filter((s) => s.status === "active" && s.classIds.includes(enr.classId) && !assignedIds.includes(s._id))
        .map((s) => ({ structureId: s._id, name: s.name, totalMinor: s.components.reduce((a, c) => a + c.amountMinor, 0) }))
      : [];
    return {
      studentId: student._id, name: fullName(student), admissionNo: student.admissionNo,
      classLabel: section && section.schoolId === ctx.actor.schoolId ? section.displayName : null,
      ...ledger,
      academicYear: { academicYearId: year._id, name: year.name },
      today,
      obligations: ledger.obligations.map((o) => ({ ...o, status: obligationStatus(o, today) })),
      totals: { ...ledger.totals, netMinor: ledger.totals.grossMinor - ledger.totals.concessionMinor, overdueMinor, dueSoonMinor },
      standing, nextDue, structures, availableStructures: available, concessions,
    };
  },
});

/** One receipt with its payment, allocations, who recorded it and the student's balance now (fee managers, or the student themself). */
export const receipt = financeQuery({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, { receiptId }) => {
    const r = await getInSchool(ctx, "receipts", receiptId, "Receipt");
    const student = await requireStudentAccess(ctx, r.studentId, OWN);
    const p = (await ctx.db.get(r.paymentId))!;
    const reversed = !!(await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", p.studentId)).collect()).find((x) => x.reversalOfPaymentId === p._id);
    const allocations = [];
    for (const a of p.allocations) {
      const o = await ctx.db.get(a.studentFeeId);
      allocations.push({ label: o?.label ?? "", dueDate: o?.dueDate ?? "", amountMinor: a.amountMinor });
    }
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const year = await ctx.db.get(p.academicYearId);
    const enr = await enrollmentFor(ctx, student._id, p.academicYearId);
    const section = enr ? await ctx.db.get(enr.sectionId) : null;
    const recorder = await ctx.db.get(p.recordedByUserId);
    const balance = year ? (await feeLedger(ctx, student, year)).totals.outstandingMinor : null;
    return {
      receiptId: r._id, receiptNo: r.receiptNo, issuedAt: r.issuedAt,
      school: { name: school.name, currency: school.currency, address: school.address ?? null },
      student: { studentId: student._id, name: fullName(student), admissionNo: student.admissionNo, classLabel: section && section.schoolId === school._id ? section.displayName : null },
      payment: { paymentId: p._id, amountMinor: p.amountMinor, method: p.method, reference: p.reference ?? null, paidOn: p.paidOn, reversed, recordedBy: recorder?.name ?? null },
      allocations, balanceNowMinor: balance,
    };
  },
});

/** Payments in a date range (≤ 366 days): totals by method and the rows (fee managers / finance reports). */
export const collectionSummary = financeQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    requireAnyPermission(ctx.actor, ["fees:manage", "reports:finance"]);
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    if (from > to) throw invalid("`from` must not be after `to`.");
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw invalid(`Ranges are limited to ${MAX_RANGE_DAYS} days.`);
    const rows = await ctx.db.query("feePayments").withIndex("by_school_paid", (q) => q.eq("schoolId", ctx.actor.schoolId).gte("paidOn", from).lte("paidOn", to)).collect();
    const reversedIds = new Set<string>();
    // Reversals of payments in range may be dated later; look them up per payment.
    for (const p of rows.filter((x) => !x.reversalOfPaymentId)) {
      const rev = (await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", p.studentId).gte("paidOn", p.paidOn)).collect()).find((x) => x.reversalOfPaymentId === p._id);
      if (rev) reversedIds.add(p._id);
    }
    const effective = rows.filter((p) => !p.reversalOfPaymentId && p.status === "completed" && !reversedIds.has(p._id));
    const byMethod: Record<string, number> = {};
    for (const p of effective) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountMinor;
    return {
      from, to,
      totalMinor: effective.reduce((a, p) => a + p.amountMinor, 0),
      payments: effective.length,
      reversed: reversedIds.size,
      byMethod,
    };
  },
});

// ================================================================ school-wide reads (fee managers / finance)
const FINANCE = ["fees:manage", "reports:finance"] as const;

/**
 * The fee overview for a year. Totals cover EVERY obligation of the year (so
 * dues of students who have since left still count); standing counts cover
 * students actively enrolled in the year. Monthly collections and recent
 * payments use effective payments only (reversed ones excluded).
 */
export const overview = financeQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    requireAnyPermission(ctx.actor, [...FINANCE]);
    const year = await yearOrCurrent(ctx, academicYearId);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    const data = await schoolYearFees(ctx, year._id);
    const enrolled = new Set((await activeEnrollments(ctx, year._id)).map((e) => e.studentId));
    const studentIds = new Set<Id<"students">>([...enrolled, ...data.obligations.keys()]);
    const totals = { grossMinor: 0, concessionMinor: 0, netMinor: 0, paidMinor: 0, outstandingMinor: 0, overdueMinor: 0, dueSoonMinor: 0 };
    const standing: Record<FeeStanding, number> = { paid: 0, clear: 0, due_soon: 0, overdue: 0, not_assigned: 0 };
    for (const id of studentIds) {
      const l = computeLedger(data.obligations.get(id) ?? [], data.concessions.get(id) ?? [], data.payments.get(id) ?? []);
      const st = standingOf(l.rows, today);
      totals.grossMinor += l.totals.grossMinor;
      totals.concessionMinor += l.totals.concessionMinor;
      totals.paidMinor += l.totals.paidMinor;
      totals.outstandingMinor += l.totals.outstandingMinor;
      totals.overdueMinor += st.overdueMinor;
      totals.dueSoonMinor += st.dueSoonMinor;
      if (enrolled.has(id)) standing[st.standing]++;
    }
    totals.netMinor = totals.grossMinor - totals.concessionMinor;
    // Months of the academic year, oldest first.
    const months: { month: string; amountMinor: number }[] = [];
    for (let m = year.startDate.slice(0, 7); m <= year.endDate.slice(0, 7); ) {
      months.push({ month: m, amountMinor: 0 });
      const [y, mo] = m.split("-").map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
    for (const p of data.effective) {
      const row = months.find((x) => x.month === p.paidOn.slice(0, 7));
      if (row) row.amountMinor += p.amountMinor;
    }
    const recent = [...data.effective].sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b._creationTime - a._creationTime).slice(0, 6);
    const recentPayments = [];
    for (const p of recent) {
      const r = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", p._id)).first();
      const st = await ctx.db.get(p.studentId);
      recentPayments.push({ paymentId: p._id, receiptId: r?._id ?? null, receiptNo: r?.receiptNo ?? null, studentId: p.studentId, studentName: st ? fullName(st) : "—", method: p.method, paidOn: p.paidOn, amountMinor: p.amountMinor });
    }
    return {
      academicYear: { academicYearId: year._id, name: year.name, startDate: year.startDate, endDate: year.endDate },
      today, totals, standing, monthly: months, recentPayments,
      collectionRate: totals.netMinor > 0 ? Math.round((totals.paidMinor / totals.netMinor) * 1000) / 10 : 0,
      enrolledStudents: enrolled.size,
    };
  },
});

/** Balance of every actively enrolled student of the year (optionally one class / section), with filters. */
export const listBalances = financeQuery({
  args: {
    academicYearId: v.optional(v.id("academicYears")), classId: v.optional(v.id("classes")), sectionId: v.optional(v.id("sections")),
    standing: v.optional(vStanding), search: v.optional(v.string()), dueBy: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requireAnyPermission(ctx.actor, [...FINANCE]);
    const year = await yearOrCurrent(ctx, a.academicYearId);
    if (a.classId) await getInSchool(ctx, "classes", a.classId, "Class");
    if (a.sectionId) await getInSchool(ctx, "sections", a.sectionId, "Section");
    if (a.dueBy) assertIsoDate(a.dueBy, "dueBy");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    const enrollments = (await activeEnrollments(ctx, year._id)).filter((e) => (!a.classId || e.classId === a.classId) && (!a.sectionId || e.sectionId === a.sectionId));
    const data = await schoolYearFees(ctx, year._id);
    const labels = await sectionLabels(ctx, year._id);
    const search = a.search?.trim().toLowerCase();
    const rows = [];
    for (const e of enrollments) {
      const student = await ctx.db.get(e.studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId || student.status !== "active") continue;
      const name = fullName(student);
      if (search && !name.toLowerCase().includes(search) && !student.admissionNo.toLowerCase().includes(search)) continue;
      const l = computeLedger(data.obligations.get(student._id) ?? [], data.concessions.get(student._id) ?? [], data.payments.get(student._id) ?? []);
      const st = standingOf(l.rows, today);
      if (a.standing && st.standing !== a.standing) continue;
      if (a.dueBy && !(st.nextDue && st.nextDue.dueDate <= a.dueBy)) continue;
      const last = (data.payments.get(student._id) ?? []).reduce<string | null>((m, p) => (!m || p.paidOn > m ? p.paidOn : m), null);
      rows.push({
        studentId: student._id, name, admissionNo: student.admissionNo, classId: e.classId, sectionId: e.sectionId, classLabel: labels.get(e.sectionId) ?? "—",
        grossMinor: l.totals.grossMinor, concessionMinor: l.totals.concessionMinor, netMinor: l.totals.grossMinor - l.totals.concessionMinor,
        paidMinor: l.totals.paidMinor, outstandingMinor: l.totals.outstandingMinor, overdueMinor: st.overdueMinor,
        standing: st.standing, nextDue: st.nextDue, lastPaymentOn: last,
      });
    }
    rows.sort((x, y) => x.classLabel.localeCompare(y.classLabel, undefined, { numeric: true }) || x.name.localeCompare(y.name));
    return { academicYear: { academicYearId: year._id, name: year.name }, today, rows };
  },
});

/** Payments of a year, newest first, with receipt numbers (reversed ones are flagged, not hidden). */
export const listPayments = financeQuery({
  args: {
    academicYearId: v.optional(v.id("academicYears")), from: v.optional(v.string()), to: v.optional(v.string()),
    classId: v.optional(v.id("classes")), method: v.optional(vPaymentMethod), search: v.optional(v.string()), limit: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    requireAnyPermission(ctx.actor, [...FINANCE]);
    const year = await yearOrCurrent(ctx, a.academicYearId);
    if (a.from) assertIsoDate(a.from, "from");
    if (a.to) assertIsoDate(a.to, "to");
    if (a.from && a.to && a.from > a.to) throw invalid("`from` must not be after `to`.");
    if (a.classId) await getInSchool(ctx, "classes", a.classId, "Class");
    const limit = Math.min(Math.max(Math.floor(a.limit ?? 200), 1), 500);
    const all = await ctx.db.query("feePayments").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)).take(MAX_AGGREGATE_ROWS + 1);
    if (all.length > MAX_AGGREGATE_ROWS) throw conflict("Too many payments to list in one request; narrow the dates.");
    const reversedIds = new Set(all.map((p) => p.reversalOfPaymentId).filter(Boolean) as Id<"feePayments">[]);
    const originals = all
      .filter((p) => !p.reversalOfPaymentId && (!a.from || p.paidOn >= a.from) && (!a.to || p.paidOn <= a.to) && (!a.method || p.method === a.method))
      .sort((x, y) => y.paidOn.localeCompare(x.paidOn) || y._creationTime - x._creationTime);
    const enrollments = a.classId ? new Map((await activeEnrollmentsAll(ctx, year._id)).map((e) => [e.studentId, e])) : null;
    const labels = await sectionLabels(ctx, year._id);
    const search = a.search?.trim().toLowerCase();
    const rows = [];
    let truncated = false;
    for (const p of originals) {
      if (enrollments && enrollments.get(p.studentId)?.classId !== a.classId) continue;
      const student = await ctx.db.get(p.studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId) continue;
      const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", p._id)).first();
      const studentName = fullName(student);
      if (search && ![studentName, student.admissionNo, receipt?.receiptNo ?? "", p.reference ?? ""].some((x) => x.toLowerCase().includes(search))) continue;
      if (rows.length === limit) { truncated = true; break; }
      const enr = enrollments?.get(p.studentId) ?? (await enrollmentFor(ctx, p.studentId, year._id));
      rows.push({
        paymentId: p._id, receiptId: receipt?._id ?? null, receiptNo: receipt?.receiptNo ?? null, paidOn: p.paidOn,
        studentId: student._id, studentName, admissionNo: student.admissionNo, classLabel: enr ? labels.get(enr.sectionId) ?? "—" : "—",
        method: p.method, reference: p.reference ?? null, amountMinor: p.amountMinor, reversed: reversedIds.has(p._id),
      });
    }
    return { rows, truncated };
  },
});

/** Latest enrollment per student in a year, whatever its status (payments of students who left still show their class). */
async function activeEnrollmentsAll(ctx: Ctx, academicYearId: Id<"academicYears">) {
  const rows = await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", academicYearId)).take(MAX_AGGREGATE_ROWS + 1);
  if (rows.length > MAX_AGGREGATE_ROWS) throw conflict("Too many enrollments to summarise in one request.");
  const latest = new Map<Id<"students">, Doc<"enrollments">>();
  for (const e of rows) {
    const cur = latest.get(e.studentId);
    if (!cur || e.status === "active" || (cur.status !== "active" && e._creationTime > cur._creationTime)) latest.set(e.studentId, e);
  }
  return [...latest.values()];
}

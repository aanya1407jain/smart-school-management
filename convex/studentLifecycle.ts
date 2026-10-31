/**
 * Student lifecycle — promotion to the next academic year, pass-out, and
 * transfer certificates (TC). Student Management module; permission
 * `students:lifecycle` (full administrators, or staff the Principal granted
 * "Approve" in Student Management — core/grants.ts).
 *
 * Invariants (tests: tests/convex/student-lifecycle.test.ts):
 *  - ONE student record per child, always. Promotion never creates a student;
 *    it ends the old year's enrollment (status "promoted") and creates the new
 *    year's enrollment for the SAME student id.
 *  - History is never rewritten: an ended enrollment keeps its class, section,
 *    dates and last roll number. Only ACTIVE rosters are renumbered
 *    (model/rollNumbers.ts), in the same transaction as the change.
 *  - Every operation is atomic: if any requested student is not eligible, the
 *    whole request is refused with the reasons and nothing is written.
 *  - Nothing is deleted. A cancelled TC keeps its row and its number.
 *  - Sign-in accounts are not changed here (suspend them in Accounts if needed).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { moduleMutation, moduleQuery } from "./core/functions";
import { getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, requireAnyPermission, requirePermission } from "./core/authorization";
import { AppError, conflict, invalid } from "./core/errors";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { fullName } from "./model/academics";
import { writeAudit } from "./model/audit";
import { todayIn } from "./model/calendar";
import { counterKeys, ensureCounterAtLeast, formatTransferCertificateNumber, nextTransferCertificateNumber, peekCounter } from "./model/counters";
import { attendanceTotals, feeBalanceOf, feeBalances, latestResults, newYearRecordsProblem } from "./model/lifecycle";
import { renumberSections } from "./model/rollNumbers";
import { scholarNoKey, studentByScholarNo } from "./model/scholarNumbers";

const studentsQuery = moduleQuery("students");
const studentsMutation = moduleMutation("students");

/** Most students one promotion / pass-out request may move (one transaction). */
export const MAX_LIFECYCLE_BATCH = 200;

type Ctx = QueryCtx & { actor: { schoolId: Id<"schools"> } };

async function activeEnrollmentIn(ctx: QueryCtx, studentId: Id<"students">, section: Doc<"sections">) {
  const rows = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", studentId).eq("academicYearId", section.academicYearId)).collect();
  return rows.find((e) => e.status === "active" && e.sectionId === section._id && e.schoolId === section.schoolId) ?? null;
}

async function activeEnrollmentInYear(ctx: QueryCtx, studentId: Id<"students">, academicYearId: Id<"academicYears">) {
  const rows = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", studentId).eq("academicYearId", academicYearId)).collect();
  return rows.find((e) => e.status === "active") ?? null;
}

async function sectionContext(ctx: Ctx, sectionId: Id<"sections">) {
  const section = await getInSchool(ctx as never, "sections", sectionId, "Section");
  const year = (await ctx.db.get(section.academicYearId))!;
  const klass = (await ctx.db.get(section.classId))!;
  return { section, year, klass };
}

function refuse(problems: string[]): never {
  throw new AppError("CONFLICT", `Nothing was changed. ${problems.slice(0, 10).join(" ")}${problems.length > 10 ? ` …and ${problems.length - 10} more.` : ""}`);
}

function assertBatch(studentIds: readonly Id<"students">[]) {
  if (studentIds.length === 0) throw invalid("Choose at least one student.");
  if (studentIds.length > MAX_LIFECYCLE_BATCH) throw invalid(`At most ${MAX_LIFECYCLE_BATCH} students per request.`);
  if (new Set(studentIds).size !== studentIds.length) throw invalid("A student is listed twice.");
}

// ================================================================ promotion
/** Who in `fromSectionId` can be promoted to `toSectionId`, and why not (read-only). */
export const promotionPlan = studentsQuery({
  args: { fromSectionId: v.id("sections"), toSectionId: v.id("sections") },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const from = await sectionContext(ctx, a.fromSectionId);
    const to = await sectionContext(ctx, a.toSectionId);
    const sectionProblem = promotionSectionProblem(from, to);
    const enrollments = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", from.section._id).eq("status", "active")).take(1001);
    const students: Doc<"students">[] = [];
    const enrollmentOf = new Map<Id<"students">, Doc<"enrollments">>();
    for (const e of enrollments) {
      const s = await ctx.db.get(e.studentId);
      if (!s || s.schoolId !== ctx.actor.schoolId) continue;
      students.push(s);
      enrollmentOf.set(s._id, e);
    }
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    const ids = students.map((s) => s._id);
    const [results, fees] = await Promise.all([latestResults(ctx, school._id, from.year._id, ids), feeBalances(ctx, school._id, from.year._id, ids, today)]);
    const rows = [];
    for (const s of students) {
      const e = enrollmentOf.get(s._id)!;
      const already = await activeEnrollmentInYear(ctx, s._id, to.year._id);
      const reason = s.status !== "active" ? `Student status is ${s.status}.` : already ? "Already enrolled in the target year." : null;
      const r = results.get(s._id) ?? null;
      const f = fees?.get(s._id) ?? null;
      rows.push({
        studentId: s._id, enrollmentId: e._id, name: fullName(s), firstName: s.firstName, lastName: s.lastName, admissionNo: s.admissionNo, scholarNo: s.scholarNo ?? null,
        rollNo: e.rollNo ?? null, eligible: !reason && !sectionProblem, reason,
        result: r, standing: r?.standing ?? ("no_result" as const),
        fees: f ? { outstandingMinor: f.outstandingMinor, overdueMinor: f.overdueMinor } : null,
      });
    }
    rows.sort((x, y) => (x.rollNo ?? 9999) - (y.rollNo ?? 9999) || x.name.localeCompare(y.name));
    const toRoster = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", to.section._id).eq("status", "active")).take(1001);
    return {
      from: { sectionId: from.section._id, label: from.section.displayName, year: from.year.name, yearId: from.year._id, className: from.klass.name, level: from.klass.level },
      to: { sectionId: to.section._id, label: to.section.displayName, year: to.year.name, yearId: to.year._id, className: to.klass.name, level: to.klass.level, capacity: to.section.capacity ?? null, enrolled: toRoster.length },
      kind: to.klass.level === from.klass.level ? ("repeat" as const) : ("promote" as const),
      sectionProblem,
      rows,
    };
  },
});

function promotionSectionProblem(from: Awaited<ReturnType<typeof sectionContext>>, to: Awaited<ReturnType<typeof sectionContext>>): string | null {
  if (from.year._id === to.year._id) return "The target section is in the same academic year; use a section transfer instead.";
  if (to.year.startDate <= from.year.startDate) return `The target year (${to.year.name}) must come after ${from.year.name}.`;
  if (to.klass.level < from.klass.level) return `${to.klass.name} is below ${from.klass.name}; students cannot be moved down a class.`;
  return null;
}

/**
 * Promote students of one section into a section of a LATER academic year.
 */
export const promote = studentsMutation({
  args: { fromSectionId: v.id("sections"), toSectionId: v.id("sections"), studentIds: v.array(v.id("students")) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    assertBatch(a.studentIds);
    const from = await sectionContext(ctx, a.fromSectionId);
    const to = await sectionContext(ctx, a.toSectionId);
    const sectionProblem = promotionSectionProblem(from, to);
    if (sectionProblem) throw invalid(sectionProblem);

    const plan: { student: Doc<"students">; enrollment: Doc<"enrollments"> }[] = [];
    const problems: string[] = [];
    for (const studentId of a.studentIds) {
      const student = await ctx.db.get(studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId) { problems.push("A selected student was not found."); continue; }
      const enrollment = await activeEnrollmentIn(ctx, student._id, from.section);
      if (student.status !== "active") problems.push(`${fullName(student)}: status is ${student.status}.`);
      else if (!enrollment) problems.push(`${fullName(student)} is not currently enrolled in ${from.section.displayName}.`);
      else if (await activeEnrollmentInYear(ctx, student._id, to.year._id)) problems.push(`${fullName(student)} is already enrolled in ${to.year.name}.`);
      else plan.push({ student, enrollment });
    }
    if (problems.length) refuse(problems);

    for (const { student, enrollment } of plan) {
      const endDate = from.year.endDate >= enrollment.startDate ? from.year.endDate : enrollment.startDate;
      await ctx.db.patch(enrollment._id, { status: "promoted", endDate });
      await ctx.db.insert("enrollments", {
        schoolId: ctx.actor.schoolId, studentId: student._id, academicYearId: to.year._id, classId: to.section.classId, sectionId: to.section._id,
        status: "active", startDate: to.year.startDate,
      });
    }
    await renumberSections(ctx, [from.section._id, to.section._id]);
    const kind = to.klass.level === from.klass.level ? "repeat" : "promote";
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "students.promoted", entity: { table: "sections", id: to.section._id },
      summary: `${kind === "repeat" ? "Moved" : "Promoted"} ${plan.length} student(s) from ${from.section.displayName} (${from.year.name}) to ${to.section.displayName} (${to.year.name})`,
      metadata: { kind, fromSectionId: from.section._id, toSectionId: to.section._id, studentIds: plan.map((p) => p.student._id) },
    });
    return { promoted: plan.length, kind };
  },
});

export const promotionTargets = studentsQuery({
  args: { fromSectionId: v.id("sections"), toAcademicYearId: v.id("academicYears") },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const from = await sectionContext(ctx, a.fromSectionId);
    const year = await getInSchool(ctx, "academicYears", a.toAcademicYearId, "Academic year");
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)).collect();
    const out = [];
    for (const section of sections) {
      const klass = await ctx.db.get(section.classId);
      if (!klass || klass.level < from.klass.level || klass.level > from.klass.level + 1) continue;
      const roster = [];
      for (const e of await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).take(1001)) {
        const s = await ctx.db.get(e.studentId);
        if (s) roster.push({ enrollmentId: e._id as string, studentId: s._id as string, firstName: s.firstName, lastName: s.lastName });
      }
      out.push({ sectionId: section._id, label: section.displayName, className: klass.name, level: klass.level, capacity: section.capacity ?? null, kind: klass.level === from.klass.level ? ("repeat" as const) : ("promote" as const), roster });
    }
    out.sort((x, y) => x.level - y.level || x.label.localeCompare(y.label));
    return { year: { yearId: year._id, name: year.name, startDate: year.startDate }, fromLevel: from.klass.level, sections: out };
  },
});

export const promoteBatch = studentsMutation({
  args: { fromSectionId: v.id("sections"), toAcademicYearId: v.id("academicYears"), moves: v.array(v.object({ studentId: v.id("students"), toSectionId: v.id("sections") })) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    assertBatch(a.moves.map((m) => m.studentId));
    const from = await sectionContext(ctx, a.fromSectionId);
    const toYear = await getInSchool(ctx, "academicYears", a.toAcademicYearId, "Academic year");
    const targets = new Map<Id<"sections">, Awaited<ReturnType<typeof sectionContext>>>();
    const problems: string[] = [];
    for (const m of a.moves) {
      if (targets.has(m.toSectionId)) continue;
      const to = await sectionContext(ctx, m.toSectionId);
      if (to.year._id !== toYear._id) throw invalid(`${to.section.displayName} is not in ${toYear.name}.`);
      const problem = promotionSectionProblem(from, to);
      if (problem) throw invalid(`${to.section.displayName}: ${problem}`);
      targets.set(m.toSectionId, to);
    }
    const plan: { student: Doc<"students">; enrollment: Doc<"enrollments">; to: Awaited<ReturnType<typeof sectionContext>> }[] = [];
    for (const m of a.moves) {
      const student = await ctx.db.get(m.studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId) { problems.push("A selected student was not found."); continue; }
      const enrollment = await activeEnrollmentIn(ctx, student._id, from.section);
      if (student.status !== "active") problems.push(`${fullName(student)}: status is ${student.status}.`);
      else if (!enrollment) problems.push(`${fullName(student)} is not currently enrolled in ${from.section.displayName}.`);
      else if (await activeEnrollmentInYear(ctx, student._id, toYear._id)) problems.push(`${fullName(student)} is already enrolled in ${toYear.name}.`);
      else plan.push({ student, enrollment, to: targets.get(m.toSectionId)! });
    }
    if (problems.length) refuse(problems);

    const moves = [];
    for (const { student, enrollment, to } of plan) {
      const endDate = from.year.endDate >= enrollment.startDate ? from.year.endDate : enrollment.startDate;
      await ctx.db.patch(enrollment._id, { status: "promoted", endDate });
      const newEnrollmentId = await ctx.db.insert("enrollments", {
        schoolId: ctx.actor.schoolId, studentId: student._id, academicYearId: toYear._id, classId: to.section.classId, sectionId: to.section._id,
        status: "active", startDate: toYear.startDate,
      });
      moves.push({ studentId: student._id, oldEnrollmentId: enrollment._id, newEnrollmentId, toSectionId: to.section._id, kind: to.klass.level === from.klass.level ? ("repeat" as const) : ("promote" as const) });
    }
    await renumberSections(ctx, [from.section._id, ...targets.keys()]);
    const runId = await ctx.db.insert("promotionRuns", {
      schoolId: ctx.actor.schoolId, fromSectionId: from.section._id, fromYearId: from.year._id, toYearId: toYear._id, moves,
      status: "applied", createdAt: Date.now(), createdByUserId: ctx.actor.userId,
    });
    const promoted = moves.filter((m) => m.kind === "promote").length;
    const repeated = moves.length - promoted;
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "students.promoted", entity: { table: "sections", id: from.section._id },
      summary: `Promoted ${promoted} and moved ${repeated} repeating student(s) from ${from.section.displayName} (${from.year.name}) to ${toYear.name}`,
      metadata: { runId, fromSectionId: from.section._id, toYearId: toYear._id, studentIds: moves.map((m) => m.studentId) },
    });
    return { runId, promoted, repeated };
  },
});

async function rollbackProblem(ctx: QueryCtx, run: Doc<"promotionRuns">): Promise<string | null> {
  if (run.status !== "applied") return "Already rolled back.";
  for (const m of run.moves) {
    const [oldE, newE, student] = await Promise.all([ctx.db.get(m.oldEnrollmentId), ctx.db.get(m.newEnrollmentId), ctx.db.get(m.studentId)]);
    const name = student ? fullName(student) : "A student";
    if (!oldE || oldE.status !== "promoted") return `${name}'s earlier enrollment has changed since.`;
    if (!newE || newE.status !== "active") return `${name} has left or moved since.`;
    if (student?.status !== "active") return `${name} is no longer active.`;
    const year = await ctx.db.get(run.toYearId);
    if (year) {
      const problem = await newYearRecordsProblem(ctx, m.studentId, name, year);
      if (problem) return problem;
    }
  }
  return null;
}

export const promotionRuns = studentsQuery({
  args: { fromSectionId: v.id("sections") },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    await getInSchool(ctx, "sections", a.fromSectionId, "Section");
    const runs = await ctx.db.query("promotionRuns").withIndex("by_school_section", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("fromSectionId", a.fromSectionId)).order("desc").take(5);
    const out = [];
    for (const r of runs) {
      const year = await ctx.db.get(r.toYearId);
      out.push({
        runId: r._id, createdAt: r.createdAt, by: await memberName(ctx, r.createdByUserId), toYear: year?.name ?? "—", status: r.status,
        promoted: r.moves.filter((m) => m.kind === "promote").length, repeated: r.moves.filter((m) => m.kind === "repeat").length,
        rolledBackAt: r.rolledBackAt ?? null, rollbackBlockedBy: r.status === "applied" ? await rollbackProblem(ctx, r) : null,
      });
    }
    return out;
  },
});

export const rollbackPromotion = studentsMutation({
  args: { runId: v.id("promotionRuns") },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const run = await getInSchool(ctx, "promotionRuns", a.runId, "Promotion run");
    const problem = await rollbackProblem(ctx, run);
    if (problem) throw conflict(`This promotion can no longer be rolled back. ${problem}`);
    const sections = new Set<Id<"sections">>();
    for (const m of run.moves) {
      const newE = (await ctx.db.get(m.newEnrollmentId))!;
      const oldE = (await ctx.db.get(m.oldEnrollmentId))!;
      for (const h of await ctx.db.query("rollNumberHistory").withIndex("by_enrollment", (q) => q.eq("enrollmentId", newE._id)).collect()) await ctx.db.delete(h._id);
      await ctx.db.delete(newE._id);
      await ctx.db.patch(oldE._id, { status: "active", endDate: undefined });
      sections.add(newE.sectionId).add(oldE.sectionId);
    }
    await renumberSections(ctx, sections);
    await ctx.db.patch(run._id, { status: "rolled_back", rolledBackAt: Date.now(), rolledBackByUserId: ctx.actor.userId });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "students.promotion_rolled_back", entity: { table: "sections", id: run.fromSectionId },
      summary: `Rolled back the promotion of ${run.moves.length} student(s)`,
      metadata: { runId: run._id, studentIds: run.moves.map((m) => m.studentId) },
    });
    return { restored: run.moves.length };
  },
});

// ================================================================ pass-out
export const passOut = studentsMutation({
  args: { sectionId: v.id("sections"), studentIds: v.array(v.id("students")), date: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    assertBatch(a.studentIds);
    assertIsoDate(a.date, "date");
    const { section, year } = await sectionContext(ctx, a.sectionId);
    if (a.date < year.startDate) throw invalid(`The pass-out date is before ${year.name} started.`, { date: "Before the academic year" });
    const plan: { student: Doc<"students">; enrollment: Doc<"enrollments"> }[] = [];
    const problems: string[] = [];
    for (const studentId of a.studentIds) {
      const student = await ctx.db.get(studentId);
      if (!student || student.schoolId !== ctx.actor.schoolId) { problems.push("A selected student was not found."); continue; }
      const enrollment = await activeEnrollmentIn(ctx, student._id, section);
      if (student.status !== "active") problems.push(`${fullName(student)}: status is ${student.status}.`);
      else if (!enrollment) problems.push(`${fullName(student)} is not currently enrolled in ${section.displayName}.`);
      else if (a.date < enrollment.startDate) problems.push(`${fullName(student)} joined ${section.displayName} after that date.`);
      else plan.push({ student, enrollment });
    }
    if (problems.length) refuse(problems);
    for (const { student, enrollment } of plan) {
      await ctx.db.patch(enrollment._id, { status: "completed", endDate: a.date });
      await ctx.db.patch(student._id, { status: "alumni" });
    }
    await renumberSections(ctx, [section._id]);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "students.passed_out", entity: { table: "sections", id: section._id },
      summary: `Passed out ${plan.length} student(s) of ${section.displayName} (${year.name}) on ${a.date}`,
      metadata: { sectionId: section._id, date: a.date, studentIds: plan.map((p) => p.student._id) },
    });
    return { passedOut: plan.length };
  },
});

export const passOutPlan = studentsQuery({
  args: { sectionId: v.id("sections") },
  handler: async (ctx, { sectionId }) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const { section, year, klass } = await sectionContext(ctx, sectionId);
    const enrollments = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).take(1001);
    const students: { s: Doc<"students">; e: Doc<"enrollments"> }[] = [];
    for (const e of enrollments) {
      const s = await ctx.db.get(e.studentId);
      if (s && s.schoolId === ctx.actor.schoolId) students.push({ s, e });
    }
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const ids = students.map((x) => x.s._id);
    const [results, fees] = await Promise.all([latestResults(ctx, school._id, year._id, ids), feeBalances(ctx, school._id, year._id, ids, todayIn(school.timezone))]);
    const RESULT = { eligible: "passed", compartment: "compartment", detained: "failed" } as const;
    const rows = students.map(({ s, e }) => {
      const r = results.get(s._id);
      const f = fees?.get(s._id) ?? null;
      const result = r ? RESULT[r.standing as keyof typeof RESULT] : ("withheld" as const);
      return {
        studentId: s._id, name: fullName(s), firstName: s.firstName, lastName: s.lastName, admissionNo: s.admissionNo, scholarNo: s.scholarNo ?? null,
        rollNo: e.rollNo ?? null, status: s.status, dateOfBirth: s.dateOfBirth ?? null,
        result, percentage: r?.percentage ?? null, grade: r?.grade ?? null, examName: r?.examName ?? null,
        outstandingMinor: f ? f.outstandingMinor : null, cleared: result === "passed" && (!f || f.outstandingMinor === 0),
      };
    });
    rows.sort((x, y) => (x.rollNo ?? 9999) - (y.rollNo ?? 9999) || x.name.localeCompare(y.name));
    return { section: { sectionId: section._id, label: section.displayName, year: year.name, yearStart: year.startDate, yearEnd: year.endDate, className: klass.name }, school: { name: school.name, address: school.address ?? null }, rows };
  },
});

// ================================================================ transfer certificates
const optText = (value: string | undefined, field: string, max: number) => (value?.trim() ? assertNonEmpty(value, field, max) : undefined);

const TC_FIELDS = {
  leavingDate: v.string(),
  reason: v.string(),
  conduct: v.optional(v.string()),
  destinationSchool: v.optional(v.string()),
  remarks: v.optional(v.string()),
  applicationDate: v.optional(v.string()),
  tcNo: v.optional(v.string()),
};

type TcInput = { leavingDate: string; reason: string; conduct?: string; destinationSchool?: string; remarks?: string; applicationDate?: string; tcNo?: string };

function cleanTcInput(a: TcInput) {
  assertIsoDate(a.leavingDate, "leavingDate");
  if (a.applicationDate) assertIsoDate(a.applicationDate, "applicationDate");
  return {
    leavingDate: a.leavingDate,
    reason: assertNonEmpty(a.reason, "reason", 200),
    conduct: optText(a.conduct, "conduct", 300),
    destinationSchool: optText(a.destinationSchool, "destinationSchool", 120),
    remarks: optText(a.remarks, "remarks", 300),
    applicationDate: a.applicationDate || undefined,
    tcNo: optText(a.tcNo, "tcNo", 40),
  };
}

async function tcSnapshot(ctx: QueryCtx, school: Doc<"schools">, student: Doc<"students">, upTo: string) {
  const all = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", student._id)).collect();
  const mine = all.filter((e) => e.schoolId === school._id);
  const active = mine.find((e) => e.status === "active") ?? null;
  const latest = active ?? [...mine].sort((x, y) => (y.endDate ?? y.startDate).localeCompare(x.endDate ?? x.startDate))[0] ?? null;
  const [lastClass, lastSection, lastYear] = latest ? [await ctx.db.get(latest.classId), await ctx.db.get(latest.sectionId), await ctx.db.get(latest.academicYearId)] : [null, null, null];
  const links = (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect()).filter((l) => l.schoolId === school._id).sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary));
  const parents: { relation: string; name: string }[] = [];
  for (const l of links) {
    const g = await ctx.db.get(l.guardianId);
    if (g && g.schoolId === school._id) parents.push({ relation: l.relationship.toLowerCase(), name: g.name });
  }
  const settings = await getSchoolSettings(ctx, school._id);
  const totals = lastYear ? await attendanceTotals(ctx, student._id, lastYear, upTo, settings.attendance.lateCountsAsPresent) : null;
  const father = parents.find((p) => p.relation === "father")?.name;
  const mother = parents.find((p) => p.relation === "mother")?.name;
  return {
    active,
    lastYear,
    snapshot: {
      studentName: fullName(student), admissionNo: student.admissionNo,
      ...(student.scholarNo ? { scholarNo: student.scholarNo } : {}),
      ...(student.dateOfBirth ? { dateOfBirth: student.dateOfBirth } : {}),
      ...(student.admissionDate ? { admissionDate: student.admissionDate } : {}),
      ...(lastClass ? { lastClass: lastClass.name } : {}), ...(lastSection ? { lastSection: lastSection.displayName } : {}),
      ...(lastYear ? { academicYear: lastYear.name } : {}), ...(parents[0] ? { parentName: parents[0].name } : {}),
      ...(father ? { fatherName: father } : {}), ...(mother ? { motherName: mother } : {}),
      ...(totals ? { workingDays: totals.workingDays, attendedDays: totals.attendedDays } : {}),
    },
  };
}

async function assertTcNoFree(ctx: QueryCtx, schoolId: Id<"schools">, tcNo: string, except?: Id<"transferCertificates">) {
  const clash = (await ctx.db.query("transferCertificates").withIndex("by_school_number", (q) => q.eq("schoolId", schoolId).eq("tcNo", tcNo)).collect()).find((t) => t._id !== except);
  if (clash) throw conflict(`Certificate number ${tcNo} is already used.`);
}

async function newVerificationCode(ctx: QueryCtx) {
  for (;;) {
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
    if (!(await ctx.db.query("transferCertificates").withIndex("by_verification", (q) => q.eq("verificationCode", code)).first())) return code;
  }
}

export const saveTransferCertificateDraft = studentsMutation({
  args: { tcId: v.optional(v.id("transferCertificates")), studentId: v.id("students"), ...TC_FIELDS },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const f = cleanTcInput(a);
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    if (f.tcNo) await assertTcNoFree(ctx, school._id, f.tcNo, a.tcId);
    const { snapshot } = await tcSnapshot(ctx, school, student, f.leavingDate);
    const fields = {
      tcNo: f.tcNo ?? "", leavingDate: f.leavingDate, reason: f.reason, issueDate: f.leavingDate,
      conduct: f.conduct, destinationSchool: f.destinationSchool, remarks: f.remarks, applicationDate: f.applicationDate, snapshot,
    };
    if (a.tcId) {
      const tc = await getInSchool(ctx, "transferCertificates", a.tcId, "Transfer certificate");
      if (tc.status !== "draft") throw conflict("Only a draft can be edited.");
      if (tc.studentId !== student._id) throw invalid("The draft belongs to another student.");
      await ctx.db.patch(tc._id, fields);
      return { tcId: tc._id };
    }
    const tcId = await ctx.db.insert("transferCertificates", {
      schoolId: school._id, studentId: student._id, status: "draft", previousStatus: student.status, issuedByUserId: ctx.actor.userId, ...fields,
    });
    await writeAudit(ctx, {
      schoolId: school._id, actor: ctx.actor, action: "student.tc_drafted", entity: { table: "students", id: student._id },
      summary: `Saved a transfer certificate draft for ${fullName(student)} (${student.admissionNo})`, metadata: { tcId },
    });
    return { tcId };
  },
});

export const issueTransferCertificate = studentsMutation({
  args: { studentId: v.id("students"), draftId: v.optional(v.id("transferCertificates")), waiverNote: v.optional(v.string()), ...TC_FIELDS },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const f = cleanTcInput(a);
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const mineTcs = await ctx.db.query("transferCertificates").withIndex("by_school_student", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("studentId", student._id)).collect();
    const existing = mineTcs.find((t) => t.status === "issued");
    if (existing) throw conflict(`${fullName(student)} already has transfer certificate ${existing.tcNo}. Cancel it first to issue a new one.`);
    if (student.status === "transferred") throw conflict(`${fullName(student)} has already left the school.`);
    if (student.admissionDate && f.leavingDate < student.admissionDate) throw invalid("The leaving date is before the admission date.", { leavingDate: "Before admission" });
    const draft = a.draftId ? mineTcs.find((t) => t._id === a.draftId) : undefined;
    if (a.draftId && (!draft || draft.status !== "draft")) throw conflict("That draft is no longer available.");

    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const currentYear = (await ctx.db.get(await getCurrentAcademicYearId(ctx, school._id)))!;
    const today = todayIn(school.timezone);
    const dues = await feeBalanceOf(ctx, student, currentYear._id, today);
    const waiverNote = optText(a.waiverNote, "waiverNote", 300);
    if (dues && dues.outstandingMinor > 0) {
      if (!waiverNote) throw conflict(`${fullName(student)} has unpaid fees for ${currentYear.name}. Clear the dues or record a waiver to issue a provisional certificate.`);
      if (!hasPermission(ctx.actor, "fees:manage")) throw new AppError("FORBIDDEN", "Only the Principal or an administrator who manages fees can waive dues for a certificate.");
    }
    const { active, snapshot } = await tcSnapshot(ctx, school, student, f.leavingDate);
    if (active && f.leavingDate < active.startDate) throw invalid("The leaving date is before the student joined the current section.", { leavingDate: "Before the enrollment started" });

    let tcNo: string;
    if (f.tcNo) {
      await assertTcNoFree(ctx, school._id, f.tcNo, draft?._id);
      tcNo = f.tcNo;
      const m = /\/(\d+)$/.exec(f.tcNo);
      if (m && f.tcNo === formatTransferCertificateNumber(school, currentYear, Number(m[1]))) await ensureCounterAtLeast(ctx, school._id, counterKeys.transferCertificate(currentYear._id), Number(m[1]));
    } else {
      tcNo = await nextTransferCertificateNumber(ctx, school, currentYear);
      await assertTcNoFree(ctx, school._id, tcNo, draft?._id);
    }

    if (active) {
      await ctx.db.patch(active._id, { status: "withdrawn", endDate: f.leavingDate });
      await renumberSections(ctx, [active.sectionId]);
    }
    await ctx.db.patch(student._id, { status: "transferred" });
    const fields = {
      tcNo, status: "issued" as const, issueDate: today, leavingDate: f.leavingDate, reason: f.reason,
      conduct: f.conduct, destinationSchool: f.destinationSchool, remarks: f.remarks, applicationDate: f.applicationDate,
      previousStatus: student.status, endedEnrollmentId: active?._id, snapshot,
      duesWaiver: dues && dues.outstandingMinor > 0 && waiverNote ? { outstandingMinor: dues.outstandingMinor, note: waiverNote, byUserId: ctx.actor.userId } : undefined,
      verificationCode: await newVerificationCode(ctx), issuedByUserId: ctx.actor.userId,
    };
    let tcId: Id<"transferCertificates">;
    if (draft) { await ctx.db.patch(draft._id, fields); tcId = draft._id; }
    else tcId = await ctx.db.insert("transferCertificates", { schoolId: school._id, studentId: student._id, ...fields });
    await writeAudit(ctx, {
      schoolId: school._id, actor: ctx.actor, action: "student.tc_issued", entity: { table: "students", id: student._id },
      summary: `Issued transfer certificate ${tcNo} to ${fullName(student)} (${student.admissionNo})${fields.duesWaiver ? " with a dues waiver" : ""}`,
      metadata: { tcId, tcNo, leavingDate: f.leavingDate, endedEnrollmentId: active?._id ?? null, previousStatus: student.status, duesWaiver: fields.duesWaiver ?? null, duesChecked: dues !== null },
    });
    return { tcId, tcNo };
  },
});

export const cancelTransferCertificate = studentsMutation({
  args: { tcId: v.id("transferCertificates"), reason: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const reason = assertNonEmpty(a.reason, "reason", 200);
    const tc = await getInSchool(ctx, "transferCertificates", a.tcId, "Transfer certificate");
    if (tc.status === "cancelled") throw conflict("This transfer certificate is already cancelled.");
    const student = await getInSchool(ctx, "students", tc.studentId, "Student");
    await ctx.db.patch(tc._id, { status: "cancelled", cancelledAt: Date.now(), cancelReason: reason, cancelledByUserId: ctx.actor.userId });
    if (tc.status === "issued" && student.status === "transferred") await ctx.db.patch(student._id, { status: tc.previousStatus === "transferred" ? "active" : tc.previousStatus });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "student.tc_cancelled", entity: { table: "students", id: student._id },
      summary: tc.status === "draft" ? `Voided a transfer certificate draft of ${fullName(student)}` : `Cancelled transfer certificate ${tc.tcNo} of ${fullName(student)}`,
      metadata: { tcId: tc._id, tcNo: tc.tcNo, reason, wasDraft: tc.status === "draft" },
    });
    return { ok: true as const };
  },
});

function tcView(tc: Doc<"transferCertificates">, issuedBy: string) {
  return {
    tcId: tc._id, tcNo: tc.tcNo, studentId: tc.studentId, status: tc.status, issueDate: tc.issueDate, leavingDate: tc.leavingDate,
    applicationDate: tc.applicationDate ?? null, reason: tc.reason, conduct: tc.conduct ?? null, destinationSchool: tc.destinationSchool ?? null, remarks: tc.remarks ?? null,
    snapshot: tc.snapshot, issuedBy, cancelledAt: tc.cancelledAt ?? null, cancelReason: tc.cancelReason ?? null,
    verificationCode: tc.status === "issued" || tc.status === "cancelled" ? tc.verificationCode ?? null : null,
    duesWaiver: tc.duesWaiver ? { outstandingMinor: tc.duesWaiver.outstandingMinor, note: tc.duesWaiver.note } : null,
  };
}

async function memberName(ctx: Ctx, userId: Id<"users">) {
  const m = (await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).find((x) => x.schoolId === ctx.actor.schoolId);
  return m?.displayName ?? "Former member";
}

export const transferCertificates = studentsQuery({
  args: { studentId: v.optional(v.id("students")) },
  handler: async (ctx, { studentId }) => {
    requireAnyPermission(ctx.actor, ["students:lifecycle", "students:read:all"]);
    let rows: Doc<"transferCertificates">[];
    if (studentId) {
      const s = await getInSchool(ctx, "students", studentId, "Student");
      rows = await ctx.db.query("transferCertificates").withIndex("by_school_student", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("studentId", s._id)).collect();
    } else {
      rows = await ctx.db.query("transferCertificates").withIndex("by_school_number", (q) => q.eq("schoolId", ctx.actor.schoolId)).order("desc").take(300);
    }
    if (!hasPermission(ctx.actor, "students:lifecycle")) rows = rows.filter((r) => r.status !== "draft");
    rows.sort((x, y) => y._creationTime - x._creationTime);
    const out = [];
    for (const r of rows) out.push(tcView(r, await memberName(ctx, r.issuedByUserId)));
    return out;
  },
});

/**
 * Students the office can issue a TC to, matched by name, admission number,
 * scholar number or (digits) current roll number. At most 8 matches.
 */
export const tcCandidates = studentsQuery({
  args: { search: v.string() },
  handler: async (ctx, { search }) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const q = search.trim().toLowerCase();
    if (q.length < 2 && !/^\d+$/.test(q)) return [];
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const enrollments = (await ctx.db.query("enrollments").withIndex("by_school_year", (x) => x.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).take(5000)).filter((e) => e.status === "active");
    const sectionLabel = new Map<Id<"sections">, string>();
    const out = [];
    for (const e of enrollments) {
      const s = await ctx.db.get(e.studentId);
      if (!s || s.status !== "active") continue;
      const hit = fullName(s).toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q) || (s.scholarNo ?? "").toLowerCase().replace(/\s/g, "").includes(q.replace(/\s/g, "")) || (/^\d+$/.test(q) && e.rollNo === Number(q));
      if (!hit) continue;
      if (!sectionLabel.has(e.sectionId)) sectionLabel.set(e.sectionId, (await ctx.db.get(e.sectionId))?.displayName ?? "—");
      out.push({ studentId: s._id, name: fullName(s), admissionNo: s.admissionNo, scholarNo: s.scholarNo ?? null, rollNo: e.rollNo ?? null, section: sectionLabel.get(e.sectionId)! });
      if (out.length >= 8) break;
    }
    return out;
  },
});

export const tcStudentProfile = studentsQuery({
  args: { studentId: v.id("students"), leavingDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const today = todayIn(school.timezone);
    const currentYear = (await ctx.db.get(await getCurrentAcademicYearId(ctx, school._id)))!;
    const { snapshot } = await tcSnapshot(ctx, school, student, a.leavingDate && /^\d{4}-\d{2}-\d{2}$/.test(a.leavingDate) ? a.leavingDate : today);
    const dues = await feeBalanceOf(ctx, student, currentYear._id, today);
    const tcs = await ctx.db.query("transferCertificates").withIndex("by_school_student", (q) => q.eq("schoolId", school._id).eq("studentId", student._id)).collect();
    const draft = tcs.filter((t) => t.status === "draft").sort((x, y) => y._creationTime - x._creationTime)[0] ?? null;
    return {
      studentId: student._id, status: student.status, snapshot,
      dues: dues ? { year: currentYear.name, outstandingMinor: dues.outstandingMinor, overdueMinor: dues.overdueMinor } : null,
      canWaive: hasPermission(ctx.actor, "fees:manage"),
      issued: tcs.find((t) => t.status === "issued")?.tcNo ?? null,
      draft: draft ? tcView(draft, await memberName(ctx, draft.issuedByUserId)) : null,
      nextTcNo: formatTransferCertificateNumber(school, currentYear, (await peekCounter(ctx, school._id, counterKeys.transferCertificate(currentYear._id))) + 1),
    };
  },
});

export const transferCertificate = studentsQuery({
  args: { tcId: v.id("transferCertificates") },
  handler: async (ctx, { tcId }) => {
    requireAnyPermission(ctx.actor, ["students:lifecycle", "students:read:all"]);
    const tc = await getInSchool(ctx, "transferCertificates", tcId, "Transfer certificate");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    return { ...tcView(tc, await memberName(ctx, tc.issuedByUserId)), school: { name: school.name, code: school.code, address: school.address ?? null } };
  },
});

/**
 * BUG-009 Fix: Exact lookup by Scholar Number with seamless fallback to Admission Number.
 */
export const findByScholarNo = studentsQuery({
  args: { scholarNo: v.string() },
  handler: async (ctx, { scholarNo }) => {
    if (!hasPermission(ctx.actor, "students:lifecycle")) requirePermission(ctx.actor, "students:read:all");
    const raw = scholarNo.trim();
    if (!raw) return null;

    // 1. Primary lookup by normalized scholar number
    const key = scholarNoKey(raw);
    let s: Doc<"students"> | null = null;
    if (key) {
      s = await studentByScholarNo(ctx, ctx.actor.schoolId, key);
    }

    // 2. BUG-009 Fallback: lookup by Admission Number
    if (!s) {
      s = await ctx.db
        .query("students")
        .withIndex("by_school_admission", (q) =>
          q.eq("schoolId", ctx.actor.schoolId).eq("admissionNo", raw)
        )
        .first();
    }

    return s
      ? {
          studentId: s._id,
          name: fullName(s),
          admissionNo: s.admissionNo,
          scholarNo: s.scholarNo ?? null,
          status: s.status,
        }
      : null;
  },
});

export const sectionStudents = studentsQuery({
  args: { sectionId: v.id("sections") },
  handler: async (ctx, { sectionId }) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const { section, year, klass } = await sectionContext(ctx, sectionId);
    const enrollments = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).take(1001);
    const rows = [];
    for (const e of enrollments) {
      const s = await ctx.db.get(e.studentId);
      if (!s || s.schoolId !== ctx.actor.schoolId) continue;
      rows.push({ studentId: s._id, name: fullName(s), admissionNo: s.admissionNo, scholarNo: s.scholarNo ?? null, rollNo: e.rollNo ?? null, status: s.status });
    }
    rows.sort((x, y) => (x.rollNo ?? 9999) - (y.rollNo ?? 9999) || x.name.localeCompare(y.name));
    return { section: { sectionId: section._id, label: section.displayName, year: year.name, yearStart: year.startDate, yearEnd: year.endDate, className: klass.name }, rows };
  },
});
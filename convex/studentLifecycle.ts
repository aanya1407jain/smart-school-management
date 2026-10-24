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
import { getCurrentAcademicYearId, getInSchool, hasPermission, requireAnyPermission, requirePermission } from "./core/authorization";
import { AppError, conflict, invalid } from "./core/errors";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { fullName } from "./model/academics";
import { writeAudit } from "./model/audit";
import { todayIn } from "./model/calendar";
import { nextTransferCertificateNumber } from "./model/counters";
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
    const rows = [];
    for (const e of enrollments) {
      const s = await ctx.db.get(e.studentId);
      if (!s || s.schoolId !== ctx.actor.schoolId) continue;
      const already = await activeEnrollmentInYear(ctx, s._id, to.year._id);
      const reason = s.status !== "active" ? `Student status is ${s.status}.` : already ? "Already enrolled in the target year." : null;
      rows.push({ studentId: s._id, name: fullName(s), admissionNo: s.admissionNo, scholarNo: s.scholarNo ?? null, rollNo: e.rollNo ?? null, eligible: !reason && !sectionProblem, reason });
    }
    rows.sort((x, y) => (x.rollNo ?? 9999) - (y.rollNo ?? 9999) || x.name.localeCompare(y.name));
    return {
      from: { sectionId: from.section._id, label: from.section.displayName, year: from.year.name, className: from.klass.name, level: from.klass.level },
      to: { sectionId: to.section._id, label: to.section.displayName, year: to.year.name, className: to.klass.name, level: to.klass.level },
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
 * Promote students of one section into a section of a LATER academic year
 * (the same class level = repeating the year). Old enrollment → "promoted"
 * (end date = old year's end, roll number kept); new active enrollment in the
 * target section; both rosters renumbered. Atomic.
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
      await ctx.db.patch(enrollment._id, { status: "promoted", endDate }); // roll number kept as history
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

// ================================================================ pass-out
/**
 * Students who finished school: their active enrollment in the section ends
 * as "completed" on `date` and their status becomes "alumni". Atomic.
 */
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

// ================================================================ transfer certificates
const optText = (value: string | undefined, field: string, max: number) => (value?.trim() ? assertNonEmpty(value, field, max) : undefined);

/**
 * Issue a transfer certificate: the student leaves the school. Any active
 * enrollment ends as "withdrawn" on `leavingDate` (roster renumbered), the
 * student's status becomes "transferred", and a numbered TC is recorded with
 * a snapshot of what it certifies. One issued TC per student at a time.
 */
export const issueTransferCertificate = studentsMutation({
  args: {
    studentId: v.id("students"),
    leavingDate: v.string(),
    reason: v.string(),
    conduct: v.optional(v.string()),
    destinationSchool: v.optional(v.string()),
    remarks: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    assertIsoDate(a.leavingDate, "leavingDate");
    const reason = assertNonEmpty(a.reason, "reason", 200);
    const conduct = optText(a.conduct, "conduct", 60);
    const destinationSchool = optText(a.destinationSchool, "destinationSchool", 120);
    const remarks = optText(a.remarks, "remarks", 300);
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const existing = (await ctx.db.query("transferCertificates").withIndex("by_school_student", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("studentId", student._id)).collect()).find((t) => t.status === "issued");
    if (existing) throw conflict(`${fullName(student)} already has transfer certificate ${existing.tcNo}. Cancel it first to issue a new one.`);
    if (student.status === "transferred") throw conflict(`${fullName(student)} has already left the school.`);
    if (student.admissionDate && a.leavingDate < student.admissionDate) throw invalid("The leaving date is before the admission date.", { leavingDate: "Before admission" });

    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const currentYearId = await getCurrentAcademicYearId(ctx, school._id);
    const currentYear = (await ctx.db.get(currentYearId))!;
    // The enrollment that ends (any active one), else the latest for the certificate's "last class".
    const all = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", student._id)).collect();
    const mine = all.filter((e) => e.schoolId === school._id);
    const active = mine.find((e) => e.status === "active") ?? null;
    if (active && a.leavingDate < active.startDate) throw invalid("The leaving date is before the student joined the current section.", { leavingDate: "Before the enrollment started" });
    const latest = active ?? [...mine].sort((x, y) => (y.endDate ?? y.startDate).localeCompare(x.endDate ?? x.startDate))[0] ?? null;
    const [lastClass, lastSection, lastYear] = latest ? [await ctx.db.get(latest.classId), await ctx.db.get(latest.sectionId), await ctx.db.get(latest.academicYearId)] : [null, null, null];
    const link = (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect()).filter((l) => l.schoolId === school._id).sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary))[0];
    const parent = link ? await ctx.db.get(link.guardianId) : null;

    if (active) {
      await ctx.db.patch(active._id, { status: "withdrawn", endDate: a.leavingDate }); // last roll number kept as history
      await renumberSections(ctx, [active.sectionId]);
    }
    await ctx.db.patch(student._id, { status: "transferred" });
    const tcNo = await nextTransferCertificateNumber(ctx, school, currentYear);
    const tcId = await ctx.db.insert("transferCertificates", {
      schoolId: school._id, studentId: student._id, tcNo, status: "issued",
      issueDate: todayIn(school.timezone), leavingDate: a.leavingDate, reason,
      ...(conduct ? { conduct } : {}), ...(destinationSchool ? { destinationSchool } : {}), ...(remarks ? { remarks } : {}),
      previousStatus: student.status,
      ...(active ? { endedEnrollmentId: active._id } : {}),
      snapshot: {
        studentName: fullName(student), admissionNo: student.admissionNo,
        ...(student.scholarNo ? { scholarNo: student.scholarNo } : {}),
        ...(student.dateOfBirth ? { dateOfBirth: student.dateOfBirth } : {}),
        ...(student.admissionDate ? { admissionDate: student.admissionDate } : {}),
        ...(lastClass ? { lastClass: lastClass.name } : {}), ...(lastSection ? { lastSection: lastSection.displayName } : {}),
        ...(lastYear ? { academicYear: lastYear.name } : {}), ...(parent && parent.schoolId === school._id ? { parentName: parent.name } : {}),
      },
      issuedByUserId: ctx.actor.userId,
    });
    await writeAudit(ctx, {
      schoolId: school._id, actor: ctx.actor, action: "student.tc_issued", entity: { table: "students", id: student._id },
      summary: `Issued transfer certificate ${tcNo} to ${fullName(student)} (${student.admissionNo})`,
      metadata: { tcId, tcNo, leavingDate: a.leavingDate, endedEnrollmentId: active?._id ?? null, previousStatus: student.status },
    });
    return { tcId, tcNo };
  },
});

/**
 * Cancel an issued TC (e.g. issued by mistake). The TC row and number stay
 * (status "cancelled"); the student's previous status is restored. The ended
 * enrollment is NOT reopened — re-enrol the student if they are staying.
 */
export const cancelTransferCertificate = studentsMutation({
  args: { tcId: v.id("transferCertificates"), reason: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:lifecycle");
    const reason = assertNonEmpty(a.reason, "reason", 200);
    const tc = await getInSchool(ctx, "transferCertificates", a.tcId, "Transfer certificate");
    if (tc.status !== "issued") throw conflict("This transfer certificate is already cancelled.");
    const student = await getInSchool(ctx, "students", tc.studentId, "Student");
    await ctx.db.patch(tc._id, { status: "cancelled", cancelledAt: Date.now(), cancelReason: reason, cancelledByUserId: ctx.actor.userId });
    if (student.status === "transferred") await ctx.db.patch(student._id, { status: tc.previousStatus === "transferred" ? "active" : tc.previousStatus });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "student.tc_cancelled", entity: { table: "students", id: student._id },
      summary: `Cancelled transfer certificate ${tc.tcNo} of ${fullName(student)}`,
      metadata: { tcId: tc._id, tcNo: tc.tcNo, reason },
    });
    return { ok: true as const };
  },
});

function tcView(tc: Doc<"transferCertificates">, issuedBy: string) {
  return {
    tcId: tc._id, tcNo: tc.tcNo, studentId: tc.studentId, status: tc.status, issueDate: tc.issueDate, leavingDate: tc.leavingDate,
    reason: tc.reason, conduct: tc.conduct ?? null, destinationSchool: tc.destinationSchool ?? null, remarks: tc.remarks ?? null,
    snapshot: tc.snapshot, issuedBy, cancelledAt: tc.cancelledAt ?? null, cancelReason: tc.cancelReason ?? null,
  };
}

async function memberName(ctx: Ctx, userId: Id<"users">) {
  const m = (await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).find((x) => x.schoolId === ctx.actor.schoolId);
  return m?.displayName ?? "Former member";
}

/** Transfer certificates, newest first: one student's, or the school's latest (≤ 200). */
export const transferCertificates = studentsQuery({
  args: { studentId: v.optional(v.id("students")) },
  handler: async (ctx, { studentId }) => {
    requireAnyPermission(ctx.actor, ["students:lifecycle", "students:read:all"]);
    let rows: Doc<"transferCertificates">[];
    if (studentId) {
      const s = await getInSchool(ctx, "students", studentId, "Student");
      rows = await ctx.db.query("transferCertificates").withIndex("by_school_student", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("studentId", s._id)).collect();
    } else {
      rows = await ctx.db.query("transferCertificates").withIndex("by_school_number", (q) => q.eq("schoolId", ctx.actor.schoolId)).order("desc").take(200);
    }
    rows.sort((x, y) => y._creationTime - x._creationTime);
    const out = [];
    for (const r of rows) out.push(tcView(r, await memberName(ctx, r.issuedByUserId)));
    return out;
  },
});

/** One transfer certificate with the school header, for printing / reprinting. */
export const transferCertificate = studentsQuery({
  args: { tcId: v.id("transferCertificates") },
  handler: async (ctx, { tcId }) => {
    requireAnyPermission(ctx.actor, ["students:lifecycle", "students:read:all"]);
    const tc = await getInSchool(ctx, "transferCertificates", tcId, "Transfer certificate");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    return { ...tcView(tc, await memberName(ctx, tc.issuedByUserId)), school: { name: school.name, code: school.code, address: school.address ?? null } };
  },
});

/** Exact lookup by scholar number (case- and space-insensitive). */
export const findByScholarNo = studentsQuery({
  args: { scholarNo: v.string() },
  handler: async (ctx, { scholarNo }) => {
    if (!hasPermission(ctx.actor, "students:lifecycle")) requirePermission(ctx.actor, "students:read:all");
    const key = scholarNoKey(scholarNo.trim());
    if (!key) return null;
    const s = await studentByScholarNo(ctx, ctx.actor.schoolId, key);
    return s ? { studentId: s._id, name: fullName(s), admissionNo: s.admissionNo, scholarNo: s.scholarNo ?? null, status: s.status } : null;
  },
});

/** Students actively enrolled in a section, for choosing who passes out (students:lifecycle). */
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

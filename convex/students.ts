/**
 * Students: admission with enrollment, enrolling and ending enrollments, the
 * student profile, rosters, enrollment and roll-number history, and student
 * totals. Moved from convex/academics.ts (which keeps the Core school
 * structure). Functions keep their original wrappers.
 *
 * The profile's attendance, results, homework and fee sections come from the
 * owning modules through providers (core/registry.ts): a module that is not
 * shipped in this build contributes an empty section, exactly as a module the
 * school has not enabled does.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolQuery, moduleQuery, moduleMutation } from "./core/functions";
import {
  getCurrentAcademicYearId, getInSchool, hasPermission, linkedStudentIds, requirePermission,
  requireSectionRead, requireStudentAccess,
} from "./core/authorization";
import { AppError, conflict, invalid, invalidRelationship } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vGender } from "./core/validators";
import { maybeProvider } from "./core/registry";
import { activeRoster, fullName, teacherDisplayName } from "./model/academics";
import { writeAudit } from "./model/audit";
import { compareRosterEntries, renumberSections } from "./model/rollNumbers";
import { nextAdmissionNumber } from "./model/counters";
import { assertScholarNoAvailable, parseScholarNo, possibleDuplicates, scholarForNewStudent, syncScholarCounter } from "./model/scholarNumbers";
import { renameLoginId } from "./model/accounts";
import { canonicalLoginId } from "./model/loginIds";
import { activeStudentRecordIds, enrolledInSection, enrolledStudents } from "./model/studentCounts";
import { enabledList, moduleStateOf } from "./model/modules";
import type { ModuleKey } from "./core/modules";
import { currentYear, parentContactsOf, placement, studentFields } from "./model/studentRecords";

const studentsQuery = moduleQuery("students");

const studentsMutation = moduleMutation("students");

/**
 * One student's profile (admin / teacher / student-portal views).
 *
 * Access is decided on the server by the same three tiers as every other
 * student-data function (requireStudentAccess): school-wide staff
 * (students:read:all), a teacher whose scope includes the student's CURRENT
 * section (students:read:assigned), or the student themself
 * (profile:read:own). Anyone else — including another school — gets
 * NOT_FOUND. The response lists explicit fields only (never spread documents):
 * parent-contact phone/email only for school-wide staff and the student, fee
 * details only for fee staff and the student. Returns null for a malformed id.
 * Core (always available); each section follows the school's module
 * entitlements: attendance → Attendance, results and homework → Academics,
 * fees → Finance. A disabled module's section is empty / null.
 */
export const getStudentProfile = schoolQuery({
  // A route parameter: validated here with normalizeId (an unknown or malformed id is "not found").
  args: { studentId: v.string() },
  handler: async (ctx, args) => {
    const studentId = ctx.db.normalizeId("students", args.studentId);
    if (!studentId) return null;
    const student = await requireStudentAccess(ctx, studentId, { all: "students:read:all", assigned: "students:read:assigned", own: "profile:read:own" });
    const schoolWide = hasPermission(ctx.actor, "students:read:all");
    const own = (await linkedStudentIds(ctx, ctx.actor)).includes(student._id);
    const year = await currentYear(ctx, ctx.actor.schoolId);
    const { enrollmentState, enrollment, row } = await placement(ctx, student, year);
    const activeSection = row && row.status === "active" ? await ctx.db.get(row.sectionId) : null;
    const modules = await moduleStateOf(ctx, ctx.actor.schoolId);
    const on = (k: ModuleKey) => modules.enabled.has(k);
    const attendance = maybeProvider("attendance.studentRecords");
    const results = maybeProvider("examinations.studentResults");
    const homework = maybeProvider("academics.studentHomework");
    const ledger = maybeProvider("fees.studentLedger");
    const canSeeFees = on("finance") && (hasPermission(ctx.actor, "fees:manage") || (own && hasPermission(ctx.actor, "fees:read:own")));
    return {
      access: schoolWide ? ("school" as const) : own ? ("own" as const) : ("assigned" as const),
      student: studentFields(student),
      academicYear: year ? { academicYearId: year._id, name: year.name } : null,
      enrollmentState,
      enrollment,
      parentContacts: await parentContactsOf(ctx, student, schoolWide || own),
      modules: enabledList(modules),
      // Module sections: present only when the module is shipped (provider) AND enabled for the school.
      attendance: on("attendance") && year && attendance ? await attendance.recordsInYear(ctx, student._id, year) : [],
      results: on("academics") && results ? await results.publishedResults(ctx, student) : [],
      homework: on("academics") && homework && activeSection && activeSection.schoolId === ctx.actor.schoolId ? await homework.homeworkFor(ctx, student, activeSection) : [],
      fees: canSeeFees && year && ledger ? await ledger.ledger(ctx, student, year) : null,
    };
  },
});

/** Students actively enrolled in a section (admin: any; teacher: own scope). */
export const sectionRoster = schoolQuery({
  args: { sectionId: v.id("sections") },
  handler: async (ctx, { sectionId }) => {
    const section = await requireSectionRead(ctx, sectionId, { all: "students:read:all", assigned: "students:read:assigned" });
    const roster = await activeRoster(ctx, section._id);
    return {
      section: { _id: section._id, displayName: section.displayName },
      students: roster.map(({ student, enrollment }) => ({ studentId: student._id, name: fullName(student), admissionNo: student.admissionNo, rollNo: enrollment.rollNo ?? null, gender: student.gender ?? null })),
    };
  },
});

/** Largest list of not-yet-enrolled students returned at once. */
export const MAX_UNENROLLED = 500;

/**
 * Active students with NO active enrollment in a year (default: current
 * year), in roster order, for the "enrol students" workflow. Bounded.
 */
export const listUnenrolledStudents = studentsQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    requirePermission(ctx.actor, "students:write");
    const yearId = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const students = await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "active")).take(5001);
    if (students.length > 5000) throw conflict("More than 5000 active students; this list needs pagination.");
    const out = [];
    for (const s of students) {
      const enr = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", s._id).eq("academicYearId", yearId)).collect();
      if (enr.some((e) => e.status === "active")) continue;
      out.push({ studentId: s._id, name: fullName(s), admissionNo: s.admissionNo, firstName: s.firstName, lastName: s.lastName });
    }
    out.sort((a, b) => compareRosterEntries({ enrollmentId: "", studentId: a.studentId, firstName: a.firstName, lastName: a.lastName }, { enrollmentId: "", studentId: b.studentId, firstName: b.firstName, lastName: b.lastName }));
    return { students: out.slice(0, MAX_UNENROLLED).map(({ firstName: _f, lastName: _l, ...r }) => r), truncated: out.length > MAX_UNENROLLED, total: out.length };
  },
});

/**
 * Place a student in a section for that section's academic year. A student has
 * at most one ACTIVE enrollment per year; moving sections closes the old one
 * (history is kept, never overwritten). Roll numbers are system-assigned: the
 * destination section — and, for a transfer, the source section — is
 * renumbered alphabetically in this same transaction (model/rollNumbers.ts).
 */
export const enrollStudent = studentsMutation({
  args: { studentId: v.id("students"), sectionId: v.id("sections"), startDate: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:write");
    assertIsoDate(a.startDate, "startDate");
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const section = await getInSchool(ctx, "sections", a.sectionId, "Section");
    const year = await getInSchool(ctx, "academicYears", section.academicYearId);
    if (a.startDate < year.startDate || a.startDate > year.endDate) throw invalidRelationship("The start date is outside the section's academic year.");
    const current = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", year._id)).collect();
    const active = current.find((e) => e.status === "active");
    if (active?.sectionId === section._id) throw conflict("The student is already enrolled in this section.");
    if (active) await ctx.db.patch(active._id, { status: "transferred", endDate: a.startDate });
    const id = await ctx.db.insert("enrollments", {
      schoolId: ctx.actor.schoolId, studentId: student._id, academicYearId: year._id, classId: section.classId, sectionId: section._id,
      status: "active", startDate: a.startDate,
    });
    await renumberSections(ctx, [section._id, ...(active ? [active.sectionId] : [])]);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: active ? "enrollment.transferred" : "enrollment.created", entity: { table: "enrollments", id },
      summary: `${fullName(student)} enrolled in ${section.displayName} (${year.name})`, metadata: { previousSectionId: active?.sectionId ?? null },
    });
    return id;
  },
});

/**
 * End a student's active enrollment (left the school, withdrawn, completed).
 * The enrollment is kept as history; the section is renumbered in the same
 * transaction so the remaining roster stays 1..n.
 */
export const endEnrollment = studentsMutation({
  args: {
    enrollmentId: v.id("enrollments"),
    status: v.union(v.literal("withdrawn"), v.literal("completed")),
    endDate: v.string(),
  },
  handler: async (ctx, { enrollmentId, status, endDate }) => {
    requirePermission(ctx.actor, "students:write");
    assertIsoDate(endDate, "endDate");
    const enrollment = await getInSchool(ctx, "enrollments", enrollmentId, "Enrollment");
    if (enrollment.status !== "active") throw conflict("This enrollment is not active.");
    if (endDate < enrollment.startDate) throw invalidRelationship("The end date is before the enrollment started.");
    await ctx.db.patch(enrollment._id, { status, endDate }); // its last roll number stays as history
    await renumberSections(ctx, [enrollment.sectionId]);
    const student = await ctx.db.get(enrollment.studentId);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "enrollment.ended", entity: { table: "enrollments", id: enrollment._id },
      summary: `${student ? fullName(student) : "Student"} left the section (${status})`, metadata: { sectionId: enrollment.sectionId, status },
    });
    return { ok: true as const };
  },
});

/**
 * Admit ONE student from the admin form: student record + current-year
 * enrollment + parent contact, in one transaction. It follows the same rules
 * as the spreadsheet import (convex/model/importers.ts):
 *  - the class and section must be real records of this school, the section
 *    must belong to that class and to the CURRENT academic year — anything
 *    else is rejected (never a silent fallback to another section);
 *  - the admission number comes from the school's atomic counter;
 *  - a parent contact is matched by phone number (siblings share one contact);
 *  - roll numbers are system-assigned: the whole section is renumbered
 *    alphabetically in this same transaction (model/rollNumbers.ts).
 * No sign-in account is created here — that stays in Accounts & Import
 * (Login ID + temporary password), so no credentials are generated or returned.
 */
export const createStudentWithEnrollment = studentsMutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    gender: v.optional(vGender),
    dateOfBirth: v.string(),
    admissionDate: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.string(),
    bloodGroup: v.optional(v.string()),
    classId: v.id("classes"),
    sectionId: v.id("sections"),
    /** The school's own register number (optional; unique in the school). */
    scholarNo: v.optional(v.string()),
    /**
     * Set after the office has checked that a student with the same name and
     * date of birth is a DIFFERENT person. Without it such an admission is
     * refused (CONFLICT) so the same child is not admitted twice. Audited.
     */
    confirmNotDuplicate: v.optional(v.boolean()),
    /** Parent contact (contact data only — no account is created). */
    parentContact: v.object({
      name: v.string(),
      relation: v.string(),
      phone: v.string(),
      email: v.optional(v.string()),
      occupation: v.optional(v.string()),
    }),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:write");
    assertIsoDate(a.admissionDate, "admissionDate");
    assertIsoDate(a.dateOfBirth, "dateOfBirth");
    if (a.dateOfBirth >= a.admissionDate) throw invalid("The date of birth must be before the admission date.", { dateOfBirth: "Must be before the admission date" });
    const firstName = assertNonEmpty(a.firstName, "firstName", 50);
    const lastName = assertNonEmpty(a.lastName, "lastName", 50);
    const address = assertNonEmpty(a.address, "address", 200);
    const contactName = assertNonEmpty(a.parentContact.name, "parentContact.name", 80);
    const contactRelation = assertNonEmpty(a.parentContact.relation, "parentContact.relation", 30);
    const contactPhone = normalizePhone(a.parentContact.phone, "parentContact.phone");
    const phone = a.phone?.trim() ? normalizePhone(a.phone, "phone") : undefined;
    const email = a.email?.trim() ? a.email.trim() : undefined;

    // Class ↔ section ↔ current academic year must agree. No fallbacks.
    const cls = await getInSchool(ctx, "classes", a.classId, "Class");
    const section = await getInSchool(ctx, "sections", a.sectionId, "Section");
    if (section.classId !== cls._id) throw mismatch(`Section ${section.displayName} does not belong to ${cls.name}.`, { sectionId: "Not a section of the selected class" });
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    if (section.academicYearId !== yearId) throw mismatch(`Section ${section.displayName} is not in the current academic year.`, { sectionId: "Not in the current academic year" });
    const year = (await ctx.db.get(yearId))!;
    if (a.admissionDate > year.endDate) throw mismatch("The admission date is after the current academic year.", { admissionDate: "After the current academic year" });

    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    // Scholar number: unique in the school, checked before anything is written.
    const scholar = parseScholarNo(a.scholarNo);
    if (scholar) await assertScholarNoAvailable(ctx, school._id, scholar.scholarNoKey);
    // The same child must not be admitted twice (same name + date of birth, any status).
    const duplicates = await possibleDuplicates(ctx, school._id, { firstName, lastName, dateOfBirth: a.dateOfBirth });
    if (duplicates.length && a.confirmNotDuplicate !== true) {
      throw new AppError("CONFLICT", `A student named ${firstName} ${lastName} with the same date of birth already exists (${duplicates.map((d) => d.scholarNo ? `scholar no. ${d.scholarNo}` : d.admissionNo).join(", ")}). Re-enrol that student instead, or confirm this is a different child.`, { duplicateOf: duplicates.map((d) => d._id).join(",") });
    }
    // The typed scholar number, or the school's next automatic one (model/scholarNumbers.ts).
    const scholarNo = await scholarForNewStudent(ctx, school._id, scholar);
    // The scholar number IS the student's identifier: no legacy <code>-<year>-NNNN number when there is one.
    const admissionNo = scholarNo?.scholarNo ?? await nextAdmissionNumber(ctx, school, a.admissionDate.slice(0, 4));
    const studentId = await ctx.db.insert("students", {
      schoolId: school._id, admissionNo, firstName, lastName, status: "active", admissionDate: a.admissionDate, dateOfBirth: a.dateOfBirth, address,
      ...(scholarNo ?? {}),
      ...(a.gender ? { gender: a.gender } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}),
      ...(a.bloodGroup?.trim() ? { bloodGroup: a.bloodGroup.trim() } : {}),
    });

    // Parent contact: reuse an existing contact with the same phone (siblings), as the import does.
    // Stored in the `guardians` / `guardianLinks` tables (contact data only).
    const existingContact = await ctx.db.query("guardians").withIndex("by_school_phone", (q) => q.eq("schoolId", school._id).eq("phone", contactPhone)).first();
    const contactId = existingContact?._id ?? await ctx.db.insert("guardians", {
      schoolId: school._id, name: contactName, phone: contactPhone, address,
      ...(a.parentContact.email?.trim() ? { email: a.parentContact.email.trim() } : {}),
      ...(a.parentContact.occupation?.trim() ? { occupation: a.parentContact.occupation.trim() } : {}),
    });
    await ctx.db.insert("guardianLinks", { schoolId: school._id, guardianId: contactId, studentId, relationship: contactRelation, isPrimary: true });

    const startDate = a.admissionDate < year.startDate ? year.startDate : a.admissionDate;
    const enrollmentId = await ctx.db.insert("enrollments", {
      schoolId: school._id, studentId, academicYearId: yearId, classId: cls._id, sectionId: section._id, status: "active", startDate,
    });
    await renumberSections(ctx, [section._id]);

    const classTeacher = section.classTeacherId ? await ctx.db.get(section.classTeacherId) : null;
    const warnings: string[] = [];
    if (existingContact && existingContact.name.trim().toLowerCase() !== contactName.toLowerCase()) {
      warnings.push(`Phone ${contactPhone} already belongs to parent contact ${existingContact.name}; the student was linked to them.`);
    }
    if (!classTeacher || classTeacher.schoolId !== school._id) {
      warnings.push(`Section ${section.displayName} has no class teacher yet — assign one in Academics so attendance can be marked.`);
    }
    await writeAudit(ctx, {
      schoolId: school._id, actor: ctx.actor, action: "student.admitted", entity: { table: "students", id: studentId },
      summary: `Admitted ${fullName({ firstName, lastName })} (${admissionNo}) to ${section.displayName} (${year.name})`,
      metadata: { enrollmentId, sectionId: section._id, parentContactReused: !!existingContact, ...(scholarNo ? { scholarNo: scholarNo.scholarNo, scholarNoAutomatic: !scholar } : {}), ...(duplicates.length ? { confirmedNotDuplicateOf: duplicates.map((d) => d.admissionNo) } : {}) },
    });
    const rollNo = (await ctx.db.get(enrollmentId))?.rollNo ?? null;
    return {
      studentId,
      admissionNo,
      scholarNo: scholarNo?.scholarNo ?? null,
      section: section.displayName,
      rollNo,
      classTeacher: classTeacher && classTeacher.schoolId === school._id ? teacherDisplayName(classTeacher) : null,
      warnings,
    };
  },
});

/** INVALID_RELATIONSHIP with a field hint for the form. */
const mismatch = (message: string, fields: Record<string, string>) => new AppError("INVALID_RELATIONSHIP", message, fields);

/** Phone numbers as the import stores them: digits with optional +, spaces, dashes, brackets; 7–15 digits. */
function normalizePhone(raw: string, field: string): string {
  const value = raw.trim();
  const digits = value.replace(/\D/g, "");
  if (!/^\+?[\d\s()-]+$/.test(value) || digits.length < 7 || digits.length > 15) throw invalid(`"${value}" is not a valid phone number.`, { [field]: "Enter a valid phone number" });
  return value.replace(/\s+/g, " ");
}

/**
 * Edit a student's own profile fields (admin `students:write`).
 *
 * Only personal/contact fields change here. Admission number, status,
 * enrollment/class/section, parent contacts, accounts, roles and credentials are NOT
 * editable through this function (enrollment changes use enrollStudent /
 * endEnrollment; accounts use Accounts & Import).
 *
 * A first/last-name change can move the student in the alphabetical roster, so
 * every section where the student is ACTIVELY enrolled is renumbered in this
 * same transaction (model/rollNumbers.ts) — the same rule as admissions,
 * transfers and withdrawals. Other students' numbers change only as far as the
 * alphabetical order requires; historical enrollments are untouched.
 */
export const updateStudentProfile = studentsMutation({
  args: {
    studentId: v.id("students"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    gender: v.optional(vGender),
    dateOfBirth: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    bloodGroup: v.optional(v.string()),
    /** "" clears the scholar number; any other value must be unique in the school. */
    scholarNo: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:write");
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const patch: Partial<Doc<"students">> = {};
    if (a.scholarNo !== undefined) {
      const scholar = parseScholarNo(a.scholarNo);
      if (scholar) {
        await assertScholarNoAvailable(ctx, ctx.actor.schoolId, scholar.scholarNoKey, student._id);
        await syncScholarCounter(ctx, ctx.actor.schoolId, scholar.scholarNoKey);
      }
      // A student with a sign-in account signs in with the scholar number: keep the Login ID in step.
      const account = (await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect())
        .find((m) => m.schoolId === ctx.actor.schoolId && m.role === "student");
      if (account && scholar?.scholarNoKey !== student.scholarNoKey) {
        if (!scholar) throw invalid("This student signs in with their scholar number, so it cannot be removed.", { scholarNo: "Required: used to sign in" });
        const login = canonicalLoginId(scholar.scholarNoKey);
        if (!login) throw invalid("This scholar number cannot be used to sign in (letters, digits, . _ - only).", { scholarNo: "Not usable as a Login ID" });
        await renameLoginId(ctx, account, login);
      }
      patch.scholarNo = scholar?.scholarNo;
      patch.scholarNoKey = scholar?.scholarNoKey;
    }
    if (a.firstName !== undefined) patch.firstName = assertNonEmpty(a.firstName, "firstName", 80);
    if (a.lastName !== undefined) patch.lastName = assertNonEmpty(a.lastName, "lastName", 80);
    if (a.gender !== undefined) patch.gender = a.gender;
    if (a.dateOfBirth !== undefined) {
      if (a.dateOfBirth.trim() === "") patch.dateOfBirth = undefined;
      else {
        assertIsoDate(a.dateOfBirth, "dateOfBirth");
        const school = (await ctx.db.get(ctx.actor.schoolId))!;
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
        if (a.dateOfBirth >= today) throw invalid("Date of birth must be in the past.", { dateOfBirth: "Not in the past" });
        patch.dateOfBirth = a.dateOfBirth;
      }
    }
    if (a.email !== undefined) {
      const e = a.email.trim().toLowerCase();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw invalid("Enter a valid email address", { email: "Invalid email" });
      patch.email = e || undefined;
    }
    if (a.phone !== undefined) patch.phone = a.phone.trim() ? normalizePhone(a.phone, "phone") : undefined;
    if (a.address !== undefined) patch.address = a.address.trim() ? assertNonEmpty(a.address, "address", 200) : undefined;
    if (a.bloodGroup !== undefined) {
      const bg = a.bloodGroup.trim().toUpperCase();
      if (bg && !/^(A|B|AB|O)[+-]$/.test(bg)) throw invalid("Blood group must look like A+, O- or AB+.", { bloodGroup: "Invalid" });
      patch.bloodGroup = bg || undefined;
    }
    const changed = (Object.keys(patch) as (keyof Doc<"students">)[]).filter((k) => patch[k] !== student[k]);
    if (changed.length === 0) return { changed: [], renumberedSections: 0 };
    await ctx.db.patch(student._id, patch);

    const nameChanged = changed.includes("firstName") || changed.includes("lastName");
    let renumbered: Id<"sections">[] = [];
    if (nameChanged) {
      // Every ACTIVE enrollment of the student (normally one, in the current year).
      const years = await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", student._id)).collect();
      renumbered = years.filter((e) => e.schoolId === ctx.actor.schoolId && e.status === "active").map((e) => e.sectionId);
      await renumberSections(ctx, renumbered);
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "student.updated", entity: { table: "students", id: student._id },
      summary: `Updated ${fullName({ firstName: patch.firstName ?? student.firstName, lastName: patch.lastName ?? student.lastName })} (${student.admissionNo})`,
      metadata: { fields: changed, renumberedSections: renumbered.length },
    });
    return { changed, renumberedSections: renumbered.length };
  },
});

/**
 * A student's enrollment history across academic years (newest first): class,
 * section, status, dates and the last roll number. Administrators
 * (students:read:all) and the student themself (profile:read:own).
 */
export const enrollmentHistory = studentsQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const student = await requireStudentAccess(ctx, studentId, { all: "students:read:all", own: "profile:read:own" });
    const years = await ctx.db.query("academicYears").withIndex("by_school_start", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    const out = [];
    for (const y of years) {
      for (const e of await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", y._id)).collect()) {
        if (e.schoolId !== ctx.actor.schoolId) continue;
        const [klass, section] = [await ctx.db.get(e.classId), await ctx.db.get(e.sectionId)];
        out.push({
          enrollmentId: e._id, academicYear: y.name, yearStart: y.startDate, className: klass?.name ?? "", section: section?.displayName ?? "",
          status: e.status, startDate: e.startDate, endDate: e.endDate ?? null, rollNo: e.rollNo ?? null,
        });
      }
    }
    return out.sort((a, b) => b.yearStart.localeCompare(a.yearStart) || b.startDate.localeCompare(a.startDate) || (a.status === "active" ? -1 : 1));
  },
});

/**
 * Every roll number a student has been given (newest first, at most 200):
 * section, year, from → to and why. Complements `enrollmentHistory`, which
 * shows only each enrollment's last number. Same access rule.
 */
export const rollNumberHistory = studentsQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const student = await requireStudentAccess(ctx, studentId, { all: "students:read:all", own: "profile:read:own" });
    const rows = await ctx.db.query("rollNumberHistory").withIndex("by_school_student", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("studentId", student._id)).order("desc").take(200);
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"sections"> | Id<"academicYears">) => {
      if (!names.has(id)) {
        const doc = await ctx.db.get(id);
        names.set(id, doc ? ("displayName" in doc ? doc.displayName : doc.name) : "");
      }
      return names.get(id)!;
    };
    const out = [];
    for (const r of rows) {
      out.push({
        enrollmentId: r.enrollmentId, academicYear: await nameOf(r.academicYearId), section: await nameOf(r.sectionId),
        fromRollNo: r.fromRollNo ?? null, toRollNo: r.toRollNo, changedAt: r.changedAt, reason: r.reason,
      });
    }
    return out;
  },
});

/**
 * Student totals for the Students page (students:read:all), using THE shared
 * counting rule (model/studentCounts.ts) — the same number as the admin
 * dashboard. Independent of the list's pagination and search, so loading more
 * rows or searching never changes the overall total. Optional `sectionId` adds
 * that section's enrolled count. Reactive: admitting, enrolling, transferring
 * or withdrawing a student updates it immediately.
 */
export const studentCounts = studentsQuery({
  args: { sectionId: v.optional(v.id("sections")) },
  handler: async (ctx, { sectionId }) => {
    requirePermission(ctx.actor, "students:read:all");
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const year = (await ctx.db.get(yearId))!;
    const active = await activeStudentRecordIds(ctx, ctx.actor.schoolId);
    const enrolled = await enrolledStudents(ctx, ctx.actor.schoolId, yearId, active);
    let notEnrolled = 0;
    for (const id of active) if (!enrolled.has(id)) notEnrolled++;
    let section: { sectionId: Id<"sections">; label: string; enrolled: number } | null = null;
    if (sectionId) {
      const s = await getInSchool(ctx, "sections", sectionId, "Section");
      section = { sectionId: s._id, label: s.displayName, enrolled: enrolledInSection(enrolled, s._id) };
    }
    return { academicYear: { academicYearId: year._id, name: year.name }, enrolled: enrolled.size, activeRecords: active.size, notEnrolled, section };
  },
});

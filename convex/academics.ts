/**
 * Academic structure: academic years, classes (grade levels), sections,
 * subjects, enrollments and teacher assignments.
 *
 *   AcademicYear (2026-27)
 *     └─ Class (Grade 8) ── Section (8-A, year-specific, classTeacherId)
 *                               ├─ Enrollment (student × year × section, history preserved)
 *                               └─ TeacherAssignment (teacher × subject × section × year)
 *
 * SUBJECT ASSIGNMENT != ATTENDANCE OWNERSHIP. Attendance ownership is only
 * `sections.classTeacherId`, changed via `setClassTeacher`.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import {
  getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, linkedStudentIds, requirePermission,
  requireSectionRead, requireStudentAccess, teacherSectionIds, enrollmentFor,
} from "./core/authorization";
import { AppError, conflict, invalid, invalidRelationship } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vAcademicYearStatus, vGender } from "./core/validators";
import { activeRoster, fullName, teacherDisplayName } from "./model/academics";
import { writeAudit } from "./model/audit";
import { compareRosterEntries, renumberSections } from "./model/rollNumbers";
import { notifyUsers } from "./model/notifications";
import { nextAdmissionNumber } from "./model/counters";
import { attendanceRecords, currentYear, feeLedger, guardiansOf, homeworkFor, placement, publishedResults, studentFields } from "./model/studentRecords";

const byLabel = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true });

// ================================================================ reads

/**
 * One student's profile (admin / teacher / student-portal views).
 *
 * Access is decided on the server by the same three tiers as every other
 * student-data function (requireStudentAccess): school-wide staff
 * (students:read:all), a teacher whose scope includes the student's CURRENT
 * section (students:read:assigned), or the student themself / a linked
 * guardian (profile:read:own). Anyone else — including another school — gets
 * NOT_FOUND. The response lists explicit fields only (never spread documents):
 * guardian contact details only for school-wide staff and the family, fee
 * details only for fee staff and the family. Returns null for a malformed id.
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
    const canSeeFees = hasPermission(ctx.actor, "fees:manage") || (own && hasPermission(ctx.actor, "fees:read:own"));
    return {
      access: schoolWide ? ("school" as const) : own ? ("own" as const) : ("assigned" as const),
      student: studentFields(student),
      academicYear: year ? { academicYearId: year._id, name: year.name } : null,
      enrollmentState,
      enrollment,
      guardians: await guardiansOf(ctx, student, schoolWide || own),
      attendance: year ? await attendanceRecords(ctx, student._id, year) : [],
      results: await publishedResults(ctx, student),
      homework: activeSection && activeSection.schoolId === ctx.actor.schoolId ? await homeworkFor(ctx, student, activeSection) : [],
      fees: canSeeFees && year ? await feeLedger(ctx, student, year) : null,
    };
  },
});

export const listAcademicYears = schoolQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    const years = await ctx.db.query("academicYears").withIndex("by_school_start", (q) => q.eq("schoolId", ctx.actor.schoolId)).order("desc").collect();
    return years.map((y) => ({ ...y, isCurrent: y._id === settings.currentAcademicYearId }));
  },
});

export const listClasses = schoolQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("classes").withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect(),
});

export const listSubjects = schoolQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect(),
});

/**
 * Sections visible to the caller in a year (default: current year):
 * admins → all; teachers → sections they teach or own; student portal → linked students' sections.
 */
export const listSections = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const yearId = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    let sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    if (!hasPermission(ctx.actor, "academics:manage") && !hasPermission(ctx.actor, "students:read:all")) {
      let allowed = new Set<Id<"sections">>();
      if (ctx.actor.teacherId) allowed = await teacherSectionIds(ctx, ctx.actor.teacherId, yearId);
      for (const studentId of await linkedStudentIds(ctx, ctx.actor)) {
        const e = await enrollmentFor(ctx, studentId, yearId);
        if (e) allowed.add(e.sectionId);
      }
      sections = sections.filter((s) => allowed.has(s._id));
    }
    const result = [];
    for (const s of sections.sort(byLabel)) {
      const ct = s.classTeacherId ? await ctx.db.get(s.classTeacherId) : null;
      result.push({ ...s, classTeacherName: ct ? teacherDisplayName(ct) : null, isClassTeacher: !!ctx.actor.teacherId && s.classTeacherId === ctx.actor.teacherId });
    }
    return result;
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

/** Teacher assignments for a section (admin or teachers of that section). */
export const listTeacherAssignments = schoolQuery({
  args: { sectionId: v.id("sections") },
  handler: async (ctx, { sectionId }) => {
    const section = await requireSectionRead(ctx, sectionId, { all: "students:read:all", assigned: "students:read:assigned" });
    const rows = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", section._id)).collect();
    const out = [];
    for (const a of rows) {
      const [t, s] = [await ctx.db.get(a.teacherId), await ctx.db.get(a.subjectId)];
      out.push({ _id: a._id, teacherId: a.teacherId, teacherName: t ? teacherDisplayName(t) : null, subjectId: a.subjectId, subjectName: s?.name ?? null });
    }
    return out;
  },
});

/** What the calling teacher teaches this year, and which section (if any) they own. */
export const myTeaching = schoolQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.actor.teacherId) return { assignments: [], classTeacherOf: [] };
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const teacherId = ctx.actor.teacherId;
    const assignments = await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", teacherId).eq("academicYearId", yearId)).collect();
    const owned = await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacherId).eq("academicYearId", yearId)).collect();
    const out = [];
    for (const a of assignments) {
      const [sec, sub] = [await ctx.db.get(a.sectionId), await ctx.db.get(a.subjectId)];
      out.push({ _id: a._id, sectionId: a.sectionId, sectionName: sec?.displayName ?? "", subjectId: a.subjectId, subjectName: sub?.name ?? "" });
    }
    return { assignments: out.sort((x, y) => x.sectionName.localeCompare(y.sectionName, undefined, { numeric: true })), classTeacherOf: owned.map((s) => ({ sectionId: s._id, displayName: s.displayName })) };
  },
});

// ================================================================ writes (academics:manage)
export const createAcademicYear = schoolMutation({
  args: { name: v.string(), startDate: v.string(), endDate: v.string(), status: vAcademicYearStatus, makeCurrent: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const name = assertNonEmpty(a.name, "name", 20);
    assertIsoDate(a.startDate, "startDate");
    assertIsoDate(a.endDate, "endDate");
    if (a.startDate >= a.endDate) throw invalid("The academic year must end after it starts.");
    const existing = await ctx.db.query("academicYears").withIndex("by_school_start", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    if (existing.some((y) => y.name === name)) throw conflict(`Academic year ${name} already exists.`);
    if (existing.some((y) => a.startDate <= y.endDate && a.endDate >= y.startDate)) throw conflict("Academic years cannot overlap.");
    const id = await ctx.db.insert("academicYears", { schoolId: ctx.actor.schoolId, name, startDate: a.startDate, endDate: a.endDate, status: a.status });
    if (a.makeCurrent) {
      const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
      await ctx.db.patch(settings._id, { currentAcademicYearId: id });
    }
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "academic_year.created", entity: { table: "academicYears", id }, summary: `Created academic year ${name}` });
    return id;
  },
});

/**
 * Make an academic year the school's CURRENT year (the year attendance,
 * admissions, fees and the portals use by default). A closed year cannot be
 * made current; a planned year becomes active. The previous current year's
 * status is left unchanged (closing a year is a separate decision).
 */
export const setCurrentAcademicYear = schoolMutation({
  args: { academicYearId: v.id("academicYears") },
  handler: async (ctx, { academicYearId }) => {
    requirePermission(ctx.actor, "academics:manage");
    const year = await getInSchool(ctx, "academicYears", academicYearId, "Academic year");
    if (year.status === "closed") throw conflict(`${year.name} is closed and cannot be made the current year.`);
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    if (settings.currentAcademicYearId === year._id) return { ok: true, changed: false };
    const previous = settings.currentAcademicYearId ?? null;
    await ctx.db.patch(settings._id, { currentAcademicYearId: year._id });
    if (year.status === "planned") await ctx.db.patch(year._id, { status: "active" });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "academic_year.made_current", entity: { table: "academicYears", id: year._id },
      summary: `${year.name} is now the current academic year`, metadata: { previousAcademicYearId: previous },
    });
    return { ok: true, changed: true };
  },
});

/** Active teachers for assignment pickers (academics managers only). */
export const listTeachers = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "academics:manage");
    const rows = await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "active")).take(2000);
    return rows.map((t) => ({ teacherId: t._id, name: teacherDisplayName(t), employeeId: t.employeeId })).sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Largest list of not-yet-enrolled students returned at once. */
export const MAX_UNENROLLED = 500;

/**
 * Active students with NO active enrollment in a year (default: current
 * year), in roster order, for the "enrol students" workflow. Bounded.
 */
export const listUnenrolledStudents = schoolQuery({
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

export const createClass = schoolMutation({
  args: { name: v.string(), level: v.number() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const name = assertNonEmpty(a.name, "name", 40);
    if (!Number.isInteger(a.level) || a.level < 0 || a.level > 20) throw invalid("level must be a whole number 0–20", { level: "Invalid" });
    const dup = await ctx.db.query("classes").withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("level", a.level)).first();
    if (dup) throw conflict(`A class with level ${a.level} already exists.`);
    const id = await ctx.db.insert("classes", { schoolId: ctx.actor.schoolId, name, level: a.level, active: true });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "class.created", entity: { table: "classes", id }, summary: `Created class ${name}` });
    return id;
  },
});

export const createSubject = schoolMutation({
  args: { name: v.string(), code: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const name = assertNonEmpty(a.name, "name", 60);
    const code = assertNonEmpty(a.code, "code", 12).toUpperCase();
    const dup = await ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("code", code)).first();
    if (dup) throw conflict(`Subject code ${code} is already used.`);
    const id = await ctx.db.insert("subjects", { schoolId: ctx.actor.schoolId, name, code, active: true });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "subject.created", entity: { table: "subjects", id }, summary: `Created subject ${name}` });
    return id;
  },
});

export const createSection = schoolMutation({
  args: { academicYearId: v.id("academicYears"), classId: v.id("classes"), name: v.string(), room: v.optional(v.string()), capacity: v.optional(v.number()) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const year = await getInSchool(ctx, "academicYears", a.academicYearId);
    const cls = await getInSchool(ctx, "classes", a.classId, "Class");
    const name = assertNonEmpty(a.name, "name", 10).toUpperCase();
    const siblings = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", cls._id).eq("academicYearId", year._id)).collect();
    if (siblings.some((s) => s.name === name)) throw conflict(`Section ${cls.level}-${name} already exists in ${year.name}.`);
    const id = await ctx.db.insert("sections", {
      schoolId: ctx.actor.schoolId, academicYearId: year._id, classId: cls._id, name, displayName: `${cls.level}-${name}`,
      ...(a.room ? { room: a.room } : {}), ...(a.capacity ? { capacity: a.capacity } : {}),
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "section.created", entity: { table: "sections", id }, summary: `Created section ${cls.level}-${name} (${year.name})` });
    return id;
  },
});

/**
 * Make a teacher the class teacher (attendance owner) of a section, or clear it.
 * A teacher can own at most one section per academic year.
 */
export const setClassTeacher = schoolMutation({
  args: { sectionId: v.id("sections"), teacherId: v.union(v.id("teachers"), v.null()) },
  handler: async (ctx, { sectionId, teacherId }) => {
    requirePermission(ctx.actor, "academics:manage");
    const section = await getInSchool(ctx, "sections", sectionId, "Section");
    let teacher: Doc<"teachers"> | null = null;
    if (teacherId) {
      teacher = await getInSchool(ctx, "teachers", teacherId, "Teacher");
      if (teacher.status !== "active") throw invalidRelationship("Only active teachers can be class teachers.");
      const owned = await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacher!._id).eq("academicYearId", section.academicYearId)).collect();
      const other = owned.find((s) => s._id !== section._id);
      if (other) throw conflict(`${teacherDisplayName(teacher)} is already class teacher of ${other.displayName}.`);
    }
    const previous = section.classTeacherId ?? null;
    await ctx.db.patch(section._id, { classTeacherId: teacherId ?? undefined });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "section.class_teacher_changed",
      entity: { table: "sections", id: section._id },
      summary: `Class teacher of ${section.displayName} set to ${teacher ? teacherDisplayName(teacher) : "nobody"}`,
      metadata: { from: previous, to: teacherId },
    });
    if (teacher) {
      const m = await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", teacher!._id)).collect();
      await notifyUsers(ctx, ctx.actor.schoolId, m.filter((x) => x.status === "active" && x.userId).map((x) => x.userId!), {
        type: "general", title: `You are now class teacher of ${section.displayName}`, message: "You can mark and correct this section's attendance.", href: "/teacher/attendance",
      });
    }
    return { ok: true };
  },
});

/** Assign (or reassign) the teacher for a subject in a section. One teacher per subject per section. */
export const assignSubjectTeacher = schoolMutation({
  args: { sectionId: v.id("sections"), subjectId: v.id("subjects"), teacherId: v.id("teachers"), periodsPerWeek: v.optional(v.number()) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const section = await getInSchool(ctx, "sections", a.sectionId, "Section");
    const subject = await getInSchool(ctx, "subjects", a.subjectId, "Subject");
    const teacher = await getInSchool(ctx, "teachers", a.teacherId, "Teacher");
    if (teacher.status !== "active") throw invalidRelationship("Only active teachers can be assigned.");
    if (!(await isInCurriculum(ctx, section.classId, section.academicYearId, subject._id))) {
      throw invalidRelationship(`${subject.name} is not in the curriculum of ${section.displayName}'s class for this academic year.`);
    }
    const existing = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", section._id).eq("subjectId", subject._id)).unique();
    let id: Id<"teacherAssignments">;
    if (existing) {
      await ctx.db.patch(existing._id, { teacherId: teacher._id, ...(a.periodsPerWeek !== undefined ? { periodsPerWeek: a.periodsPerWeek } : {}) });
      id = existing._id;
    } else {
      id = await ctx.db.insert("teacherAssignments", {
        schoolId: ctx.actor.schoolId, academicYearId: section.academicYearId, teacherId: teacher._id, subjectId: subject._id, classId: section.classId, sectionId: section._id,
        ...(a.periodsPerWeek !== undefined ? { periodsPerWeek: a.periodsPerWeek } : {}),
      });
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "teacher_assignment.set", entity: { table: "teacherAssignments", id },
      summary: `${subject.name} in ${section.displayName} → ${teacherDisplayName(teacher)}`, metadata: { previousTeacherId: existing?.teacherId ?? null },
    });
    return id;
  },
});

// ================================================================ curriculum (class ↔ subject per year)
const MAX_SUBJECTS_PER_CLASS = 40;

async function isInCurriculum(ctx: QueryCtx, classId: Id<"classes">, academicYearId: Id<"academicYears">, subjectId: Id<"subjects">) {
  const row = await ctx.db
    .query("classSubjects")
    .withIndex("by_class_year_subject", (q) => q.eq("classId", classId).eq("academicYearId", academicYearId).eq("subjectId", subjectId))
    .unique();
  return row !== null;
}

async function resolveYearId(ctx: Parameters<typeof getInSchool>[0], academicYearId: Id<"academicYears"> | undefined) {
  return academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId, "Academic year"))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
}

/** Subjects a class studies in a year (default: current year). Curriculum is not sensitive: any member may read it. */
export const listClassSubjects = schoolQuery({
  args: { classId: v.id("classes"), academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { classId, academicYearId }) => {
    const cls = await getInSchool(ctx, "classes", classId, "Class");
    const yearId = await resolveYearId(ctx, academicYearId);
    const rows = await ctx.db
      .query("classSubjects")
      .withIndex("by_class_year_subject", (q) => q.eq("classId", cls._id).eq("academicYearId", yearId))
      .take(MAX_SUBJECTS_PER_CLASS);
    const out = [];
    for (const r of rows) {
      const subject = await ctx.db.get(r.subjectId);
      if (subject && subject.schoolId === ctx.actor.schoolId) out.push({ subjectId: subject._id, name: subject.name, code: subject.code });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  },
});

/**
 * Replace a class's curriculum for a year. Removing a subject that still has
 * subject-teacher assignments in that class's sections is rejected — remove
 * the assignments first, so no orphaned assignment is left behind.
 */
export const setClassSubjects = schoolMutation({
  args: { classId: v.id("classes"), academicYearId: v.id("academicYears"), subjectIds: v.array(v.id("subjects")) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const cls = await getInSchool(ctx, "classes", a.classId, "Class");
    const year = await getInSchool(ctx, "academicYears", a.academicYearId, "Academic year");
    const wanted = [...new Set(a.subjectIds)];
    if (wanted.length > MAX_SUBJECTS_PER_CLASS) throw invalid(`A class can have at most ${MAX_SUBJECTS_PER_CLASS} subjects.`, { subjectIds: "Too many" });
    for (const id of wanted) {
      const subject = await getInSchool(ctx, "subjects", id, "Subject");
      if (!subject.active) throw invalidRelationship(`${subject.name} is inactive.`);
    }
    const current = await ctx.db
      .query("classSubjects")
      .withIndex("by_class_year_subject", (q) => q.eq("classId", cls._id).eq("academicYearId", year._id))
      .take(MAX_SUBJECTS_PER_CLASS + 1);
    const currentIds = new Set(current.map((r) => r.subjectId));
    const added = wanted.filter((id) => !currentIds.has(id));
    const removed = current.filter((r) => !wanted.includes(r.subjectId));

    if (removed.length) {
      const sections = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", cls._id).eq("academicYearId", year._id)).collect();
      for (const r of removed) {
        for (const section of sections) {
          const assigned = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", section._id).eq("subjectId", r.subjectId)).first();
          if (assigned) {
            const subject = await ctx.db.get(r.subjectId);
            throw invalidRelationship(`${subject?.name ?? "A subject"} still has a teacher assigned in ${section.displayName}. Remove the assignment first.`);
          }
        }
      }
    }
    for (const r of removed) await ctx.db.delete(r._id);
    for (const subjectId of added) {
      await ctx.db.insert("classSubjects", { schoolId: ctx.actor.schoolId, academicYearId: year._id, classId: cls._id, subjectId });
    }
    if (added.length || removed.length) {
      await writeAudit(ctx, {
        schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "curriculum.updated", entity: { table: "classes", id: cls._id },
        summary: `Updated ${cls.name} curriculum for ${year.name} (+${added.length} / −${removed.length})`,
        metadata: { academicYearId: year._id, added, removed: removed.map((r) => r.subjectId) },
      });
    }
    return { added: added.length, removed: removed.length };
  },
});

export const removeTeacherAssignment = schoolMutation({
  args: { assignmentId: v.id("teacherAssignments") },
  handler: async (ctx, { assignmentId }) => {
    requirePermission(ctx.actor, "academics:manage");
    const a = await getInSchool(ctx, "teacherAssignments", assignmentId, "Assignment");
    await ctx.db.delete(a._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "teacher_assignment.removed", entity: { table: "teacherAssignments", id: a._id }, summary: "Removed a teacher assignment", metadata: { teacherId: a.teacherId, subjectId: a.subjectId, sectionId: a.sectionId } });
    return { ok: true };
  },
});

/**
 * Place a student in a section for that section's academic year. A student has
 * at most one ACTIVE enrollment per year; moving sections closes the old one
 * (history is kept, never overwritten). Roll numbers are system-assigned: the
 * destination section — and, for a transfer, the source section — is
 * renumbered alphabetically in this same transaction (model/rollNumbers.ts).
 */
export const enrollStudent = schoolMutation({
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
export const endEnrollment = schoolMutation({
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
 * enrollment + guardian link, in one transaction. It follows the same rules
 * as the spreadsheet import (convex/model/importers.ts):
 *  - the class and section must be real records of this school, the section
 *    must belong to that class and to the CURRENT academic year — anything
 *    else is rejected (never a silent fallback to another section);
 *  - the admission number comes from the school's atomic counter;
 *  - a guardian is matched by phone number (siblings share one guardian);
 *  - roll numbers are system-assigned: the whole section is renumbered
 *    alphabetically in this same transaction (model/rollNumbers.ts).
 * No sign-in account is created here — that stays in Accounts & Import
 * (Login ID + temporary password), so no credentials are generated or returned.
 */
export const createStudentWithEnrollment = schoolMutation({
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
    guardian: v.object({
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
    const guardianName = assertNonEmpty(a.guardian.name, "guardian.name", 80);
    const guardianRelation = assertNonEmpty(a.guardian.relation, "guardian.relation", 30);
    const guardianPhone = normalizePhone(a.guardian.phone, "guardian.phone");
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
    const admissionNo = await nextAdmissionNumber(ctx, school, a.admissionDate.slice(0, 4));
    const studentId = await ctx.db.insert("students", {
      schoolId: school._id, admissionNo, firstName, lastName, status: "active", admissionDate: a.admissionDate, dateOfBirth: a.dateOfBirth, address,
      ...(a.gender ? { gender: a.gender } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}),
      ...(a.bloodGroup?.trim() ? { bloodGroup: a.bloodGroup.trim() } : {}),
    });

    // Guardian: reuse an existing guardian with the same phone (siblings), as the import does.
    const existingGuardian = await ctx.db.query("guardians").withIndex("by_school_phone", (q) => q.eq("schoolId", school._id).eq("phone", guardianPhone)).first();
    const guardianId = existingGuardian?._id ?? await ctx.db.insert("guardians", {
      schoolId: school._id, name: guardianName, phone: guardianPhone, address,
      ...(a.guardian.email?.trim() ? { email: a.guardian.email.trim() } : {}),
      ...(a.guardian.occupation?.trim() ? { occupation: a.guardian.occupation.trim() } : {}),
    });
    await ctx.db.insert("guardianLinks", { schoolId: school._id, guardianId, studentId, relationship: guardianRelation, isPrimary: true });

    const startDate = a.admissionDate < year.startDate ? year.startDate : a.admissionDate;
    const enrollmentId = await ctx.db.insert("enrollments", {
      schoolId: school._id, studentId, academicYearId: yearId, classId: cls._id, sectionId: section._id, status: "active", startDate,
    });
    await renumberSections(ctx, [section._id]);

    const classTeacher = section.classTeacherId ? await ctx.db.get(section.classTeacherId) : null;
    const warnings: string[] = [];
    if (existingGuardian && existingGuardian.name.trim().toLowerCase() !== guardianName.toLowerCase()) {
      warnings.push(`Phone ${guardianPhone} already belongs to guardian ${existingGuardian.name}; the student was linked to them.`);
    }
    if (!classTeacher || classTeacher.schoolId !== school._id) {
      warnings.push(`Section ${section.displayName} has no class teacher yet — assign one in Academics so attendance can be marked.`);
    }
    await writeAudit(ctx, {
      schoolId: school._id, actor: ctx.actor, action: "student.admitted", entity: { table: "students", id: studentId },
      summary: `Admitted ${fullName({ firstName, lastName })} (${admissionNo}) to ${section.displayName} (${year.name})`,
      metadata: { enrollmentId, sectionId: section._id, guardianReused: !!existingGuardian },
    });
    const rollNo = (await ctx.db.get(enrollmentId))?.rollNo ?? null;
    return {
      studentId,
      admissionNo,
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
 * enrollment/class/section, guardians, accounts, roles and credentials are NOT
 * editable through this function (enrollment changes use enrollStudent /
 * endEnrollment; accounts use Accounts & Import).
 *
 * A first/last-name change can move the student in the alphabetical roster, so
 * every section where the student is ACTIVELY enrolled is renumbered in this
 * same transaction (model/rollNumbers.ts) — the same rule as admissions,
 * transfers and withdrawals. Other students' numbers change only as far as the
 * alphabetical order requires; historical enrollments are untouched.
 */
export const updateStudentProfile = schoolMutation({
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
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "students:write");
    const student = await getInSchool(ctx, "students", a.studentId, "Student");
    const patch: Partial<Doc<"students">> = {};
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
 * (students:read:all) and the student / linked guardians (profile:read:own).
 */
export const enrollmentHistory = schoolQuery({
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

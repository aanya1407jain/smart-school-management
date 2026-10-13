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
import { schoolMutation, schoolQuery } from "./core/functions";
import {
  getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, linkedStudentIds, requirePermission,
  requireSectionRead, teacherSectionIds, enrollmentFor,
} from "./core/authorization";
import { conflict, invalid, invalidRelationship } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vAcademicYearStatus } from "./core/validators";
import { activeRoster, fullName, teacherDisplayName } from "./model/academics";
import { writeAudit } from "./model/audit";
import { notifyUsers } from "./model/notifications";

const byLabel = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true });

// ================================================================ reads
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
 * (history is kept, never overwritten).
 */
export const enrollStudent = schoolMutation({
  args: { studentId: v.id("students"), sectionId: v.id("sections"), rollNo: v.optional(v.number()), startDate: v.string() },
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
      status: "active", startDate: a.startDate, ...(a.rollNo !== undefined ? { rollNo: a.rollNo } : {}),
    });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: active ? "enrollment.transferred" : "enrollment.created", entity: { table: "enrollments", id },
      summary: `${fullName(student)} enrolled in ${section.displayName} (${year.name})`, metadata: { previousSectionId: active?.sectionId ?? null },
    });
    return id;
  },
});
/**
 * Create a student, auto-generate server-side admission number, link guardian,
 * and enroll them in a section for the active academic year.
 */
export const createStudentWithEnrollment = schoolMutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"), v.literal("other"))),
    dateOfBirth: v.string(),
    admissionDate: v.string(),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("transferred"), v.literal("alumni")),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.string(),
    bloodGroup: v.optional(v.string()),
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

    const school = await ctx.db.get(ctx.actor.schoolId);
    const schoolCode = school?.code ?? "SCH";

    // 1. Server-side Admission Number Generation
    const existing = await ctx.db
      .query("students")
      .withIndex("by_school_admission", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();
    const nextSeq = existing.length + 1;
    const yearPrefix = new Date(a.admissionDate).getFullYear();
    const admissionNo = `${schoolCode}-${yearPrefix}-${String(nextSeq).padStart(4, "0")}`;

    // 2. Insert Student
    const studentId = await ctx.db.insert("students", {
      schoolId: ctx.actor.schoolId,
      admissionNo,
      firstName: assertNonEmpty(a.firstName, "firstName", 50),
      lastName: assertNonEmpty(a.lastName, "lastName", 50),
      gender: a.gender,
      dateOfBirth: a.dateOfBirth,
      admissionDate: a.admissionDate,
      status: a.status,
      email: a.email && a.email.trim().length > 0 ? a.email.trim() : undefined,
      phone: a.phone && a.phone.trim().length > 0 ? a.phone.trim() : undefined,
      address: assertNonEmpty(a.address, "address", 200),
      bloodGroup: a.bloodGroup,
    });

    // 3. Insert Guardian & Link
    const guardianId = await ctx.db.insert("guardians", {
      schoolId: ctx.actor.schoolId,
      name: assertNonEmpty(a.guardian.name, "guardian.name", 80),
      phone: assertNonEmpty(a.guardian.phone, "guardian.phone", 20),
      email: a.guardian.email && a.guardian.email.trim().length > 0 ? a.guardian.email.trim() : undefined,
      occupation: a.guardian.occupation,
      address: a.address,
    });

    await ctx.db.insert("guardianLinks", {
      schoolId: ctx.actor.schoolId,
      guardianId,
      studentId,
      relationship: a.guardian.relation,
      isPrimary: true,
    });

    // 4. Enroll Student in Section
    const section = await getInSchool(ctx, "sections", a.sectionId, "Section");
    const year = await getInSchool(ctx, "academicYears", section.academicYearId);
    
    await ctx.db.insert("enrollments", {
      schoolId: ctx.actor.schoolId,
      studentId,
      academicYearId: year._id,
      classId: section.classId,
      sectionId: section._id,
      status: "active",
      startDate: a.admissionDate,
    });

    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId,
      actor: ctx.actor,
      action: "enrollment.created",
      entity: { table: "students", id: studentId },
      summary: `Enrolled ${fullName({ firstName: a.firstName, lastName: a.lastName })} (${admissionNo}) in ${section.displayName}`,
    });

    return {
      id: studentId,
      admissionNo,
      email: a.email || `${a.firstName.toLowerCase()}.${a.lastName.toLowerCase()}@school.edu`,
      password: "DemoPassword123!",
      feeAssigned: false,
    };
  },
});
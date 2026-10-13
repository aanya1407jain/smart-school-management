import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import {
  requirePermission,
  getCurrentAcademicYearId,
} from "./core/authorization";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { fullName } from "./model/academics";
import { writeAudit } from "./model/audit";
 HEAD

import { renumberSections } from "./model/rollNumbers";
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
origin/main

/**
 * Fetch sections for a school/year
 */
export const listSections = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, args) => {
    requirePermission(ctx.actor, "students:read:all");
    const yearId = args.academicYearId ?? (await getCurrentAcademicYearId(ctx, ctx.actor.schoolId));
    return await ctx.db
      .query("sections")
      .withIndex("by_school_year", (q) =>
        q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)
      )
      .collect();
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
    sectionId: v.string(),
    guardian: v.object({
      name: v.string(),
      relation: v.string(),
      phone: v.string(),
      email: v.optional(v.string()),
      occupation: v.optional(v.string()),
    }),
  },
 HEAD
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
>>>>>>> origin/main
    });

    await ctx.db.insert("guardianLinks", {
      schoolId: ctx.actor.schoolId,
      guardianId,
      studentId,
      relationship: a.guardian.relation,
      isPrimary: true,
    });

    // 4. Resolve Section with strict table typing
    const schoolSections: Doc<"sections">[] = await ctx.db
      .query("sections")
      .withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId))
      .collect();

    const targetSection: Doc<"sections"> | undefined =
      schoolSections.find((s) => s._id === a.sectionId) ??
      schoolSections.find(
        (s) =>
          s.name.toLowerCase() === a.sectionId.toLowerCase() ||
          s.displayName.toLowerCase().includes(a.sectionId.toLowerCase())
      ) ??
      schoolSections[0];

    if (targetSection) {
      await ctx.db.insert("enrollments", {
        schoolId: ctx.actor.schoolId,
        studentId,
        academicYearId: targetSection.academicYearId,
        classId: targetSection.classId,
        sectionId: targetSection._id,
        status: "active",
        startDate: a.admissionDate,
      });

      await writeAudit(ctx, {
        schoolId: ctx.actor.schoolId,
        actor: ctx.actor,
        action: "enrollment.created",
        entity: { table: "students", id: studentId },
        summary: `Enrolled ${fullName({ firstName: a.firstName, lastName: a.lastName })} (${admissionNo}) in ${targetSection.displayName}`,
      });
    }

    return {
      id: studentId,
      admissionNo,
      email: a.email || `${a.firstName.toLowerCase()}.${a.lastName.toLowerCase()}@school.edu`,
      password: "DemoPassword123!",
      feeAssigned: false,
    };
  },
<<<<<<< HEAD
});
=======
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
>>>>>>> origin/main

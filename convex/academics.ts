/**
 * School structure (Core): academic years, classes (grade levels), sections and
 * their class teachers, plus the teacher picker and "what do I teach".
 *
 *   AcademicYear (2026-27)
 *     └─ Class (Grade 8) ── Section (8-A, year-specific, classTeacherId)
 *
 * SUBJECT ASSIGNMENT != ATTENDANCE OWNERSHIP. Attendance ownership is only
 * `sections.classTeacherId`, changed via `setClassTeacher`.
 *
 * Student admissions and records live in convex/students.ts (Students);
 * subjects, curriculum and subject-teacher assignments in convex/subjects.ts
 * (Academics) — reached from here only through providers (core/registry.ts).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getCurrentAcademicYearId, getInSchool, getSchoolSettings, hasPermission, linkedStudentIds, requirePermission, readScopeSectionIds, enrollmentFor } from "./core/authorization";
import { conflict, invalid, invalidRelationship } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vAcademicYearStatus } from "./core/validators";
import { maybeProvider } from "./core/registry";
import { moduleStateOf } from "./model/modules";
import { teacherDisplayName } from "./model/academics";
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

/**
 * Sections visible to the caller in a year (default: current year):
 * admins → all; teachers → sections they teach or own; student → their own section.
 */
export const listSections = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const yearId = academicYearId ? (await getInSchool(ctx, "academicYears", academicYearId))._id : await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    let sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    if (!hasPermission(ctx.actor, "academics:manage") && !hasPermission(ctx.actor, "students:read:all")) {
      let allowed = new Set<Id<"sections">>();
      allowed = await readScopeSectionIds(ctx, ctx.actor, yearId);
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

/** What the calling teacher teaches this year, and which section (if any) they own. */
export const myTeaching = schoolQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.actor.teacherId) return { assignments: [], classTeacherOf: [] };
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const teacherId = ctx.actor.teacherId;
    // Subject assignments belong to Academics (none when it is not shipped); class-teacher sections are Core.
    const scope = maybeProvider("academics.teacherScope");
    const out = scope ? await scope.assignmentsOf(ctx, ctx.actor.schoolId, teacherId, yearId) : [];
    const owned = await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", teacherId).eq("academicYearId", yearId)).collect();
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

/**
 * Subject picker options for Core screens (teacher specialisations, shared
 * filters). Subjects belong to Academics and are read through its provider:
 * empty when Academics is not shipped in this build.
 */
export const listSubjectOptions = schoolQuery({
  args: {},
  handler: async (ctx) => {
    const catalog = maybeProvider("academics.subjects");
    if (!catalog) return [];
    return (await catalog.subjects(ctx, ctx.actor.schoolId)).map((s) => ({ _id: s.id, name: s.name, code: s.code, active: s.active }));
  },
});

/**
 * Figures from other modules for the Academics setup cockpit (academics:manage):
 * the number of school subjects (Academics) and enrollment health for the
 * current year (Students, when enabled). Each is null when the module is not
 * shipped in this build (or Students is disabled for the school).
 */
export const setupStatus = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "academics:manage");
    const catalog = maybeProvider("academics.subjects");
    const subjects = catalog ? (await catalog.subjects(ctx, ctx.actor.schoolId)).length : null;
    const roster = maybeProvider("students.roster");
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId).catch(() => null);
    const year = yearId ? await ctx.db.get(yearId) : null;
    const studentsOn = (await moduleStateOf(ctx, ctx.actor.schoolId)).enabled.has("students");
    const enrollment = roster && year && studentsOn ? { ...(await roster.enrollmentHealth(ctx, ctx.actor.schoolId, year._id)), academicYear: year.name } : null;
    return { subjects, enrollment };
  },
});


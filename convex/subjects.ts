/**
 * Academics: subjects, class curriculum (class ↔ subject per year) and
 * subject-teacher assignments. Moved from convex/academics.ts (which keeps the
 * Core school structure). Functions keep their original wrappers: subjects and
 * curriculum were never gated by a module entitlement, so nothing changes for
 * schools.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getCurrentAcademicYearId, getInSchool, requirePermission, requireSectionRead } from "./core/authorization";
import { conflict, invalid, invalidRelationship } from "./core/errors";
import { assertNonEmpty } from "./core/validators";
import { teacherDisplayName } from "./model/academics";
import { writeAudit } from "./model/audit";

export const listSubjects = schoolQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect(),
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

/**
 * Create a school subject. `classIds` (with `academicYearId`) also adds it to
 * those classes' curriculum for that year in the same transaction, so a new
 * subject can be offered to e.g. Classes 8–10 in one step.
 */
export const createSubject = schoolMutation({
  args: { name: v.string(), code: v.string(), academicYearId: v.optional(v.id("academicYears")), classIds: v.optional(v.array(v.id("classes"))) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const name = assertNonEmpty(a.name, "name", 60);
    const code = assertNonEmpty(a.code, "code", 12).toUpperCase();
    const classIds = [...new Set(a.classIds ?? [])];
    if (classIds.length && !a.academicYearId) throw invalid("Choose the academic year the classes study it in.", { academicYearId: "Required" });
    const year = a.academicYearId ? await getInSchool(ctx, "academicYears", a.academicYearId, "Academic year") : null;
    const classes: Doc<"classes">[] = [];
    for (const id of classIds) classes.push(await getInSchool(ctx, "classes", id, "Class"));
    const dup = await ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("code", code)).first();
    if (dup) throw conflict(`Subject code ${code} is already used.`);
    const id = await ctx.db.insert("subjects", { schoolId: ctx.actor.schoolId, name, code, active: true });
    if (year) {
      for (const cls of classes) {
        await assertCurriculumRoom(ctx, cls, year._id);
        await ctx.db.insert("classSubjects", { schoolId: ctx.actor.schoolId, academicYearId: year._id, classId: cls._id, subjectId: id });
      }
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "subject.created", entity: { table: "subjects", id },
      summary: classes.length ? `Created subject ${name} for ${classes.map((c) => c.name).join(", ")}` : `Created subject ${name}`,
      ...(year && classes.length ? { metadata: { academicYearId: year._id, classIds: classes.map((c) => c._id) } } : {}),
    });
    return id;
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
/** Upper bound for one year's curriculum rows across the school (classes × subjects). */
const MAX_CURRICULUM_ROWS = 2000;
const MAX_CREDITS = 20;

const vCurriculumOptions = v.object({
  subjectId: v.id("subjects"),
  elective: v.optional(v.boolean()),
  stream: v.optional(v.string()),
  credits: v.optional(v.number()),
});
type CurriculumOptions = { elective?: boolean; stream?: string; credits?: number };

/** Validated, minimal options (omitted fields stay omitted: core, every stream, unweighted). */
function cleanOptions(o: CurriculumOptions): CurriculumOptions {
  const stream = o.stream?.trim();
  if (stream && stream.length > 24) throw invalid("Stream names are at most 24 characters.", { stream: "Too long" });
  if (o.credits !== undefined && (!Number.isFinite(o.credits) || o.credits < 0 || o.credits > MAX_CREDITS || Math.round(o.credits * 2) !== o.credits * 2)) {
    throw invalid(`Credits must be between 0 and ${MAX_CREDITS}, in steps of 0.5.`, { credits: "Invalid" });
  }
  return { ...(o.elective ? { elective: true } : {}), ...(stream ? { stream } : {}), ...(o.credits !== undefined ? { credits: o.credits } : {}) };
}

const sameOptions = (row: CurriculumOptions, o: CurriculumOptions) => (row.elective ?? false) === (o.elective ?? false) && row.stream === o.stream && row.credits === o.credits;

async function assertCurriculumRoom(ctx: QueryCtx, cls: Doc<"classes">, academicYearId: Id<"academicYears">) {
  const rows = await ctx.db.query("classSubjects").withIndex("by_class_year_subject", (q) => q.eq("classId", cls._id).eq("academicYearId", academicYearId)).take(MAX_SUBJECTS_PER_CLASS);
  if (rows.length >= MAX_SUBJECTS_PER_CLASS) throw invalid(`${cls.name} already has ${MAX_SUBJECTS_PER_CLASS} subjects.`, { classIds: "Too many" });
}

/** A subject cannot leave a class's curriculum while one of the class's sections still has a teacher for it. */
async function assertNoTeacherAssigned(ctx: QueryCtx, cls: Doc<"classes">, academicYearId: Id<"academicYears">, subjectId: Id<"subjects">) {
  const sections = await ctx.db.query("sections").withIndex("by_class_year", (q) => q.eq("classId", cls._id).eq("academicYearId", academicYearId)).collect();
  for (const section of sections) {
    const assigned = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", section._id).eq("subjectId", subjectId)).first();
    if (assigned) {
      const subject = await ctx.db.get(subjectId);
      throw invalidRelationship(`${subject?.name ?? "A subject"} still has a teacher assigned in ${section.displayName}. Remove the assignment first.`);
    }
  }
}

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
      if (subject && subject.schoolId === ctx.actor.schoolId) out.push({ subjectId: subject._id, name: subject.name, code: subject.code, elective: r.elective ?? false, stream: r.stream ?? null, credits: r.credits ?? null });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  },
});

/**
 * The whole school's curriculum for a year (default: current year): one row
 * per class ↔ subject, for the Subjects tab's per-class view. Not sensitive.
 */
export const listCurriculum = schoolQuery({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const yearId = await resolveYearId(ctx, academicYearId);
    const rows = await ctx.db.query("classSubjects").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).take(MAX_CURRICULUM_ROWS);
    return rows.map((r) => ({ classId: r.classId, subjectId: r.subjectId, elective: r.elective ?? false, stream: r.stream ?? null, credits: r.credits ?? null }));
  },
});

/**
 * Replace a class's curriculum for a year. Removing a subject that still has
 * subject-teacher assignments in that class's sections is rejected — remove
 * the assignments first, so no orphaned assignment is left behind.
 */
export const setClassSubjects = schoolMutation({
  args: {
    classId: v.id("classes"), academicYearId: v.id("academicYears"), subjectIds: v.array(v.id("subjects")),
    /** Elective / stream / credits per subject. When given, a subject without an entry is core for every stream, unweighted; when omitted, kept subjects keep theirs. */
    options: v.optional(v.array(vCurriculumOptions)),
  },
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
    const options = new Map<string, CurriculumOptions>();
    for (const o of a.options ?? []) {
      if (!wanted.includes(o.subjectId)) throw invalid("Options were given for a subject that is not in the curriculum.", { options: "Unknown subject" });
      options.set(o.subjectId, cleanOptions(o));
    }
    const added = wanted.filter((id) => !currentIds.has(id));
    const removed = current.filter((r) => !wanted.includes(r.subjectId));

    for (const r of removed) await assertNoTeacherAssigned(ctx, cls, year._id, r.subjectId);
    for (const r of removed) await ctx.db.delete(r._id);
    for (const subjectId of added) {
      await ctx.db.insert("classSubjects", { schoolId: ctx.actor.schoolId, academicYearId: year._id, classId: cls._id, subjectId, ...options.get(subjectId) });
    }
    // Kept subjects: rewrite a row only when its options changed.
    let changed = 0;
    if (a.options) {
      for (const r of current) {
        if (!wanted.includes(r.subjectId)) continue;
        const o = options.get(r.subjectId) ?? {};
        if (sameOptions(r, o)) continue;
        await ctx.db.replace(r._id, { schoolId: r.schoolId, academicYearId: r.academicYearId, classId: r.classId, subjectId: r.subjectId, ...o });
        changed += 1;
      }
    }
    if (added.length || removed.length || changed) {
      await writeAudit(ctx, {
        schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "curriculum.updated", entity: { table: "classes", id: cls._id },
        summary: `Updated ${cls.name} curriculum for ${year.name} (+${added.length} / −${removed.length}${changed ? ` / ${changed} changed` : ""})`,
        metadata: { academicYearId: year._id, added, removed: removed.map((r) => r.subjectId), changed },
      });
    }
    return { added: added.length, removed: removed.length, changed };
  },
});

/**
 * Set which classes study a subject in a year (the subject-first view of the
 * same curriculum rows). Kept classes keep their elective / stream / credits;
 * removing a class that still has a teacher for the subject is rejected.
 */
export const setSubjectClasses = schoolMutation({
  args: { subjectId: v.id("subjects"), academicYearId: v.id("academicYears"), classIds: v.array(v.id("classes")) },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "academics:manage");
    const subject = await getInSchool(ctx, "subjects", a.subjectId, "Subject");
    const year = await getInSchool(ctx, "academicYears", a.academicYearId, "Academic year");
    const classes = new Map<string, Doc<"classes">>();
    for (const id of new Set(a.classIds)) classes.set(id, await getInSchool(ctx, "classes", id, "Class"));
    const current = (await ctx.db.query("classSubjects").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", year._id)).take(MAX_CURRICULUM_ROWS))
      .filter((r) => r.subjectId === subject._id);
    const currentIds = new Set<string>(current.map((r) => r.classId));
    const added = [...classes.values()].filter((c) => !currentIds.has(c._id));
    const removed = current.filter((r) => !classes.has(r.classId));
    if (added.length && !subject.active) throw invalidRelationship(`${subject.name} is inactive.`);

    for (const r of removed) {
      const cls = await ctx.db.get(r.classId);
      if (cls) await assertNoTeacherAssigned(ctx, cls, year._id, subject._id);
    }
    for (const r of removed) await ctx.db.delete(r._id);
    for (const cls of added) {
      await assertCurriculumRoom(ctx, cls, year._id);
      await ctx.db.insert("classSubjects", { schoolId: ctx.actor.schoolId, academicYearId: year._id, classId: cls._id, subjectId: subject._id });
    }
    if (added.length || removed.length) {
      await writeAudit(ctx, {
        schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "curriculum.updated", entity: { table: "subjects", id: subject._id },
        summary: `Updated the classes studying ${subject.name} in ${year.name} (+${added.length} / −${removed.length})`,
        metadata: { academicYearId: year._id, added: added.map((c) => c._id), removed: removed.map((r) => r.classId) },
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

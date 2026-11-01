/**
 * Teacher records (Core): the staff list with class-teacher sections and
 * subject load, and editing a teacher record. Moved from convex/staff.ts
 * (which keeps Attendance's staff attendance and leave). Subject names and
 * subject load come from Academics through providers (none when it is not
 * shipped).
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, requirePermission } from "./core/authorization";
import { invalid, notFound } from "./core/errors";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { maybeProvider } from "./core/registry";
import { teacherDisplayName } from "./model/academics";
import { writeAudit } from "./model/audit";

/**
 * Teacher records for the Teachers & Staff page (staff:manage): every
 * teacher of the school (any status) with their sign-in state, class-teacher
 * sections and subject assignments in the current year. Bounded.
 * New teachers are added through Accounts & Import (one row or a spreadsheet),
 * which allocates the employee ID; this module edits existing records.
 */
export const MAX_TEACHERS = 1000;
export const listTeachers = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "staff:manage");
    const rows = await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId)).take(MAX_TEACHERS);
    const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", ctx.actor.schoolId)).unique();
    const yearId = settings?.currentAcademicYearId ?? null;
    // Subjects and subject load come from Academics when it is shipped (else none).
    const catalog = maybeProvider("academics.subjects");
    const scope = maybeProvider("academics.teacherScope");
    const subjects = new Map((catalog ? await catalog.subjects(ctx, ctx.actor.schoolId) : []).map((s) => [s.id, s.name]));
    const out = [];
    for (const t of rows) {
      const owned = yearId ? (await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", t._id).eq("academicYearId", yearId)).collect()).filter((s) => s.schoolId === ctx.actor.schoolId) : [];
      const subjectLoad = yearId && scope ? await scope.subjectLoad(ctx, ctx.actor.schoolId, t._id, yearId) : 0;
      const membership = (await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", t._id)).collect()).find((m) => m.schoolId === ctx.actor.schoolId && m.role === "teacher");
      out.push({
        teacherId: t._id, name: teacherDisplayName(t), title: t.title ?? null, firstName: t.firstName, lastName: t.lastName, employeeId: t.employeeId,
        gender: t.gender ?? null, email: t.email ?? null, phone: t.phone ?? null, designation: t.designation ?? null, qualification: t.qualification ?? null,
        joiningDate: t.joiningDate ?? null, status: t.status,
        specializations: t.specializationSubjectIds.map((id) => subjects.get(id)).filter((x): x is string => !!x),
        specializationSubjectIds: t.specializationSubjectIds,
        classTeacherOf: owned.map((s) => s.displayName).sort(),
        subjectLoad,
        account: membership ? { loginId: membership.loginId ?? null, status: membership.status } : null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Edit a teacher record (staff:manage). The employee ID is fixed; deactivating keeps all history. */
export const updateTeacher = schoolMutation({
  args: {
    teacherId: v.id("teachers"),
    title: v.optional(v.string()), firstName: v.optional(v.string()), lastName: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"), v.literal("other"), v.null())),
    email: v.optional(v.string()), phone: v.optional(v.string()), designation: v.optional(v.string()), qualification: v.optional(v.string()),
    joiningDate: v.optional(v.string()),
    // Subject ids of the Academics catalogue (stored as plain ids on the Core teacher record).
    specializationSubjectIds: v.optional(v.array(v.string())),
    status: v.optional(v.union(v.literal("active"), v.literal("on_leave"), v.literal("inactive"))),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "staff:manage");
    const t = await getInSchool(ctx, "teachers", a.teacherId, "Teacher");
    const patch: Partial<Doc<"teachers">> = {};
    const optionalText = (value: string | undefined, field: string, max: number) => (value === undefined ? undefined : value.trim() ? assertNonEmpty(value, field, max) : null);
    if (a.firstName !== undefined) patch.firstName = assertNonEmpty(a.firstName, "firstName", 80);
    if (a.lastName !== undefined) patch.lastName = assertNonEmpty(a.lastName, "lastName", 80);
    for (const [key, max] of [["title", 20], ["designation", 80], ["qualification", 120], ["phone", 30]] as const) {
      const value = optionalText(a[key], key, max);
      if (value !== undefined) patch[key] = value ?? undefined;
    }
    if (a.email !== undefined) {
      const email = a.email.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Enter a valid email address.", { email: "Invalid" });
      patch.email = email || undefined;
    }
    if (a.gender !== undefined) patch.gender = a.gender ?? undefined;
    if (a.joiningDate !== undefined) patch.joiningDate = a.joiningDate ? assertIsoDate(a.joiningDate, "joiningDate") : undefined;
    if (a.specializationSubjectIds !== undefined) {
      const wanted = [...new Set(a.specializationSubjectIds)];
      if (wanted.length) {
        const catalog = maybeProvider("academics.subjects");
        if (!catalog) throw invalid("Subjects are not available in this installation.", { specializationSubjectIds: "Not available" });
        const known = new Set((await catalog.subjects(ctx, ctx.actor.schoolId)).map((s) => s.id));
        const unknown = wanted.find((id) => !known.has(id));
        if (unknown) throw notFound("Subject");
      }
      patch.specializationSubjectIds = wanted;
    }
    if (a.status !== undefined) patch.status = a.status;
    if (Object.keys(patch).length === 0) return { ok: true, changed: [] as string[] };
    await ctx.db.patch(t._id, patch);
    // Keep the teacher's sign-in display name in step with the record.
    if (patch.firstName !== undefined || patch.lastName !== undefined || "title" in patch) {
      const next = teacherDisplayName({ ...t, ...patch } as Doc<"teachers">);
      for (const m of await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", t._id)).collect()) {
        if (m.schoolId === ctx.actor.schoolId && m.displayName !== next) await ctx.db.patch(m._id, { displayName: next });
      }
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "teacher.updated", entity: { table: "teachers", id: t._id },
      summary: `Updated teacher ${teacherDisplayName(t)}`, metadata: { fields: Object.keys(patch), ...(a.status && a.status !== t.status ? { status: { from: t.status, to: a.status } } : {}) },
    });
    return { ok: true, changed: Object.keys(patch) };
  },
});

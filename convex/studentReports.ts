/**
 * Student reports (Students): enrollment summary and enrolled-student statistics. Moved from convex/reports.ts; administration-gated like every report, and each also requires the Students module.
 */
import type { Doc, Id } from "./_generated/dataModel";
import { moduleQuery } from "./core/functions";
import { requireModule } from "./model/modules";
import { getCurrentAcademicYearId, requirePermission } from "./core/authorization";
import { conflict } from "./core/errors";

const administrationQuery = moduleQuery("administration");
const MAX_STUDENTS = 5000;

export const enrollmentSummary = administrationQuery({
  args: {},
  handler: async (ctx) => {
    await requireModule(ctx, ctx.actor.schoolId, "students"); // data comes from that module (administration checked by the wrapper)
    requirePermission(ctx.actor, "reports:read");
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const byStatus: Record<string, number> = {};
    for (const status of ["active", "inactive", "alumni", "transferred"] as const) {
      const rows = await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", status)).take(MAX_STUDENTS + 1);
      if (rows.length > MAX_STUDENTS) throw conflict(`More than ${MAX_STUDENTS} ${status} students; this report needs pagination.`);
      byStatus[status] = rows.length;
    }
    const enrollments = (await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).take(MAX_STUDENTS * 2))
      .filter((e) => e.status === "active");
    const seen = new Set<Id<"students">>();
    const bySection = new Map<Id<"sections">, number>();
    for (const e of enrollments) {
      if (seen.has(e.studentId)) continue; // a student counts once even with a stray duplicate enrollment
      seen.add(e.studentId);
      bySection.set(e.sectionId, (bySection.get(e.sectionId) ?? 0) + 1);
    }
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    const classes = new Map<Id<"classes">, Doc<"classes"> | null>();
    const rows = [];
    for (const s of sections) {
      if (!classes.has(s.classId)) classes.set(s.classId, await ctx.db.get(s.classId));
      rows.push({ sectionId: s._id, section: s.displayName, classId: s.classId, className: classes.get(s.classId)?.name ?? "", level: classes.get(s.classId)?.level ?? 0, students: bySection.get(s._id) ?? 0 });
    }
    rows.sort((a, b) => a.level - b.level || a.section.localeCompare(b.section, undefined, { numeric: true }));
    const teachers = (await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "active")).collect()).length;
    return { academicYearId: yearId, studentsByStatus: byStatus, enrolledThisYear: seen.size, activeTeachers: teachers, sections: rows };
  },
});

/** Students enrolled this year: by class and gender, by status, section fill, distinct parent contacts. */
export const studentStatistics = administrationQuery({
  args: {},
  handler: async (ctx) => {
    await requireModule(ctx, ctx.actor.schoolId, "students"); // data comes from that module (administration checked by the wrapper)
    requirePermission(ctx.actor, "reports:read");
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    const enrollments = await ctx.db.query("enrollments").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).take(MAX_STUDENTS * 2 + 1);
    if (enrollments.length > MAX_STUDENTS * 2) throw conflict("Too many enrollments for one report.");
    // One row per student: the active enrollment if any, else the latest.
    const latest = new Map<Id<"students">, Doc<"enrollments">>();
    for (const e of enrollments) {
      const cur = latest.get(e.studentId);
      if (!cur || e.status === "active" || (cur.status !== "active" && e._creationTime > cur._creationTime)) latest.set(e.studentId, e);
    }
    const status: Record<string, number> = { active: 0, inactive: 0, transferred: 0, alumni: 0 };
    const byClassMap = new Map<Id<"classes">, { male: number; female: number; other: number; total: number }>();
    const bySectionCount = new Map<Id<"sections">, number>();
    const parentContacts = new Set<string>();
    for (const [studentId, e] of latest) {
      const st = await ctx.db.get(studentId);
      if (!st || st.schoolId !== ctx.actor.schoolId) continue;
      status[st.status] = (status[st.status] ?? 0) + 1;
      if (e.status !== "active" || st.status !== "active") continue;
      const row = byClassMap.get(e.classId) ?? { male: 0, female: 0, other: 0, total: 0 };
      if (st.gender === "male") row.male++;
      else if (st.gender === "female") row.female++;
      else row.other++;
      row.total++;
      byClassMap.set(e.classId, row);
      bySectionCount.set(e.sectionId, (bySectionCount.get(e.sectionId) ?? 0) + 1);
      for (const l of await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect()) if (l.schoolId === ctx.actor.schoolId) parentContacts.add(l.guardianId);
    }
    const classes = await ctx.db.query("classes").withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
    const level = new Map(classes.map((c) => [c._id, c.level]));
    return {
      total: [...latest.values()].filter((e) => e.status === "active").length,
      status,
      byClass: classes.filter((c) => byClassMap.has(c._id)).sort((a, b) => a.level - b.level).map((c) => ({ classId: c._id, name: c.name, ...byClassMap.get(c._id)! })),
      bySection: sections.sort((a, b) => (level.get(a.classId) ?? 0) - (level.get(b.classId) ?? 0) || a.name.localeCompare(b.name)).map((s) => ({ sectionId: s._id, label: s.displayName, students: bySectionCount.get(s._id) ?? 0, capacity: s.capacity ?? null })),
      parentContacts: parentContacts.size,
    };
  },
});

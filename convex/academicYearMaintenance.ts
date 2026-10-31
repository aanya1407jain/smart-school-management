/**
 * Academic-year OPERATOR tool (internal: never callable from the browser).
 * Creates a PLANNED next academic year with the same sections as the current
 * year (same classes, names, rooms and capacities; no class teachers, no
 * students), so promotions can be prepared. The current year is not changed.
 *
 *   npx convex run academicYearMaintenance:createPlannedYear '{"name":"2027-28","startDate":"2027-04-01","endDate":"2028-03-31","dryRun":true}'
 *
 * Safe to re-run: an existing year with the same name is reused and sections
 * that already exist in it are skipped.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { conflict, invalid, notFound } from "./core/errors";
import { assertIsoDate } from "./core/validators";
import { writeAudit } from "./model/audit";

export const createPlannedYear = internalMutation({
  args: { schoolSlug: v.optional(v.string()), name: v.string(), startDate: v.string(), endDate: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { schoolSlug, name, startDate, endDate, dryRun }) => {
    assertIsoDate(startDate, "startDate");
    assertIsoDate(endDate, "endDate");
    if (startDate >= endDate) throw invalid("The year must end after it starts.");
    const schools = schoolSlug !== undefined
      ? await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug.trim().toLowerCase())).take(1)
      : await ctx.db.query("schools").take(2);
    if (schools.length === 0) throw notFound("School");
    if (schools.length > 1) throw conflict("This deployment has more than one school; pass schoolSlug.");
    const school = schools[0];
    const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", school._id)).unique();
    if (!settings?.currentAcademicYearId) throw notFound("Current academic year");
    const current = (await ctx.db.get(settings.currentAcademicYearId))!;
    if (startDate <= current.startDate) throw invalid(`The new year must start after ${current.name}.`);

    const years = await ctx.db.query("academicYears").withIndex("by_school_start", (q) => q.eq("schoolId", school._id)).collect();
    const existing = years.find((y) => y.name === name.trim());
    const currentSections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", current._id)).collect();
    const already = existing ? await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", existing._id)).collect() : [];
    const toCreate = currentSections.filter((s) => !already.some((a) => a.classId === s.classId && a.name === s.name));
    const plan = { school: school.slug, year: name.trim(), yearExists: !!existing, copyFrom: current.name, sections: toCreate.map((s) => s.displayName) };
    if (dryRun !== false) return { dryRun: true, ...plan };

    const yearId = existing?._id ?? await ctx.db.insert("academicYears", { schoolId: school._id, name: name.trim(), startDate, endDate, status: "planned" });
    for (const s of toCreate) {
      await ctx.db.insert("sections", {
        schoolId: school._id, academicYearId: yearId, classId: s.classId, name: s.name, displayName: s.displayName,
        ...(s.room ? { room: s.room } : {}), ...(s.capacity !== undefined ? { capacity: s.capacity } : {}),
      });
    }
    await writeAudit(ctx, {
      schoolId: school._id, action: "academic_year.planned", entity: { table: "academicYears", id: yearId },
      summary: `Operator tool: planned ${name.trim()} with ${toCreate.length} section(s) copied from ${current.name}`,
      metadata: { sections: plan.sections },
    });
    return { dryRun: false, yearId, ...plan };
  },
});

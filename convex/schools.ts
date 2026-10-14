/**
 * School (tenant) profile & settings.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getSchoolSettings, requirePermission } from "./core/authorization";
import { invalid, notFound } from "./core/errors";
import { assertNonEmpty } from "./core/validators";
import { writeAudit } from "./model/audit";

/**
 * Public branding for the splash/login screens, resolved by slug (e.g. from
 * the subdomain or a deployment env var). Exposes only public fields.
 */
export const publicProfile = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const school = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase())).unique();
    if (!school || school.status !== "active") return null;
    return {
      name: school.name,
      shortName: school.shortName,
      tagline: school.tagline ?? null,
      logoUrl: school.logoStorageId ? await ctx.storage.getUrl(school.logoStorageId) : null,
    };
  },
});

/** The caller's school profile + settings (any member). */
export const current = schoolQuery({
  args: {},
  handler: async (ctx) => {
    const school = await ctx.db.get(ctx.actor.schoolId);
    if (!school) throw notFound("School");
    const settings = await getSchoolSettings(ctx, school._id);
    const { _id, name, shortName, slug, code, timezone, locale, currency, tagline, address, phone, email, website, affiliation } = school;
    return {
      school: { _id, name, shortName, slug, code, timezone, locale, currency, tagline, address, phone, email, website, affiliation },
      settings: {
        currentAcademicYearId: settings.currentAcademicYearId ?? null,
        workingDays: settings.workingDays,
        attendance: settings.attendance,
        grading: settings.grading,
        notifications: settings.notifications,
      },
    };
  },
});

export const updateProfile = schoolMutation({
  args: {
    name: v.optional(v.string()),
    shortName: v.optional(v.string()),
    tagline: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    affiliation: v.optional(v.string()),
  },
  handler: async (ctx, patch) => {
    requirePermission(ctx.actor, "settings:manage");
    if (patch.name !== undefined) patch.name = assertNonEmpty(patch.name, "name", 120);
    if (patch.shortName !== undefined) patch.shortName = assertNonEmpty(patch.shortName, "shortName", 40);
    await ctx.db.patch(ctx.actor.schoolId, patch);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "school.profile_updated",
      entity: { table: "schools", id: ctx.actor.schoolId }, summary: "Updated school profile", metadata: { fields: Object.keys(patch) },
    });
    return { ok: true };
  },
});

export const updateSettings = schoolMutation({
  args: {
    workingDays: v.optional(v.array(v.number())),
    attendance: v.optional(v.object({ lateCountsAsPresent: v.boolean(), lowAttendanceThreshold: v.number() })),
    grading: v.optional(v.object({ scheme: v.string(), passPercentage: v.number() })),
    notifications: v.optional(v.object({
      attendanceAlerts: v.boolean(), feeReminders: v.boolean(), homeworkAlerts: v.boolean(), examAlerts: v.boolean(), noticeAlerts: v.boolean(),
    })),
  },
  handler: async (ctx, patch) => {
    requirePermission(ctx.actor, "settings:manage");
    if (patch.workingDays && (patch.workingDays.length === 0 || patch.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
      throw invalid("workingDays must contain weekday numbers 0–6", { workingDays: "Invalid" });
    }
    if (patch.attendance && (patch.attendance.lowAttendanceThreshold < 50 || patch.attendance.lowAttendanceThreshold > 100)) {
      throw invalid("Threshold must be between 50 and 100", { lowAttendanceThreshold: "50–100" });
    }
    if (patch.grading && (patch.grading.passPercentage < 0 || patch.grading.passPercentage > 100)) {
      throw invalid("Pass percentage must be between 0 and 100", { passPercentage: "0–100" });
    }
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    await ctx.db.patch(settings._id, patch);
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "school.settings_updated",
      entity: { table: "schoolSettings", id: settings._id }, summary: "Updated school settings", metadata: { fields: Object.keys(patch) },
    });
    return { ok: true };
  },
});

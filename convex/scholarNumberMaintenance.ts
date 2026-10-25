/**
 * Scholar numbers — OPERATOR functions (internal: never callable from the
 * browser). Same trust boundary as setup:initSchool and schoolModules.
 *
 *   # 1. turn on automatic numbering for the school (new admissions/imports get <prefix>0001, 0002 …)
 *   npx convex run scholarNumberMaintenance:configure '{"prefix":"0246CBSE"}'
 *
 *   # 2. give existing students without a scholar number one, in admission-number order
 *   npx convex run scholarNumberMaintenance:backfill '{"dryRun":true}'
 *   npx convex run scholarNumberMaintenance:backfill '{}'
 *
 * Backfill never changes a number a student already has, is safe to re-run
 * (it only numbers students that still have none) and writes one audit row.
 * `schoolSlug` picks the school when a deployment has several.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { conflict, invalid, notFound } from "./core/errors";
import { getSchoolSettings } from "./core/authorization";
import { counterKeys, peekCounter } from "./model/counters";
import { writeAudit } from "./model/audit";
import { SCHOLAR_PREFIX_PATTERN, formatScholarNo, nextScholarNumber, scholarNoKey, scholarPrefixOf, studentByScholarNo } from "./model/scholarNumbers";

/** Students numbered per call (2 writes each); re-run until `remaining` is 0. */
export const MAX_BACKFILL = 1000;

async function schoolBySlugOrOnly(ctx: QueryCtx, schoolSlug: string | undefined): Promise<Doc<"schools">> {
  if (schoolSlug !== undefined) {
    const s = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug.trim().toLowerCase())).first();
    if (!s) throw notFound("School");
    return s;
  }
  const schools = await ctx.db.query("schools").take(2);
  if (schools.length === 0) throw notFound("School");
  if (schools.length > 1) throw conflict("This deployment has more than one school; pass schoolSlug.");
  return schools[0];
}

/** Set (or with `prefix: ""` turn off) automatic scholar numbers for a school. */
export const configure = internalMutation({
  args: { schoolSlug: v.optional(v.string()), prefix: v.string() },
  handler: async (ctx, { schoolSlug, prefix }) => {
    const school = await schoolBySlugOrOnly(ctx, schoolSlug);
    const value = prefix.trim().toUpperCase();
    if (value && !SCHOLAR_PREFIX_PATTERN.test(value)) throw invalid("The prefix is 1–20 letters or digits, e.g. 0246CBSE.");
    const settings = await getSchoolSettings(ctx, school._id);
    const before = settings.scholarNumberPrefix ?? null;
    await ctx.db.patch(settings._id, { scholarNumberPrefix: value || undefined });
    await writeAudit(ctx, {
      schoolId: school._id, action: "school.scholar_numbering_changed", entity: { table: "schoolSettings", id: settings._id },
      summary: value ? `Automatic scholar numbers: ${formatScholarNo(value, 1)}, ${formatScholarNo(value, 2)} …` : "Automatic scholar numbers turned off",
      metadata: { before, after: value || null },
    });
    return { school: school.slug, prefix: value || null, next: value ? formatScholarNo(value, (await peekCounter(ctx, school._id, counterKeys.scholar())) + 1) : null };
  },
});

/**
 * Give every student of the school WITHOUT a scholar number the next automatic
 * number, in admission-number order (all statuses — the register keeps leavers).
 * `dryRun` shows what would be assigned without writing anything.
 */
export const backfill = internalMutation({
  args: { schoolSlug: v.optional(v.string()), dryRun: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, { schoolSlug, dryRun, limit }) => {
    const school = await schoolBySlugOrOnly(ctx, schoolSlug);
    const prefix = await scholarPrefixOf(ctx, school._id);
    if (!prefix) throw conflict("Set the school's scholar number prefix first (scholarNumberMaintenance:configure).");
    const max = Math.min(Math.max(1, Math.floor(limit ?? MAX_BACKFILL)), MAX_BACKFILL);

    const missing: Doc<"students">[] = [];
    let remaining = 0;
    for await (const s of ctx.db.query("students").withIndex("by_school_admission", (q) => q.eq("schoolId", school._id))) {
      if (s.scholarNo) continue;
      if (missing.length < max) missing.push(s);
      else remaining++;
    }

    const assigned: { studentId: Id<"students">; admissionNo: string; name: string; scholarNo: string }[] = [];
    if (dryRun) {
      // Simulate the counter (skipping numbers already in use) without allocating anything.
      let n = await peekCounter(ctx, school._id, counterKeys.scholar());
      for (const s of missing) {
        let candidate: string;
        do candidate = formatScholarNo(prefix, ++n);
        while (await studentByScholarNo(ctx, school._id, scholarNoKey(candidate)));
        assigned.push({ studentId: s._id, admissionNo: s.admissionNo, name: `${s.firstName} ${s.lastName}`, scholarNo: candidate });
      }
    } else {
      for (const s of missing) {
        const next = (await nextScholarNumber(ctx, school._id))!;
        await ctx.db.patch(s._id, next);
        assigned.push({ studentId: s._id, admissionNo: s.admissionNo, name: `${s.firstName} ${s.lastName}`, scholarNo: next.scholarNo });
      }
      if (assigned.length) {
        await writeAudit(ctx, {
          schoolId: school._id, action: "student.scholar_numbers_assigned", entity: { table: "schools", id: school._id },
          summary: `Assigned scholar numbers ${assigned[0].scholarNo} – ${assigned.at(-1)!.scholarNo} to ${assigned.length} student(s)`,
          metadata: { count: assigned.length, first: assigned[0].scholarNo, last: assigned.at(-1)!.scholarNo },
        });
      }
    }
    return {
      school: school.slug, prefix, dryRun: !!dryRun, count: assigned.length, remaining,
      first: assigned[0]?.scholarNo ?? null, last: assigned.at(-1)?.scholarNo ?? null,
      sample: assigned.slice(0, 10).map(({ admissionNo, name, scholarNo }) => ({ admissionNo, name, scholarNo })),
    };
  },
});

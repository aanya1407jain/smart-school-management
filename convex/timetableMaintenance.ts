/**
 * Bell-schedule OPERATOR tool (internal: never callable from the browser).
 * Adds break periods (short break, lunch, assembly …) into a school's bell
 * schedule and renumbers every period by start time. Lessons reference periods
 * by id, so no lesson moves. A break may not overlap an existing period.
 *
 *   npx convex run timetableMaintenance:addBreaks '{"breaks":[{"label":"Short break","startTime":"10:00","endTime":"10:15"},{"label":"Lunch","startTime":"11:45","endTime":"12:30"}],"dryRun":true}'
 *
 * Breaks that already exist (same label and times) are skipped, so it is safe
 * to re-run. The same can be done by hand in the builder (Bell schedule).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { conflict, invalid, notFound } from "./core/errors";
import { assertTime } from "./core/validators";
import { writeAudit } from "./model/audit";

export const addBreaks = internalMutation({
  args: {
    schoolSlug: v.optional(v.string()),
    breaks: v.array(v.object({ label: v.string(), startTime: v.string(), endTime: v.string() })),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { schoolSlug, breaks, dryRun }) => {
    const schools = schoolSlug !== undefined
      ? await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug.trim().toLowerCase())).take(1)
      : await ctx.db.query("schools").take(2);
    if (schools.length === 0) throw notFound("School");
    if (schools.length > 1) throw conflict("This deployment has more than one school; pass schoolSlug.");
    const school = schools[0];
    const existing = await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", school._id)).collect();

    const toAdd: { label: string; startTime: string; endTime: string }[] = [];
    for (const b of breaks) {
      assertTime(b.startTime, "startTime");
      assertTime(b.endTime, "endTime");
      const label = b.label.trim();
      if (!label) throw invalid("A break needs a name.");
      if (b.startTime >= b.endTime) throw invalid(`${label} must end after it starts.`);
      if (existing.some((p) => p.isBreak && p.label === label && p.startTime === b.startTime && p.endTime === b.endTime)) continue;
      const overlap = [...existing, ...toAdd.map((x) => ({ ...x, isBreak: true }))].find((p) => p.startTime < b.endTime && b.startTime < p.endTime);
      if (overlap) throw conflict(`${label} (${b.startTime}–${b.endTime}) overlaps ${overlap.label} (${overlap.startTime}–${overlap.endTime}).`);
      toAdd.push({ label, startTime: b.startTime, endTime: b.endTime });
    }

    const order = [...existing.map((p) => ({ id: p._id as string | null, label: p.label, startTime: p.startTime })), ...toAdd.map((b) => ({ id: null, label: b.label, startTime: b.startTime }))]
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const plan = order.map((p, i) => `${i + 1}. ${p.label} ${p.startTime}${p.id ? "" : " (new break)"}`);
    if (dryRun || toAdd.length === 0) return { school: school.slug, dryRun: !!dryRun, added: 0, toAdd: toAdd.length, schedule: plan };

    // Renumber in two passes so positions never collide mid-way (indexes are unique per school).
    for (const p of existing) await ctx.db.patch(p._id, { index: 100 + p.index });
    const inserted = new Map<string, string>();
    for (const b of toAdd) {
      const id = await ctx.db.insert("periods", { schoolId: school._id, index: 200 + inserted.size, label: b.label, startTime: b.startTime, endTime: b.endTime, isBreak: true });
      inserted.set(`${b.label}|${b.startTime}`, id);
    }
    for (const [i, p] of order.entries()) {
      const id = p.id ?? inserted.get(`${p.label}|${p.startTime}`)!;
      await ctx.db.patch(id as never, { index: i + 1 });
    }
    await writeAudit(ctx, {
      schoolId: school._id, action: "timetable.breaks_added", entity: { table: "schools", id: school._id },
      summary: `Added ${toAdd.map((b) => `${b.label} (${b.startTime}–${b.endTime})`).join(", ")} to the bell schedule`,
      metadata: { breaks: toAdd },
    });
    return { school: school.slug, dryRun: false, added: toAdd.length, toAdd: toAdd.length, schedule: plan };
  },
});

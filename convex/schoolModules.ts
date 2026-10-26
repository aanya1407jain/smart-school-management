/**
 * Module entitlements — OPERATOR functions (internal: never callable from the
 * browser, so no school account of any role can change them).
 *
 * Who may change a school's modules: whoever operates the school's Convex
 * deployment — the same trust boundary as `setup:initSchool` and the other
 * operator functions (convex/setup.ts). Calling an internal function needs the
 * deployment's admin access (Convex dashboard, or the CLI with a deploy key /
 * logged-in team member). There is no in-app "platform operator" role: the
 * school roles stay admin, teacher and student, and a school admin (Principal)
 * cannot grant the school a module it is not entitled to.
 *
 *   # see the current state (mode, enabled, problems)
 *   npx convex run schoolModules:getSchoolModules '{}'
 *
 *   # set the COMPLETE list of enabled modules (dry run first; dependencies are
 *   # checked, nothing is auto-enabled; every change is audited)
 *   npx convex run schoolModules:setSchoolModules '{"enabled":["students","academics","attendance","administration"],"updatedBy":"<your name>","reason":"<ticket or plan>","dryRun":true}'
 *   npx convex run schoolModules:setSchoolModules '{"enabled":["students","academics","attendance","administration"],"updatedBy":"<your name>","reason":"<ticket or plan>"}'
 *
 * `schoolSlug` picks the school when a deployment has several (tests, demo).
 * Disabling a module never deletes its data; enabling it again restores access.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { conflict, invalid, notFound } from "./core/errors";
import { MODULE_KEYS, MODULES, selectionProblems, vModuleKey } from "./core/modules";
import { applyModuleSelection, enabledList, moduleStateOf } from "./model/modules";

async function schoolBySlugOrOnly(ctx: QueryCtx, schoolSlug: string | undefined): Promise<Id<"schools">> {
  if (schoolSlug !== undefined) {
    const s = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug.trim().toLowerCase())).first();
    if (!s) throw notFound("School");
    return s._id;
  }
  const schools = await ctx.db.query("schools").take(2);
  if (schools.length === 0) throw notFound("School");
  if (schools.length > 1) throw conflict("This deployment has more than one school; pass schoolSlug.");
  return schools[0]._id;
}

/** Read a school's module state (operator). */
export const getSchoolModules = internalQuery({
  args: { schoolSlug: v.optional(v.string()) },
  handler: async (ctx, { schoolSlug }) => {
    const schoolId = await schoolBySlugOrOnly(ctx, schoolSlug);
    const school = (await ctx.db.get(schoolId))!;
    const state = await moduleStateOf(ctx, schoolId);
    const rows = await ctx.db.query("schoolModules").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    return {
      school: { name: school.name, slug: school.slug },
      mode: state.mode,
      enabled: enabledList(state),
      disabled: MODULE_KEYS.filter((k) => !state.enabled.has(k)),
      problems: state.problems,
      settings: rows.map((r) => ({ module: r.module, enabled: r.enabled, updatedAt: r.updatedAt, updatedBy: r.updatedBy, reason: r.reason })),
      catalogue: MODULE_KEYS.map((k) => ({ key: k, label: MODULES[k].label, requires: [...MODULES[k].requires] })),
    };
  },
});

/** Set the complete list of enabled modules for a school (operator). `dryRun` reports without writing. */
export const setSchoolModules = internalMutation({
  args: {
    schoolSlug: v.optional(v.string()),
    enabled: v.array(vModuleKey),
    updatedBy: v.string(),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { schoolSlug, enabled, updatedBy, reason, dryRun }) => {
    const schoolId = await schoolBySlugOrOnly(ctx, schoolSlug);
    if (dryRun) {
      const problems = selectionProblems(enabled);
      if (problems.length) throw invalid(problems.join(" "), { enabled: problems.join(" ") });
      const before = await moduleStateOf(ctx, schoolId);
      const beforeList = enabledList(before);
      return {
        dryRun: true as const,
        before: { mode: before.mode, enabled: beforeList },
        after: { mode: "configured" as const, enabled: MODULE_KEYS.filter((k) => enabled.includes(k)) },
        disabledNow: beforeList.filter((k) => !enabled.includes(k)),
        enabledNow: MODULE_KEYS.filter((k) => enabled.includes(k) && !beforeList.includes(k)),
      };
    }
    return { dryRun: false as const, ...(await applyModuleSelection(ctx, { schoolId, enabled, updatedBy, reason })) };
  },
});

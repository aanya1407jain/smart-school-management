/**
 * Function builders. ALL public school data functions must be defined with
 * `schoolQuery` / `schoolMutation` — never with the raw `query` / `mutation`.
 *
 *   export const listBySection = schoolQuery({
 *     args: { sectionId: v.id("sections") },
 *     handler: async (ctx, { sectionId }) => {
 *       ctx.actor;  // authenticated member of exactly one school (server-derived)
 *       const section = await getInSchool(ctx, "sections", sectionId); // tenant check
 *       ...
 *     },
 *   });
 *
 * Every schoolQuery/schoolMutation accepts an optional `membershipId` arg that
 * the client uses to pick which of ITS OWN memberships to act as. It is
 * verified server-side (convex/core/actor.ts) and removed from `args`.
 *
 * `userQuery` / `userMutation` are for the few functions that operate on the
 * global identity before a school is chosen (e.g. listing my memberships).
 *
 * Functions that belong to a configurable MODULE (core/modules.ts) use
 * `moduleQuery(key)` / `moduleMutation(key)` instead: the same actor
 * resolution, then the school's entitlement check (MODULE_DISABLED), before the
 * handler runs. The handler still does its own permission and record-scope
 * checks — an enabled module never grants a permission.
 *
 *   const financeQuery = moduleQuery("finance");
 *   export const overview = financeQuery({ args: {...}, handler: async (ctx, args) => { ... } });
 */
import { customMutation, customQuery, customAction } from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { requireActor, requireAuthenticatedUser } from "./actor";
import type { ModuleKey } from "./modules";
import { requireModule } from "../model/modules";

const membershipArg = { membershipId: v.optional(v.id("schoolMemberships")) };

export const schoolQuery = customQuery(query, {
  args: membershipArg,
  input: async (ctx, { membershipId }) => {
    const actor = await requireActor(ctx, membershipId);
    return { ctx: { actor }, args: {} };
  },
});

export const schoolMutation = customMutation(mutation, {
  args: membershipArg,
  input: async (ctx, { membershipId }) => {
    const actor = await requireActor(ctx, membershipId);
    return { ctx: { actor }, args: {} };
  },
});

/** A school query that also requires the school to have `module` enabled. */
export function moduleQuery(module: ModuleKey) {
  return customQuery(query, {
    args: membershipArg,
    input: async (ctx, { membershipId }) => {
      const actor = await requireActor(ctx, membershipId);
      await requireModule(ctx, actor.schoolId, module);
      return { ctx: { actor }, args: {} };
    },
  });
}

/** A school mutation that also requires the school to have `module` enabled. */
export function moduleMutation(module: ModuleKey) {
  return customMutation(mutation, {
    args: membershipArg,
    input: async (ctx, { membershipId }) => {
      const actor = await requireActor(ctx, membershipId);
      await requireModule(ctx, actor.schoolId, module);
      return { ctx: { actor }, args: {} };
    },
  });
}

export const userQuery = customQuery(query, {
  args: {},
  input: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    return { ctx: { user }, args: {} };
  },
});

export const userMutation = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const user = await requireAuthenticatedUser(ctx);
    return { ctx: { user }, args: {} };
  },
});

/**
 * Actions cannot read the database directly. A school action receives the
 * client's `membershipId` and must authorize by calling an internal query or
 * mutation that uses `requireActor` (the caller's auth is propagated to
 * ctx.runQuery / ctx.runMutation). This builder just passes the selector on.
 */
export const schoolAction = customAction(action, {
  args: membershipArg,
  input: async (_ctx, { membershipId }) => ({ ctx: { membershipId }, args: {} }),
});

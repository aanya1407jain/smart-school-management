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
 */
import { customMutation, customQuery, customAction } from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { requireActor, requireAuthenticatedUser } from "./actor";

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

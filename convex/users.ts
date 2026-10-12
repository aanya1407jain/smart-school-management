/**
 * Identity queries for the frontend session.
 *
 *  - users.session        → THE single source of the browser session: signed
 *                           out / no school access / school selection needed /
 *                           signed in (with the resolved viewer). Never throws
 *                           for those states, so the UI can render them.
 *  - users.me             → who am I + which schools/roles can I act as (no school needed)
 *  - users.viewer         → the resolved actor for the chosen membership: school,
 *                           role, effective permissions and linked people.
 *  - users.studentContext → server check that the caller may view ONE student in
 *                           the student portal (self, or a linked child). Used
 *                           by the guardian child switcher.
 *
 * Role, school and links are always derived here from the Convex Auth session
 * and `schoolMemberships`. The client can only pick one of its OWN memberships
 * (`membershipId`); it can never claim a role.
 */
import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { schoolQuery } from "./core/functions";
import { activeMembershipsOf, getCurrentUser, requireActor, type Actor } from "./core/actor";
import { linkedStudentIds, requireGuardianStudentAccess } from "./core/authorization";
import { AppError } from "./core/errors";
import { fullName, teacherDisplayName } from "./model/academics";

async function membershipsOf(ctx: QueryCtx, userId: Id<"users">) {
  const memberships = await activeMembershipsOf(ctx, userId);
  return memberships.map(({ membership: m, school }) => ({
    membershipId: m._id,
    schoolId: school._id,
    schoolName: school.name,
    schoolSlug: school.slug,
    role: m.role,
    displayName: m.displayName,
    isGuardian: !!m.guardianId,
  }));
}

/** The viewer object for a resolved actor (shared by `viewer` and `session`). */
async function buildViewer(ctx: QueryCtx, actor: Actor) {
  const school = (await ctx.db.get(actor.schoolId))!;
  const teacher = actor.teacherId ? await ctx.db.get(actor.teacherId) : null;
  const guardian = actor.guardianId ? await ctx.db.get(actor.guardianId) : null;
  const studentIds = await linkedStudentIds(ctx, actor);
  const students = [];
  for (const id of studentIds) {
    const s = await ctx.db.get(id);
    if (s && s.schoolId === actor.schoolId) students.push({ studentId: s._id, name: fullName(s), admissionNo: s.admissionNo });
  }
  return {
    userId: actor.userId,
    membershipId: actor.membershipId,
    role: actor.role,
    displayName: actor.displayName,
    email: actor.email,
    permissions: [...actor.permissions].sort(),
    permissionSets: [...actor.permissionSets],
    isGuardian: !!actor.guardianId,
    school: { _id: school._id, name: school.name, shortName: school.shortName, slug: school.slug, timezone: school.timezone, locale: school.locale, currency: school.currency },
    teacher: teacher && teacher.schoolId === actor.schoolId ? { teacherId: teacher._id, name: teacherDisplayName(teacher) } : null,
    /** Set when this membership IS a student. */
    student: actor.studentId ? (students.find((s) => s.studentId === actor.studentId) ?? null) : null,
    /** Set when this membership is a guardian using the student portal. */
    guardian: guardian && guardian.schoolId === actor.schoolId ? { guardianId: guardian._id, name: guardian.name } : null,
    /** Students this member can view in the student portal (self, or linked children). */
    students,
  };
}

export type Viewer = Awaited<ReturnType<typeof buildViewer>>;

/** Returns null when signed out (does not throw) so the UI can render a login screen. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return { userId: user._id, email: user.email ?? null, name: user.name ?? null, memberships: await membershipsOf(ctx, user._id) };
  },
});

export const viewer = schoolQuery({
  args: {},
  handler: async (ctx) => buildViewer(ctx, ctx.actor),
});

/**
 * The browser session in one call. `membershipId` only CHOOSES among the
 * caller's own memberships (verified by `requireActor`).
 */
export const session = query({
  args: { membershipId: v.optional(v.id("schoolMemberships")) },
  handler: async (ctx, { membershipId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "signedOut" as const };
    const memberships = await membershipsOf(ctx, user._id);
    try {
      const actor = await requireActor(ctx, membershipId);
      return { status: "signedIn" as const, viewer: await buildViewer(ctx, actor), memberships };
    } catch (e) {
      if (e instanceof AppError && (e.data.code === "NO_SCHOOL_ACCESS" || e.data.code === "SCHOOL_SELECTION_REQUIRED")) {
        return { status: "noSchool" as const, code: e.data.code, message: e.data.message, memberships };
      }
      throw e;
    }
  },
});

/**
 * Student-portal context for one student. Only the student themself or a
 * guardian linked to them passes; anything else (another family's child,
 * another school's id) is NOT_FOUND, exactly like the data functions.
 */
export const studentContext = schoolQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const student = await requireGuardianStudentAccess(ctx, studentId);
    return {
      studentId: student._id,
      name: fullName(student),
      admissionNo: student.admissionNo,
      relation: ctx.actor.studentId === student._id ? ("self" as const) : ("guardian" as const),
    };
  },
});

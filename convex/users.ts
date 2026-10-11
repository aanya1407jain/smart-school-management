/**
 * Identity queries for the frontend session.
 *
 *  - users.me        → who am I + which schools/roles can I act as (no school needed)
 *  - users.viewer    → the resolved actor for the chosen membership: school,
 *                      role, effective permissions and linked people. This is
 *                      what replaces the Stage 1 mock session.
 */
import { query } from "./_generated/server";
import { schoolQuery } from "./core/functions";
import { activeMembershipsOf, getCurrentUser } from "./core/actor";
import { linkedStudentIds } from "./core/authorization";
import { fullName, teacherDisplayName } from "./model/academics";

/** Returns null when signed out (does not throw) so the UI can render a login screen. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const memberships = await activeMembershipsOf(ctx, user._id);
    return {
      userId: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      memberships: memberships.map(({ membership: m, school }) => ({
        membershipId: m._id,
        schoolId: school._id,
        schoolName: school.name,
        schoolSlug: school.slug,
        role: m.role,
        displayName: m.displayName,
        isGuardian: !!m.guardianId,
      })),
    };
  },
});

export const viewer = schoolQuery({
  args: {},
  handler: async (ctx) => {
    const { actor } = ctx;
    const school = (await ctx.db.get(actor.schoolId))!;
    const teacher = actor.teacherId ? await ctx.db.get(actor.teacherId) : null;
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
      teacher: teacher ? { teacherId: teacher._id, name: teacherDisplayName(teacher) } : null,
      /** Students this member can view in the student portal (self, or linked children). */
      students,
    };
  },
});

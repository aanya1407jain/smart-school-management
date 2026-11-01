/**
 * Student-portal identity (Students): the signed-in student a portal request
 * is about, resolved entirely on the server.
 *
 *   Convex Auth session → users → schoolMemberships (role "student")
 *     → membership.studentId → students → enrollments (current academic year)
 *
 * `studentId` is OPTIONAL; when given it must be the signed-in student's own id
 * — anything else is NOT_FOUND, like every other student-data function. Used by
 * convex/studentPortal.ts and by the module portal queries (timetable,
 * homework, results, fees), which all require Students.
 */
import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Actor } from "../core/actor";
import type { Permission } from "../core/permissions";
import { linkedStudentIds, requireOwnStudentAccess, requirePermission } from "../core/authorization";
import { currentYear, placement } from "./studentRecords";

type Ctx = QueryCtx & { actor: Actor };

export const vPortalStudent = { studentId: v.optional(v.id("students")) };

/** The signed-in student (never a browser-supplied id on its own). */
export async function resolvePortalStudent(ctx: Ctx, studentId: Id<"students"> | undefined, permission: Permission): Promise<Doc<"students"> | null> {
  requirePermission(ctx.actor, "area:student");
  requirePermission(ctx.actor, permission);
  if (studentId) return await requireOwnStudentAccess(ctx, studentId);
  for (const id of await linkedStudentIds(ctx, ctx.actor)) {
    const s = await ctx.db.get(id);
    if (s && s.schoolId === ctx.actor.schoolId) return s;
  }
  return null;
}

/** The student's active section in the current year (null when not actively enrolled). */
export async function activeSection(ctx: Ctx, student: Doc<"students">) {
  const year = await currentYear(ctx, ctx.actor.schoolId);
  const { row } = await placement(ctx, student, year);
  if (!year || !row || row.status !== "active") return { year, row, section: null };
  const section = await ctx.db.get(row.sectionId);
  return { year, row, section: section && section.schoolId === ctx.actor.schoolId ? section : null };
}

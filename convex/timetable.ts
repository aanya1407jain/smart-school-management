/**
 * Timetable (A-04): the bell schedule (`periods`) and lessons
 * (`timetableEntries`: section × weekday × period → subject + teacher + room).
 *
 * Writes need `timetable:manage` (admin). Every lesson is validated:
 *  - the section, subject, teacher and period belong to the caller's school;
 *    the period is not a break; the weekday is a configured working day;
 *  - the subject is in the class curriculum for the section's year;
 *  - the teacher holds a persisted assignment for that subject in that section;
 *  - no clash: one lesson per section per slot (an existing lesson in the
 *    slot is REPLACED), a teacher in one place per slot, a room used by one
 *    section per slot (rooms are compared case-insensitively). Clashes are
 *    only checked within the same academic year.
 * Reads: admins any section; teachers their own week and sections in their
 * scope; students/guardians use studentPortal.myTimetable.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, getSchoolSettings, hasPermission, isSubjectTeacherOf, requirePermission, requireSectionRead } from "./core/authorization";
import { conflict, forbidden, invalid, invalidRelationship } from "./core/errors";
import { assertNonEmpty, assertTime } from "./core/validators";
import { subjectInCurriculum, teacherDisplayName } from "./model/academics";
import { timetableFor } from "./model/studentRecords";
import { writeAudit } from "./model/audit";

const roomKey = (room?: string) => room?.trim().toLowerCase() || null;

// ================================================================ periods
export const listPeriods = schoolQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    return rows.map((p) => ({ periodId: p._id, index: p.index, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }));
  },
});

/** Create or edit one period. Positions are unique; periods may not overlap in time. */
export const upsertPeriod = schoolMutation({
  args: { periodId: v.optional(v.id("periods")), index: v.number(), label: v.string(), startTime: v.string(), endTime: v.string(), isBreak: v.boolean() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "timetable:manage");
    if (!Number.isInteger(a.index) || a.index < 1 || a.index > 20) throw invalid("Position must be a whole number from 1 to 20.", { index: "Invalid" });
    assertTime(a.startTime, "startTime");
    assertTime(a.endTime, "endTime");
    if (a.startTime >= a.endTime) throw invalid("A period must end after it starts.", { endTime: "Before start" });
    const label = assertNonEmpty(a.label, "label", 40);
    const existing = a.periodId ? await getInSchool(ctx, "periods", a.periodId, "Period") : null;
    const all = await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    const others = all.filter((p) => p._id !== existing?._id);
    if (others.some((p) => p.index === a.index)) throw conflict(`Position ${a.index} is already used.`);
    const overlap = others.find((p) => p.startTime < a.endTime && a.startTime < p.endTime);
    if (overlap) throw conflict(`Overlaps ${overlap.label} (${overlap.startTime}–${overlap.endTime}).`);
    if (existing && a.isBreak && !existing.isBreak) {
      const used = await ctx.db.query("timetableEntries").withIndex("by_school_day_period", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
      if (used.some((e) => e.periodId === existing._id)) throw conflict("Lessons are scheduled in this period; remove them before turning it into a break.");
    }
    const doc = { index: a.index, label, startTime: a.startTime, endTime: a.endTime, isBreak: a.isBreak };
    let periodId: Id<"periods">;
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      periodId = existing._id;
    } else {
      periodId = await ctx.db.insert("periods", { schoolId: ctx.actor.schoolId, ...doc });
    }
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: existing ? "timetable.period_updated" : "timetable.period_created", entity: { table: "periods", id: periodId }, summary: `${existing ? "Updated" : "Added"} period ${label} (${a.startTime}–${a.endTime})` });
    return { periodId };
  },
});

export const removePeriod = schoolMutation({
  args: { periodId: v.id("periods") },
  handler: async (ctx, { periodId }) => {
    requirePermission(ctx.actor, "timetable:manage");
    const period = await getInSchool(ctx, "periods", periodId, "Period");
    const used = await ctx.db.query("timetableEntries").withIndex("by_school_day_period", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    if (used.some((e) => e.periodId === period._id)) throw conflict("Lessons are scheduled in this period; remove them first.");
    await ctx.db.delete(period._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "timetable.period_removed", entity: { table: "periods", id: period._id }, summary: `Removed period ${period.label}` });
    return { ok: true };
  },
});

// ================================================================ lessons
/** Place (or replace) the lesson in one section slot. */
export const setEntry = schoolMutation({
  args: {
    sectionId: v.id("sections"), dayOfWeek: v.number(), periodId: v.id("periods"),
    subjectId: v.id("subjects"), teacherId: v.id("teachers"), room: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "timetable:manage");
    const section = await getInSchool(ctx, "sections", a.sectionId, "Section");
    const period = await getInSchool(ctx, "periods", a.periodId, "Period");
    const subject = await getInSchool(ctx, "subjects", a.subjectId, "Subject");
    const teacher = await getInSchool(ctx, "teachers", a.teacherId, "Teacher");
    if (!Number.isInteger(a.dayOfWeek) || a.dayOfWeek < 0 || a.dayOfWeek > 6) throw invalid("dayOfWeek must be 0 (Sunday) to 6 (Saturday).", { dayOfWeek: "Invalid" });
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    if (!settings.workingDays.includes(a.dayOfWeek)) throw invalid("That weekday is not a working day of the school.", { dayOfWeek: "Not a working day" });
    if (period.isBreak) throw invalid(`${period.label} is a break.`, { periodId: "Break" });
    if (teacher.status === "inactive") throw invalidRelationship(`${teacherDisplayName(teacher)} is not an active teacher.`);
    if (!(await subjectInCurriculum(ctx, section.classId, section.academicYearId, subject._id))) throw invalidRelationship(`${subject.name} is not part of ${section.displayName}'s curriculum.`);
    if (!(await isSubjectTeacherOf(ctx, teacher._id, section._id, subject._id))) {
      throw invalidRelationship(`${teacherDisplayName(teacher)} is not assigned to teach ${subject.name} in ${section.displayName}.`);
    }
    const room = a.room?.trim() ? assertNonEmpty(a.room, "room", 40) : undefined;

    // Clash checks within the same academic year.
    const slot = (await ctx.db.query("timetableEntries").withIndex("by_school_day_period", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("dayOfWeek", a.dayOfWeek).eq("periodId", period._id)).collect())
      .filter((e) => e.academicYearId === section.academicYearId);
    const current = slot.find((e) => e.sectionId === section._id) ?? null;
    const busyTeacher = slot.find((e) => e._id !== current?._id && e.teacherId === teacher._id);
    if (busyTeacher) {
      const other = await ctx.db.get(busyTeacher.sectionId);
      throw conflict(`${teacherDisplayName(teacher)} already teaches ${other?.displayName ?? "another section"} in this slot.`);
    }
    if (room) {
      const busyRoom = slot.find((e) => e._id !== current?._id && roomKey(e.room) === roomKey(room));
      if (busyRoom) {
        const other = await ctx.db.get(busyRoom.sectionId);
        throw conflict(`Room ${room} is already used by ${other?.displayName ?? "another section"} in this slot.`);
      }
    }
    const doc = { subjectId: subject._id, teacherId: teacher._id, room };
    let entryId: Id<"timetableEntries">;
    if (current) {
      await ctx.db.patch(current._id, doc);
      entryId = current._id;
    } else {
      entryId = await ctx.db.insert("timetableEntries", { schoolId: ctx.actor.schoolId, academicYearId: section.academicYearId, sectionId: section._id, dayOfWeek: a.dayOfWeek, periodId: period._id, ...doc });
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: current ? "timetable.entry_replaced" : "timetable.entry_created",
      entity: { table: "timetableEntries", id: entryId }, summary: `${section.displayName}: ${subject.name} with ${teacherDisplayName(teacher)} (day ${a.dayOfWeek}, ${period.label})`,
    });
    return { entryId, replaced: !!current };
  },
});

export const removeEntry = schoolMutation({
  args: { entryId: v.id("timetableEntries") },
  handler: async (ctx, { entryId }) => {
    requirePermission(ctx.actor, "timetable:manage");
    const entry = await getInSchool(ctx, "timetableEntries", entryId, "Lesson");
    await ctx.db.delete(entry._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "timetable.entry_removed", entity: { table: "timetableEntries", id: entry._id }, summary: `Removed a lesson (day ${entry.dayOfWeek})` });
    return { ok: true };
  },
});

/** A section's week (admin: any section; teachers: sections in their scope). */
export const sectionTimetable = schoolQuery({
  args: { sectionId: v.id("sections") },
  handler: async (ctx, { sectionId }) => {
    const section = await requireSectionRead(ctx, sectionId, { all: "timetable:manage", assigned: "timetable:read:own" });
    return { section: { sectionId: section._id, displayName: section.displayName }, ...(await timetableFor(ctx, section)) };
  },
});

/** The calling teacher's own week across sections. */
export const myTimetable = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "timetable:read:own");
    if (!ctx.actor.teacherId) throw forbidden("Only teachers have a teaching timetable.");
    const periods = await ctx.db.query("periods").withIndex("by_school_index", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect();
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    const rows = (await ctx.db.query("timetableEntries").withIndex("by_teacher_day_period", (q) => q.eq("teacherId", ctx.actor.teacherId!)).collect())
      .filter((e) => e.schoolId === ctx.actor.schoolId && (!settings.currentAcademicYearId || e.academicYearId === settings.currentAcademicYearId));
    const lessons = [];
    for (const e of rows) {
      const [section, subject] = [await ctx.db.get(e.sectionId), await ctx.db.get(e.subjectId)];
      lessons.push({ entryId: e._id, dayOfWeek: e.dayOfWeek, periodId: e.periodId, sectionId: e.sectionId, section: (section as Doc<"sections"> | null)?.displayName ?? "", subject: subject?.name ?? "", room: e.room ?? null });
    }
    return { periods: periods.map((p) => ({ periodId: p._id, index: p.index, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak })), lessons };
  },
});

/** Whether the caller can manage the timetable (UI helper; the mutations check again). */
export const canManage = schoolQuery({ args: {}, handler: async (ctx) => hasPermission(ctx.actor, "timetable:manage") });

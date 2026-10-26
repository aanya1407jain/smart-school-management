/**
 * Student attendance — the first fully server-enforced workflow.
 *
 * OWNERSHIP RULE (do not weaken):
 *   Only the CLASS TEACHER of a section (sections.classTeacherId === actor.teacherId)
 *   may MARK (create) or EDIT (correct) that section's attendance.
 *   - Subject teachers of the section: view only.
 *   - Admin / Principal: view, monitoring and reports only.
 *   - Students: own records only.
 *   - There is no delete.
 *
 * Enforcement lives in `requireClassTeacher` (convex/core/authorization.ts),
 * which re-reads the section inside the same transaction as the write.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { moduleQuery, moduleMutation } from "./core/functions";
import {
  getSchoolSettings, hasPermission, isClassTeacherOf, requireAnyPermission, requireClassTeacher,
  requireSectionRead, requireStudentAccess, readScopeSectionIds, getCurrentAcademicYearId,
} from "./core/authorization";
import type { Actor } from "./core/actor";
import { conflict, invalid, invalidRelationship, notFound } from "./core/errors";
import { assertIsoDate, vAttendanceStatus, type AttendanceStatusValue } from "./core/validators";
import { activeRoster, classTeacherOf, fullName, teacherDisplayName } from "./model/academics";
import { addDays, daysBetween, isSchoolDay, MAX_RANGE_DAYS, todayIn } from "./model/calendar";
import { writeAudit } from "./model/audit";
import { notifyUsers, userIdsForStudent } from "./model/notifications";

const attendanceQuery = moduleQuery("attendance");
const attendanceMutation = moduleMutation("attendance");

const READ = { all: "attendance:read:all", assigned: "attendance:read:assigned" } as const;
const vEntry = v.object({ studentId: v.id("students"), status: vAttendanceStatus, remark: v.optional(v.string()) });

function readOnlyReason(actor: Actor, section: Doc<"sections">, classTeacher: Doc<"teachers"> | null): string | null {
  if (isClassTeacherOf(actor, section)) return null;
  if (hasPermission(actor, "attendance:read:all") && !actor.teacherId) {
    return "Administrators can view and monitor attendance but cannot mark or edit it.";
  }
  const owner = classTeacher ? teacherDisplayName(classTeacher) : "the class teacher";
  return `Only the class teacher of ${section.displayName} (${owner}) can mark or edit its attendance.`;
}

async function sessionFor(ctx: QueryCtx, sectionId: Id<"sections">, date: string): Promise<Doc<"attendanceSessions"> | null> {
  return await ctx.db
    .query("attendanceSessions")
    .withIndex("by_section_date", (q) => q.eq("sectionId", sectionId).eq("date", date))
    .unique();
}

function assertRange(from: string, to: string) {
  if (from > to) throw invalid("`from` must not be after `to`", { from: "After to" });
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    throw invalid(`Date ranges are limited to ${MAX_RANGE_DAYS} days. Request one academic year at a time.`, { to: "Range too long" });
  }
}

function summarize(statuses: AttendanceStatusValue[]) {
  return {
    presentCount: statuses.filter((s) => s === "present").length,
    absentCount: statuses.filter((s) => s === "absent").length,
    lateCount: statuses.filter((s) => s === "late").length,
    excusedCount: statuses.filter((s) => s === "excused").length,
  };
}

// ================================================================ queries
/**
 * The register for one section on one date (marked or not), plus what the
 * caller may do with it. Readable by admins (all sections) and by teachers
 * whose scope includes the section (class teacher or subject teacher).
 *
 * `today` is the client's current date in the SCHOOL's timezone
 * (`users.viewer().school.timezone`). Queries must not read the clock, so the
 * caller supplies it; it only affects the `canMark` hint for future dates.
 * `mark` re-checks the real date on the server, so a wrong `today` can never
 * allow marking a future date.
 */
export const getByDate = attendanceQuery({
  args: { sectionId: v.id("sections"), date: v.string(), today: v.string() },
  handler: async (ctx, { sectionId, date, today }) => {
    assertIsoDate(date);
    assertIsoDate(today, "today");
    const section = await requireSectionRead(ctx, sectionId, READ);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const settings = await getSchoolSettings(ctx, school._id);
    const classTeacher = await classTeacherOf(ctx, section);
    const session = await sessionFor(ctx, section._id, date);
    const roster = await activeRoster(ctx, section._id);

    const records = new Map<Id<"students">, Doc<"attendanceRecords">>();
    if (session) {
      const rows = await ctx.db.query("attendanceRecords").withIndex("by_session_student", (q) => q.eq("sessionId", session._id)).collect();
      rows.forEach((r) => records.set(r.studentId, r));
    }

    const owner = isClassTeacherOf(ctx.actor, section);
    const schoolDay = await isSchoolDay(ctx, school, settings, date);
    const writableDate = schoolDay && date <= today;

    return {
      section: { _id: section._id, displayName: section.displayName, academicYearId: section.academicYearId },
      date,
      isSchoolDay: schoolDay,
      classTeacher: classTeacher ? { _id: classTeacher._id, name: teacherDisplayName(classTeacher) } : null,
      isClassTeacher: owner,
      canMark: owner && !session && writableDate && hasPermission(ctx.actor, "attendance:mark:class_teacher"),
      canEdit: owner && !!session && hasPermission(ctx.actor, "attendance:edit:class_teacher"),
      readOnlyReason: readOnlyReason(ctx.actor, section, classTeacher),
      session: session
        ? {
            _id: session._id, markedAt: session.markedAt, lastEditedAt: session.lastEditedAt ?? null,
            presentCount: session.presentCount, absentCount: session.absentCount, lateCount: session.lateCount, excusedCount: session.excusedCount,
          }
        : null,
      students: roster.map(({ student, enrollment }) => {
        const r = records.get(student._id);
        return { studentId: student._id, name: fullName(student), admissionNo: student.admissionNo, rollNo: enrollment.rollNo ?? null, status: r?.status ?? null, remark: r?.remark ?? null };
      }),
    };
  },
});

/**
 * Register summaries for a section over a date range of at most
 * MAX_RANGE_DAYS. One register per school day, so the result is bounded by the
 * range (≤ 366 rows) and is never silently truncated.
 */
export const listBySection = attendanceQuery({
  args: { sectionId: v.id("sections"), from: v.string(), to: v.string() },
  handler: async (ctx, { sectionId, from, to }) => {
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");
    assertRange(from, to);
    const section = await requireSectionRead(ctx, sectionId, READ);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_section_date", (q) => q.eq("sectionId", section._id).gte("date", from).lte("date", to))
      .collect();
    return sessions.map((s) => ({
      _id: s._id, date: s.date, presentCount: s.presentCount, absentCount: s.absentCount, lateCount: s.lateCount,
      excusedCount: s.excusedCount, markedAt: s.markedAt, lastEditedAt: s.lastEditedAt ?? null,
    }));
  },
});

/**
 * One student's attendance history. Admin: any; teacher: students in scope;
 * student: own.
 *
 * Range: defaults to the current academic year. With only `from` or only `to`
 * the other end is MAX_RANGE_DAYS away. Ranges longer than MAX_RANGE_DAYS are
 * rejected (request one academic year at a time) — never silently truncated.
 */
export const studentHistory = attendanceQuery({
  args: { studentId: v.id("students"), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.from) assertIsoDate(args.from, "from");
    if (args.to) assertIsoDate(args.to, "to");
    const student = await requireStudentAccess(ctx, args.studentId, { all: "attendance:read:all", assigned: "attendance:read:assigned", own: "attendance:read:own" });
    const settings = await getSchoolSettings(ctx, ctx.actor.schoolId);
    let from = args.from;
    let to = args.to;
    if (!from && !to) {
      const year = await ctx.db.get(await getCurrentAcademicYearId(ctx, ctx.actor.schoolId));
      from = year!.startDate;
      to = year!.endDate;
    } else if (!to) to = addDays(from!, MAX_RANGE_DAYS - 1);
    else if (!from) from = addDays(to, -(MAX_RANGE_DAYS - 1));
    assertRange(from!, to);
    const records = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_student_date", (q) => q.eq("studentId", student._id).gte("date", from!).lte("date", to!))
      .collect();
    const counted = records.filter((r) => r.status !== "excused");
    const attended = counted.filter((r) => r.status === "present" || (r.status === "late" && settings.attendance.lateCountsAsPresent)).length;
    return {
      studentId: student._id,
      name: fullName(student),
      range: { from: from!, to: to! },
      percentage: counted.length ? Math.round((attended / counted.length) * 1000) / 10 : null,
      lowAttendanceThreshold: settings.attendance.lowAttendanceThreshold,
      totals: summarize(records.map((r) => r.status)),
      records: records.map((r) => ({ date: r.date, status: r.status, remark: r.remark ?? null })),
    };
  },
});

/** School-wide (admin) or teacher-scope overview of which registers are marked on a date. */
export const dailyOverview = attendanceQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    assertIsoDate(date);
    const perm = requireAnyPermission(ctx.actor, ["attendance:read:all", "attendance:read:assigned"]);
    const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
    let sections = await ctx.db
      .query("sections")
      .withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId))
      .collect();
    if (perm === "attendance:read:assigned") {
      const scope = await readScopeSectionIds(ctx, ctx.actor, yearId);
      sections = sections.filter((s) => scope.has(s._id));
    }
    const sessions = await ctx.db.query("attendanceSessions").withIndex("by_school_date", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("date", date)).collect();
    const bySection = new Map(sessions.map((s) => [s.sectionId, s]));
    sections.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
    return sections.map((s) => {
      const session = bySection.get(s._id);
      return {
        sectionId: s._id,
        displayName: s.displayName,
        isClassTeacher: isClassTeacherOf(ctx.actor, s),
        marked: !!session,
        presentCount: session?.presentCount ?? null,
        absentCount: session?.absentCount ?? null,
        lateCount: session?.lateCount ?? null,
      };
    });
  },
});

// ================================================================ mutations
/** Validate that `entries` covers the section's active roster exactly once. */
async function validateEntries(ctx: Parameters<typeof activeRoster>[0], sectionId: Id<"sections">, entries: { studentId: Id<"students"> }[], { requireAll }: { requireAll: boolean }) {
  const roster = await activeRoster(ctx, sectionId);
  const rosterIds = new Set(roster.map((r) => r.student._id));
  const seen = new Set<Id<"students">>();
  for (const e of entries) {
    if (seen.has(e.studentId)) throw invalid("A student appears more than once in the register.");
    seen.add(e.studentId);
    if (!rosterIds.has(e.studentId)) throw invalidRelationship("A student in the register is not actively enrolled in this section.");
  }
  if (requireAll && seen.size !== rosterIds.size) throw invalid("Mark every student in the section before saving.");
  return roster;
}

/** Create the register for a school day (class teacher only). */
export const mark = attendanceMutation({
  args: { sectionId: v.id("sections"), date: v.string(), entries: v.array(vEntry) },
  handler: async (ctx, { sectionId, date, entries }) => {
    assertIsoDate(date);
    const section = await requireClassTeacher(ctx, sectionId, "attendance:mark:class_teacher");
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    const settings = await getSchoolSettings(ctx, school._id);
    if (date > todayIn(school.timezone)) throw invalid("Attendance cannot be marked for a future date.", { date: "Future date" });
    if (!(await isSchoolDay(ctx, school, settings, date))) throw invalid("Attendance can only be marked on school days.", { date: "Not a school day" });
    if (await sessionFor(ctx, section._id, date)) throw conflict("Attendance for this date is already marked. Use update to correct it.");
    await validateEntries(ctx, section._id, entries, { requireAll: true });

    const now = Date.now();
    const sessionId = await ctx.db.insert("attendanceSessions", {
      schoolId: school._id, academicYearId: section.academicYearId, sectionId: section._id, date,
      markedByUserId: ctx.actor.userId, markedByTeacherId: ctx.actor.teacherId!, markedAt: now,
      ...summarize(entries.map((e) => e.status)),
    });
    for (const e of entries) {
      await ctx.db.insert("attendanceRecords", {
        schoolId: school._id, sessionId, sectionId: section._id, studentId: e.studentId, date, status: e.status,
        ...(e.remark?.trim() ? { remark: e.remark.trim().slice(0, 200) } : {}),
      });
    }
    await writeAudit(ctx, {
      schoolId: school._id, actor: ctx.actor, action: "attendance.marked",
      entity: { table: "attendanceSessions", id: sessionId },
      summary: `Marked ${section.displayName} attendance for ${date}`,
      metadata: summarize(entries.map((e) => e.status)),
    });
    if (settings.notifications.attendanceAlerts) {
      for (const e of entries.filter((x) => x.status === "absent")) {
        await notifyUsers(ctx, school._id, await userIdsForStudent(ctx, school._id, e.studentId), {
          type: "attendance", title: "Marked absent", message: `Marked absent on ${date} in ${section.displayName}.`,
          href: "/student/attendance", entity: { table: "attendanceSessions", id: sessionId },
        });
      }
    }
    return { sessionId };
  },
});

/** Correct an existing register (class teacher only). Only the listed students change. */
export const update = attendanceMutation({
  args: { sectionId: v.id("sections"), date: v.string(), changes: v.array(vEntry) },
  handler: async (ctx, { sectionId, date, changes }) => {
    assertIsoDate(date);
    if (changes.length === 0) throw invalid("Nothing to update.");
    const section = await requireClassTeacher(ctx, sectionId, "attendance:edit:class_teacher");
    const session = await sessionFor(ctx, section._id, date);
    if (!session) throw notFound("Attendance register");
    await validateEntries(ctx, section._id, changes, { requireAll: false });

    const diff: { studentId: Id<"students">; from: string | null; to: string }[] = [];
    for (const c of changes) {
      const existing = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_session_student", (q) => q.eq("sessionId", session._id).eq("studentId", c.studentId))
        .unique();
      const remark = c.remark?.trim() ? c.remark.trim().slice(0, 200) : undefined;
      if (existing) {
        if (existing.status === c.status && existing.remark === remark) continue;
        diff.push({ studentId: c.studentId, from: existing.status, to: c.status });
        await ctx.db.patch(existing._id, { status: c.status, remark });
      } else {
        // Student enrolled after the register was taken.
        diff.push({ studentId: c.studentId, from: null, to: c.status });
        await ctx.db.insert("attendanceRecords", { schoolId: session.schoolId, sessionId: session._id, sectionId: section._id, studentId: c.studentId, date, status: c.status, remark });
      }
    }
    if (diff.length === 0) return { changed: 0 };

    const all = await ctx.db.query("attendanceRecords").withIndex("by_session_student", (q) => q.eq("sessionId", session._id)).collect();
    await ctx.db.patch(session._id, { ...summarize(all.map((r) => r.status)), lastEditedByUserId: ctx.actor.userId, lastEditedAt: Date.now() });
    await writeAudit(ctx, {
      schoolId: session.schoolId, actor: ctx.actor, action: "attendance.corrected",
      entity: { table: "attendanceSessions", id: session._id },
      summary: `Corrected ${section.displayName} attendance for ${date} (${diff.length} change${diff.length === 1 ? "" : "s"})`,
      metadata: { changes: diff },
    });
    return { changed: diff.length };
  },
});

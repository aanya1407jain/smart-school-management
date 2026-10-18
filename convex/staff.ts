/**
 * Staff attendance and leave (A-05) — the requirements list "staff
 * attendance, and leave management" under Teacher & Staff Management. This is
 * deliberately NOT payroll/HR: one daily status per teacher and leave
 * applications with an approve/reject decision.
 *
 *  - `staff:manage` (admin) marks daily staff attendance, lists leave and
 *    decides on pending requests.
 *  - A teacher applies for leave for THEMSELF only (their membership's teacher
 *    record), sees their own requests and may withdraw a pending one.
 *  - Overlapping pending/approved leave is rejected. Approving leave does not
 *    rewrite attendance that was already marked; staffAttendanceByDate shows
 *    approved leave next to each teacher and an `on_leave` mark is linked to it.
 * Decisions notify the teacher once (in-app).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schoolMutation, schoolQuery } from "./core/functions";
import { getInSchool, requirePermission } from "./core/authorization";
import { conflict, forbidden, invalid } from "./core/errors";
import { assertIsoDate, assertNonEmpty, vLeaveType, vStaffAttendanceStatus } from "./core/validators";
import { teacherDisplayName } from "./model/academics";
import { daysBetween, todayIn } from "./model/calendar";
import { writeAudit } from "./model/audit";
import { notifyUsers } from "./model/notifications";

const MAX_LEAVE_DAYS = 90;

async function approvedLeaveOn(ctx: Parameters<typeof getInSchool>[0], teacherId: Id<"teachers">, date: string) {
  const rows = await ctx.db.query("leaveRequests").withIndex("by_teacher_from", (q) => q.eq("teacherId", teacherId).lte("fromDate", date)).collect();
  return rows.find((r) => r.schoolId === ctx.actor.schoolId && r.status === "approved" && r.toDate >= date) ?? null;
}

// ================================================================ staff attendance
/** Every active teacher's status on a date (marked, or suggested from approved leave). */
export const staffAttendanceByDate = schoolQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    requirePermission(ctx.actor, "staff:manage");
    assertIsoDate(date);
    const teachers = (await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect()).filter((t) => t.status !== "inactive");
    const marked = await ctx.db.query("staffAttendance").withIndex("by_school_date", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("date", date)).collect();
    const byTeacher = new Map(marked.map((m) => [m.teacherId, m]));
    const out = [];
    for (const t of teachers) {
      const m = byTeacher.get(t._id);
      const leave = await approvedLeaveOn(ctx, t._id, date);
      out.push({ teacherId: t._id, name: teacherDisplayName(t), employeeId: t.employeeId, status: m?.status ?? null, note: m?.note ?? null, approvedLeave: leave ? { leaveRequestId: leave._id, type: leave.type } : null });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const markStaffAttendance = schoolMutation({
  args: { date: v.string(), entries: v.array(v.object({ teacherId: v.id("teachers"), status: vStaffAttendanceStatus, note: v.optional(v.string()) })) },
  handler: async (ctx, { date, entries }) => {
    requirePermission(ctx.actor, "staff:manage");
    assertIsoDate(date);
    const school = (await ctx.db.get(ctx.actor.schoolId))!;
    if (date > todayIn(school.timezone)) throw invalid("Staff attendance cannot be marked for a future date.", { date: "Future date" });
    if (entries.length === 0) throw invalid("Nothing to save.");
    if (new Set(entries.map((e) => e.teacherId)).size !== entries.length) throw invalid("A teacher is listed twice.");
    let changed = 0;
    for (const e of entries) {
      const teacher = await getInSchool(ctx, "teachers", e.teacherId, "Teacher");
      const note = e.note?.trim() ? assertNonEmpty(e.note, "note", 200) : undefined;
      const leave = e.status === "on_leave" ? await approvedLeaveOn(ctx, teacher._id, date) : null;
      const existing = (await ctx.db.query("staffAttendance").withIndex("by_teacher_date", (q) => q.eq("teacherId", teacher._id).eq("date", date)).collect()).find((r) => r.schoolId === ctx.actor.schoolId);
      const doc = { status: e.status, note, leaveRequestId: leave?._id, markedByUserId: ctx.actor.userId };
      if (existing) {
        if (existing.status === e.status && existing.note === note) continue;
        await ctx.db.patch(existing._id, doc);
      } else {
        await ctx.db.insert("staffAttendance", { schoolId: ctx.actor.schoolId, teacherId: teacher._id, date, ...doc });
      }
      changed++;
    }
    if (changed) await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "staff_attendance.marked", entity: { table: "schools", id: ctx.actor.schoolId }, summary: `Staff attendance for ${date}: ${changed} change(s)`, metadata: { date, changed } });
    return { changed };
  },
});

// ================================================================ leave
function leaveView(r: Doc<"leaveRequests">, teacherName: string) {
  return { leaveRequestId: r._id, teacherId: r.teacherId, teacher: teacherName, type: r.type, fromDate: r.fromDate, toDate: r.toDate, reason: r.reason, status: r.status, decidedAt: r.decidedAt ?? null, decisionNote: r.decisionNote ?? null, appliedAt: r._creationTime };
}

/** A teacher applies for their own leave. */
export const applyLeave = schoolMutation({
  args: { type: vLeaveType, fromDate: v.string(), toDate: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    if (!ctx.actor.teacherId) throw forbidden("Only staff with a teacher record can apply for leave.");
    const teacher = await getInSchool(ctx, "teachers", ctx.actor.teacherId, "Teacher");
    assertIsoDate(a.fromDate, "fromDate");
    assertIsoDate(a.toDate, "toDate");
    if (a.toDate < a.fromDate) throw invalid("Leave cannot end before it starts.", { toDate: "Before start" });
    if (daysBetween(a.fromDate, a.toDate) + 1 > MAX_LEAVE_DAYS) throw invalid(`At most ${MAX_LEAVE_DAYS} days per request.`, { toDate: "Too long" });
    const reason = assertNonEmpty(a.reason, "reason", 500);
    const mine = await ctx.db.query("leaveRequests").withIndex("by_teacher_from", (q) => q.eq("teacherId", teacher._id).lte("fromDate", a.toDate)).collect();
    if (mine.some((r) => r.schoolId === ctx.actor.schoolId && r.status !== "rejected" && r.toDate >= a.fromDate)) throw conflict("You already have leave pending or approved in these dates.");
    const leaveRequestId = await ctx.db.insert("leaveRequests", {
      schoolId: ctx.actor.schoolId, teacherId: teacher._id, type: a.type, fromDate: a.fromDate, toDate: a.toDate, reason, status: "pending", requestedByUserId: ctx.actor.userId,
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "leave.requested", entity: { table: "leaveRequests", id: leaveRequestId }, summary: `${teacherDisplayName(teacher)} applied for ${a.type} leave ${a.fromDate}–${a.toDate}` });
    return { leaveRequestId };
  },
});

/** Withdraw one's own PENDING request (it is deleted; decided requests stay as history). */
export const withdrawLeave = schoolMutation({
  args: { leaveRequestId: v.id("leaveRequests") },
  handler: async (ctx, { leaveRequestId }) => {
    const r = await getInSchool(ctx, "leaveRequests", leaveRequestId, "Leave request");
    if (!ctx.actor.teacherId || r.teacherId !== ctx.actor.teacherId) throw forbidden("You can only withdraw your own leave requests.");
    if (r.status !== "pending") throw conflict("Only pending requests can be withdrawn.");
    await ctx.db.delete(r._id);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "leave.withdrawn", entity: { table: "leaveRequests", id: r._id }, summary: `Withdrew leave request ${r.fromDate}–${r.toDate}` });
    return { ok: true };
  },
});

export const myLeave = schoolQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.actor.teacherId) return [];
    const teacher = await getInSchool(ctx, "teachers", ctx.actor.teacherId, "Teacher");
    const rows = await ctx.db.query("leaveRequests").withIndex("by_teacher_from", (q) => q.eq("teacherId", teacher._id)).order("desc").take(200);
    return rows.filter((r) => r.schoolId === ctx.actor.schoolId).map((r) => leaveView(r, teacherDisplayName(teacher)));
  },
});

export const listLeave = schoolQuery({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))) },
  handler: async (ctx, { status }) => {
    requirePermission(ctx.actor, "staff:manage");
    const statuses = status ? [status] : (["pending", "approved", "rejected"] as const);
    const out = [];
    for (const s of statuses) {
      const rows = await ctx.db.query("leaveRequests").withIndex("by_school_status_from", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", s)).order("desc").take(200);
      for (const r of rows) {
        const t = await ctx.db.get(r.teacherId);
        out.push(leaveView(r, t ? teacherDisplayName(t) : ""));
      }
    }
    return out.sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  },
});

export const decideLeave = schoolMutation({
  args: { leaveRequestId: v.id("leaveRequests"), decision: v.union(v.literal("approved"), v.literal("rejected")), note: v.optional(v.string()) },
  handler: async (ctx, { leaveRequestId, decision, note }) => {
    requirePermission(ctx.actor, "staff:manage");
    const r = await getInSchool(ctx, "leaveRequests", leaveRequestId, "Leave request");
    if (r.status !== "pending") throw conflict(`This request is already ${r.status}.`);
    if (ctx.actor.teacherId && r.teacherId === ctx.actor.teacherId) throw forbidden("You cannot decide your own leave request.");
    await ctx.db.patch(r._id, { status: decision, decidedByUserId: ctx.actor.userId, decidedAt: Date.now(), ...(note?.trim() ? { decisionNote: assertNonEmpty(note, "note", 300) } : {}) });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: `leave.${decision}`, entity: { table: "leaveRequests", id: r._id }, summary: `Leave ${r.fromDate}–${r.toDate} ${decision}` });
    const members = await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", r.teacherId)).collect();
    await notifyUsers(ctx, ctx.actor.schoolId, members.filter((m) => m.schoolId === ctx.actor.schoolId && m.status === "active" && m.userId).map((m) => m.userId!), {
      type: "general", title: `Leave ${decision}`, message: `Your leave ${r.fromDate} to ${r.toDate} was ${decision}.`, entity: { table: "leaveRequests", id: r._id }, dedupeKey: `leave.decided:${r._id}`,
    });
    return { ok: true };
  },
});

// ================================================================ teacher records
/**
 * Teacher records for the Teachers & Staff page (staff:manage): every
 * teacher of the school (any status) with their sign-in state, class-teacher
 * sections and subject assignments in the current year. Bounded.
 * New teachers are added through Accounts & Import (one row or a spreadsheet),
 * which allocates the employee ID; this module edits existing records.
 */
export const MAX_TEACHERS = 1000;
export const listTeachers = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "staff:manage");
    const rows = await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", ctx.actor.schoolId)).take(MAX_TEACHERS);
    const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", ctx.actor.schoolId)).unique();
    const yearId = settings?.currentAcademicYearId ?? null;
    const subjects = new Map((await ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect()).map((s) => [s._id as string, s.name]));
    const out = [];
    for (const t of rows) {
      const owned = yearId ? (await ctx.db.query("sections").withIndex("by_class_teacher_year", (q) => q.eq("classTeacherId", t._id).eq("academicYearId", yearId)).collect()).filter((s) => s.schoolId === ctx.actor.schoolId) : [];
      const assignments = yearId ? (await ctx.db.query("teacherAssignments").withIndex("by_teacher_year", (q) => q.eq("teacherId", t._id).eq("academicYearId", yearId)).collect()).filter((a) => a.schoolId === ctx.actor.schoolId) : [];
      const membership = (await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", t._id)).collect()).find((m) => m.schoolId === ctx.actor.schoolId && m.role === "teacher");
      out.push({
        teacherId: t._id, name: teacherDisplayName(t), title: t.title ?? null, firstName: t.firstName, lastName: t.lastName, employeeId: t.employeeId,
        gender: t.gender ?? null, email: t.email ?? null, phone: t.phone ?? null, designation: t.designation ?? null, qualification: t.qualification ?? null,
        joiningDate: t.joiningDate ?? null, status: t.status,
        specializations: t.specializationSubjectIds.map((id) => subjects.get(id)).filter((x): x is string => !!x),
        specializationSubjectIds: t.specializationSubjectIds,
        classTeacherOf: owned.map((s) => s.displayName).sort(),
        subjectLoad: assignments.length,
        account: membership ? { loginId: membership.loginId ?? null, status: membership.status } : null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Edit a teacher record (staff:manage). The employee ID is fixed; deactivating keeps all history. */
export const updateTeacher = schoolMutation({
  args: {
    teacherId: v.id("teachers"),
    title: v.optional(v.string()), firstName: v.optional(v.string()), lastName: v.optional(v.string()),
    gender: v.optional(v.union(v.literal("male"), v.literal("female"), v.literal("other"), v.null())),
    email: v.optional(v.string()), phone: v.optional(v.string()), designation: v.optional(v.string()), qualification: v.optional(v.string()),
    joiningDate: v.optional(v.string()),
    specializationSubjectIds: v.optional(v.array(v.id("subjects"))),
    status: v.optional(v.union(v.literal("active"), v.literal("on_leave"), v.literal("inactive"))),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "staff:manage");
    const t = await getInSchool(ctx, "teachers", a.teacherId, "Teacher");
    const patch: Partial<Doc<"teachers">> = {};
    const optionalText = (value: string | undefined, field: string, max: number) => (value === undefined ? undefined : value.trim() ? assertNonEmpty(value, field, max) : null);
    if (a.firstName !== undefined) patch.firstName = assertNonEmpty(a.firstName, "firstName", 80);
    if (a.lastName !== undefined) patch.lastName = assertNonEmpty(a.lastName, "lastName", 80);
    for (const [key, max] of [["title", 20], ["designation", 80], ["qualification", 120], ["phone", 30]] as const) {
      const value = optionalText(a[key], key, max);
      if (value !== undefined) patch[key] = value ?? undefined;
    }
    if (a.email !== undefined) {
      const email = a.email.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Enter a valid email address.", { email: "Invalid" });
      patch.email = email || undefined;
    }
    if (a.gender !== undefined) patch.gender = a.gender ?? undefined;
    if (a.joiningDate !== undefined) patch.joiningDate = a.joiningDate ? assertIsoDate(a.joiningDate, "joiningDate") : undefined;
    if (a.specializationSubjectIds !== undefined) {
      for (const id of a.specializationSubjectIds) await getInSchool(ctx, "subjects", id, "Subject");
      patch.specializationSubjectIds = [...new Set(a.specializationSubjectIds)];
    }
    if (a.status !== undefined) patch.status = a.status;
    if (Object.keys(patch).length === 0) return { ok: true, changed: [] as string[] };
    await ctx.db.patch(t._id, patch);
    // Keep the teacher's sign-in display name in step with the record.
    if (patch.firstName !== undefined || patch.lastName !== undefined || "title" in patch) {
      const next = teacherDisplayName({ ...t, ...patch } as Doc<"teachers">);
      for (const m of await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", t._id)).collect()) {
        if (m.schoolId === ctx.actor.schoolId && m.displayName !== next) await ctx.db.patch(m._id, { displayName: next });
      }
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "teacher.updated", entity: { table: "teachers", id: t._id },
      summary: `Updated teacher ${teacherDisplayName(t)}`, metadata: { fields: Object.keys(patch), ...(a.status && a.status !== t.status ? { status: { from: t.status, to: a.status } } : {}) },
    });
    return { ok: true, changed: Object.keys(patch) };
  },
});

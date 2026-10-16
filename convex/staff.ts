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

/**
 * Fee-due reminders (scheduled; no user-facing API).
 *
 * Once a day `runDaily` fans out one `remindSchool` job per ACTIVE school. For a
 * school whose settings.notifications.feeReminders is on, every ACTIVE
 * installment (studentFees row) that still has an outstanding balance gets:
 *   - a "due soon" reminder when it falls due within REMINDER_LEAD_DAYS
 *     (dedupeKey `fees.due:<studentFeeId>`), and
 *   - an "overdue" reminder once its due date has passed, for up to
 *     OVERDUE_LOOKBACK_DAYS (dedupeKey `fees.overdue:<studentFeeId>`).
 * Recipients are the student's own active login
 * (userIdsForStudent). notifyUsers skips any user who already has a
 * notification with the same key, so each recipient gets each reminder for an
 * installment at most once — re-runs, retries and overlapping days are safe.
 * Outstanding amounts use the same ledger maths as every fee screen
 * (concessions and reversed payments are honoured). Work is paginated and
 * continues in follow-up jobs, so a large school never exceeds one mutation's
 * limits. Nothing is sent when the setting is off or the school is not active.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { addDays, todayIn } from "./model/calendar";
import { computeLedger, effectivePayments } from "./model/feeMath";
import { notifyUsers, userIdsForStudent } from "./model/notifications";
import { isModuleEnabled } from "./model/modules";

export const REMINDER_LEAD_DAYS = 3;
export const OVERDUE_LOOKBACK_DAYS = 30;
const PAGE = 200;

export const runDaily = internalMutation({
  args: {},
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").take(1000);
    let scheduled = 0;
    for (const s of schools) {
      if (s.status !== "active") continue;
      await ctx.scheduler.runAfter(0, internal.feeReminders.remindSchool, { schoolId: s._id, cursor: null });
      scheduled++;
    }
    return { scheduled };
  },
});

export const remindSchool = internalMutation({
  args: { schoolId: v.id("schools"), cursor: v.union(v.string(), v.null()), today: v.optional(v.string()) },
  handler: async (ctx, { schoolId, cursor, today: fixedToday }) => {
    const school = await ctx.db.get(schoolId);
    if (!school || school.status !== "active") return { sent: 0, done: true, skipped: "inactive" as const };
    const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).unique();
    if (!settings?.notifications.feeReminders) return { sent: 0, done: true, skipped: "disabled" as const };
    // Module entitlement: a school without Accounts & Finance gets no fee reminders (its fee data is kept).
    if (!(await isModuleEnabled(ctx, schoolId, "finance"))) return { sent: 0, done: true, skipped: "module_disabled" as const };
    // The first page fixes "today" for the whole run so a run crossing midnight stays consistent.
    const today = fixedToday ?? todayIn(school.timezone);
    const from = addDays(today, -OVERDUE_LOOKBACK_DAYS);
    const to = addDays(today, REMINDER_LEAD_DAYS);
    const page = await ctx.db.query("studentFees")
      .withIndex("by_school_due", (q) => q.eq("schoolId", schoolId).gte("dueDate", from).lte("dueDate", to))
      .paginate({ cursor, numItems: PAGE });

    const ledgers = new Map<string, Map<Id<"studentFees">, number>>();
    const outstandingOf = async (o: Doc<"studentFees">) => {
      const key = `${o.studentId}:${o.academicYearId}`;
      if (!ledgers.has(key)) {
        const obligations = (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", o.studentId).eq("academicYearId", o.academicYearId)).collect()).filter((x) => x.schoolId === schoolId);
        const concessions = (await ctx.db.query("feeConcessions").withIndex("by_student_year", (q) => q.eq("studentId", o.studentId).eq("academicYearId", o.academicYearId)).collect()).filter((x) => x.schoolId === schoolId);
        const payments = effectivePayments((await ctx.db.query("feePayments").withIndex("by_student_paid", (q) => q.eq("studentId", o.studentId)).collect()).filter((p) => p.schoolId === schoolId && p.academicYearId === o.academicYearId));
        ledgers.set(key, new Map(computeLedger(obligations, concessions, payments).rows.map((r) => [r.obligationId, r.outstandingMinor])));
      }
      return ledgers.get(key)!.get(o._id) ?? 0;
    };

    let sent = 0;
    for (const o of page.page) {
      if (o.status !== "active" || o.schoolId !== schoolId) continue;
      const outstanding = await outstandingOf(o);
      if (outstanding <= 0) continue;
      const student = await ctx.db.get(o.studentId);
      if (!student || student.schoolId !== schoolId) continue;
      const recipients = await userIdsForStudent(ctx, schoolId, student._id);
      if (recipients.length === 0) continue;
      const amount = `₹${(outstanding / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
      const overdue = o.dueDate < today;
      sent += await notifyUsers(ctx, schoolId, recipients, overdue
        ? { type: "fees", title: "Fee overdue", message: `${o.label} (${amount}) was due on ${o.dueDate}.`, href: "/student/fees", entity: { table: "studentFees", id: o._id }, dedupeKey: `fees.overdue:${o._id}` }
        : { type: "fees", title: "Fee due soon", message: `${o.label} (${amount}) is due on ${o.dueDate}.`, href: "/student/fees", entity: { table: "studentFees", id: o._id }, dedupeKey: `fees.due:${o._id}` });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.feeReminders.remindSchool, { schoolId, cursor: page.continueCursor, today });
    return { sent, done: page.isDone };
  },
});

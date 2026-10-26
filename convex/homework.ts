/**
 * Homework & submissions (A-04).
 *
 * Rules (server-side, every call):
 *  - Only a teacher with a PERSISTED subject assignment for (section, subject)
 *    may set homework there (teacherAssignments). Class-teacher ownership or
 *    teaching another subject in the section does not qualify.
 *  - Only the teacher who set an item may edit, close or review it. Admins
 *    (`homework:read:all`) can read everything but do not set homework.
 *  - A student submits only their OWN work, only for homework of the section
 *    they are actively enrolled in, while it is open. After the due date the
 *    submission is stored as `late`.
 *  - Students see only their own submission; teachers see submissions of
 *    their own homework.
 *  - Attachments use the shared upload pipeline (convex/files.ts, ownerType
 *    "homework" / "submission").
 * Students in the section get one in-app notification
 * per new homework; a reviewed student gets one per review (dedupe keys).
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { moduleQuery, moduleMutation } from "./core/functions";
import {
  enrollmentFor, getInSchool, hasPermission, isSubjectTeacherOf, linkedStudentIds, requirePermission, requireSectionRead, requireSubjectTeacher, teacherSectionIds,
} from "./core/authorization";
import { conflict, forbidden, invalid, invalidRelationship, notFound } from "./core/errors";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import { fullName, subjectInCurriculum, teacherDisplayName } from "./model/academics";
import { canReadHomework } from "./model/homeworkAccess";
import { todayIn } from "./model/calendar";
import { writeAudit } from "./model/audit";
import { notifyUsers, userIdsForSection, userIdsForStudent } from "./model/notifications";

const academicsQuery = moduleQuery("academics");
const academicsMutation = moduleMutation("academics");

/** Most homework items returned by one list call. */
const LIST_LIMIT = 200;

async function schoolToday(ctx: { db: { get: (id: Id<"schools">) => Promise<Doc<"schools"> | null> } }, schoolId: Id<"schools">) {
  return todayIn((await ctx.db.get(schoolId))!.timezone);
}


async function summary(ctx: Parameters<typeof enrollmentFor>[0], h: Doc<"homework">) {
  const [section, subject, teacher] = [await ctx.db.get(h.sectionId), await ctx.db.get(h.subjectId), await ctx.db.get(h.teacherId)];
  return {
    homeworkId: h._id, title: h.title, description: h.description, assignedOn: h.assignedOn, dueDate: h.dueDate, status: h.status,
    sectionId: h.sectionId, section: section?.displayName ?? "", subjectId: h.subjectId, subject: subject?.name ?? "",
    teacherId: h.teacherId, teacher: teacher ? teacherDisplayName(teacher) : "", attachmentFileIds: h.attachmentFileIds,
  };
}

async function ownHomework(ctx: Parameters<typeof requireSectionRead>[0], homeworkId: Id<"homework">) {
  const hw = await getInSchool(ctx, "homework", homeworkId, "Homework");
  requirePermission(ctx.actor, "homework:manage:assigned");
  if (!ctx.actor.teacherId || hw.teacherId !== ctx.actor.teacherId) throw forbidden("Only the teacher who set this homework can change it.");
  return hw;
}

// ================================================================ teacher
export const create = academicsMutation({
  args: { sectionId: v.id("sections"), subjectId: v.id("subjects"), title: v.string(), description: v.string(), dueDate: v.string() },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "homework:manage:assigned");
    const section = await requireSubjectTeacher(ctx, a.sectionId, a.subjectId, "You can only set homework for a subject you teach in this section.");
    await getInSchool(ctx, "subjects", a.subjectId, "Subject");
    if (!(await subjectInCurriculum(ctx, section.classId, section.academicYearId, a.subjectId))) throw invalidRelationship("This subject is not part of the class curriculum.");
    assertIsoDate(a.dueDate, "dueDate");
    const today = await schoolToday(ctx, ctx.actor.schoolId);
    if (a.dueDate < today) throw invalid("The due date cannot be in the past.", { dueDate: "In the past" });
    const year = (await ctx.db.get(section.academicYearId))!;
    if (a.dueDate > year.endDate) throw invalid("The due date must fall within the academic year.", { dueDate: "After year end" });
    const homeworkId = await ctx.db.insert("homework", {
      schoolId: ctx.actor.schoolId, academicYearId: section.academicYearId, sectionId: section._id, subjectId: a.subjectId, teacherId: ctx.actor.teacherId!,
      title: assertNonEmpty(a.title, "title", 150), description: assertNonEmpty(a.description, "description", 4000),
      assignedOn: today, dueDate: a.dueDate, status: "active", attachmentFileIds: [],
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "homework.created", entity: { table: "homework", id: homeworkId }, summary: `Set homework "${a.title.trim()}" for ${section.displayName}` });
    const settings = await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", ctx.actor.schoolId)).unique();
    if (settings?.notifications.homeworkAlerts !== false) {
      await notifyUsers(ctx, ctx.actor.schoolId, await userIdsForSection(ctx, ctx.actor.schoolId, section._id), {
        type: "homework", title: "New homework", message: `${a.title.trim()} — due ${a.dueDate}`, href: "/student/homework",
        entity: { table: "homework", id: homeworkId }, dedupeKey: `homework.created:${homeworkId}`,
      });
    }
    return { homeworkId };
  },
});

export const update = academicsMutation({
  args: { homeworkId: v.id("homework"), title: v.optional(v.string()), description: v.optional(v.string()), dueDate: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const hw = await ownHomework(ctx, a.homeworkId);
    if (hw.status !== "active") throw conflict("Closed homework cannot be edited.");
    const patch: Partial<Doc<"homework">> = {};
    if (a.title !== undefined) patch.title = assertNonEmpty(a.title, "title", 150);
    if (a.description !== undefined) patch.description = assertNonEmpty(a.description, "description", 4000);
    if (a.dueDate !== undefined) {
      assertIsoDate(a.dueDate, "dueDate");
      if (a.dueDate < hw.assignedOn) throw invalid("The due date cannot be before the date it was set.", { dueDate: "Too early" });
      const year = (await ctx.db.get(hw.academicYearId))!;
      if (a.dueDate > year.endDate) throw invalid("The due date must fall within the academic year.", { dueDate: "After year end" });
      patch.dueDate = a.dueDate;
    }
    await ctx.db.patch(hw._id, patch);
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "homework.updated", entity: { table: "homework", id: hw._id }, summary: `Updated homework "${patch.title ?? hw.title}"`, metadata: { fields: Object.keys(patch) } });
    return { ok: true };
  },
});

/** Close for submissions (idempotent). */
export const close = academicsMutation({
  args: { homeworkId: v.id("homework") },
  handler: async (ctx, { homeworkId }) => {
    const hw = await ownHomework(ctx, homeworkId);
    if (hw.status === "closed") return { ok: true };
    await ctx.db.patch(hw._id, { status: "closed" });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "homework.closed", entity: { table: "homework", id: hw._id }, summary: `Closed homework "${hw.title}"` });
    return { ok: true };
  },
});

/** The calling teacher's homework, newest due date first. */
export const listMine = academicsQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "homework:manage:assigned");
    if (!ctx.actor.teacherId) return [];
    const rows = await ctx.db.query("homework").withIndex("by_teacher_due", (q) => q.eq("teacherId", ctx.actor.teacherId!)).order("desc").take(LIST_LIMIT);
    const out = [];
    for (const h of rows.filter((x) => x.schoolId === ctx.actor.schoolId)) {
      const subs = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", h._id)).collect();
      const students = (await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", h.sectionId).eq("status", "active")).take(1001)).length;
      out.push({ ...(await summary(ctx, h)), submitted: subs.length, reviewed: subs.filter((s) => s.status === "reviewed").length, students });
    }
    return out;
  },
});

/** Homework of one section (admin: any; teachers: sections in their scope). */
export const listForSection = academicsQuery({
  args: { sectionId: v.id("sections") },
  handler: async (ctx, { sectionId }) => {
    const section = await requireSectionRead(ctx, sectionId, { all: "homework:read:all", assigned: "homework:manage:assigned" });
    const rows = await ctx.db.query("homework").withIndex("by_section_due", (q) => q.eq("sectionId", section._id)).order("desc").take(LIST_LIMIT);
    const out = [];
    const students = (await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).take(1001)).length;
    for (const h of rows.filter((x) => x.schoolId === ctx.actor.schoolId)) {
      const subs = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", h._id)).collect();
      out.push({ ...(await summary(ctx, h)), submitted: subs.length, reviewed: subs.filter((s) => s.status === "reviewed").length, students });
    }
    return out;
  },
});

/** Submissions of one homework (its teacher, or `homework:read:all`), with the section roster so missing work is visible. */
export const submissions = academicsQuery({
  args: { homeworkId: v.id("homework") },
  handler: async (ctx, { homeworkId }) => {
    const hw = await getInSchool(ctx, "homework", homeworkId, "Homework");
    const isOwner = !!ctx.actor.teacherId && hw.teacherId === ctx.actor.teacherId;
    if (!isOwner && !hasPermission(ctx.actor, "homework:read:all")) throw forbidden();
    const enrollments = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", hw.sectionId).eq("status", "active")).take(1001);
    const rows = [];
    for (const e of enrollments) {
      if (e.schoolId !== hw.schoolId) continue;
      const student = await ctx.db.get(e.studentId);
      if (!student) continue;
      const sub = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", hw._id).eq("studentId", student._id)).first();
      rows.push({
        studentId: student._id, name: fullName(student), rollNo: e.rollNo ?? null,
        submission: sub ? { submissionId: sub._id, status: sub.status, submittedAt: sub.submittedAt, content: sub.content ?? null, attachmentFileIds: sub.attachmentFileIds, feedback: sub.feedback ?? null } : null,
      });
    }
    rows.sort((a, b) => (a.rollNo ?? 1e9) - (b.rollNo ?? 1e9) || a.name.localeCompare(b.name));
    return { homework: await summary(ctx, hw), students: rows };
  },
});

/** Feedback on one submission (teacher who set the homework). Marks it reviewed and notifies the student once. */
export const review = academicsMutation({
  args: { submissionId: v.id("homeworkSubmissions"), feedback: v.string() },
  handler: async (ctx, { submissionId, feedback }) => {
    const sub = await getInSchool(ctx, "homeworkSubmissions", submissionId, "Submission");
    const hw = await ownHomework(ctx, sub.homeworkId);
    const text = assertNonEmpty(feedback, "feedback", 2000);
    await ctx.db.patch(sub._id, { status: "reviewed", feedback: text, reviewedByUserId: ctx.actor.userId });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "homework.reviewed", entity: { table: "homeworkSubmissions", id: sub._id }, summary: `Reviewed a submission for "${hw.title}"` });
    await notifyUsers(ctx, ctx.actor.schoolId, await userIdsForStudent(ctx, ctx.actor.schoolId, sub.studentId), {
      type: "homework", title: "Homework reviewed", message: `Your teacher reviewed "${hw.title}".`, href: "/student/homework",
      entity: { table: "homeworkSubmissions", id: sub._id }, dedupeKey: `homework.reviewed:${sub._id}`,
    });
    return { ok: true };
  },
});

// ================================================================ student
/**
 * Submit (or resubmit before review) the caller's OWN work. Only a student
 * membership can submit.
 */
export const submit = academicsMutation({
  args: { homeworkId: v.id("homework"), content: v.optional(v.string()) },
  handler: async (ctx, { homeworkId, content }) => {
    requirePermission(ctx.actor, "homework:submit");
    const studentId = ctx.actor.studentId;
    if (!studentId) throw forbidden("Only the student can submit their own work.");
    const hw = await getInSchool(ctx, "homework", homeworkId, "Homework");
    const enrollment = await enrollmentFor(ctx, studentId, hw.academicYearId);
    if (!enrollment || enrollment.status !== "active" || enrollment.sectionId !== hw.sectionId) throw notFound("Homework");
    if (hw.status !== "active") throw conflict("This homework is closed for submissions.");
    const text = content?.trim() ? content.trim().slice(0, 8000) : undefined;
    const today = await schoolToday(ctx, ctx.actor.schoolId);
    const status = today > hw.dueDate ? ("late" as const) : ("submitted" as const);
    const existing = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", hw._id).eq("studentId", studentId)).first();
    if (existing) {
      if (existing.status === "reviewed") throw conflict("This work has already been reviewed.");
      await ctx.db.patch(existing._id, { content: text, submittedAt: Date.now(), status });
      return { submissionId: existing._id, status };
    }
    const submissionId = await ctx.db.insert("homeworkSubmissions", {
      schoolId: ctx.actor.schoolId, homeworkId: hw._id, studentId, submittedAt: Date.now(), ...(text ? { content: text } : {}), attachmentFileIds: [], status,
    });
    await writeAudit(ctx, { schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "homework.submitted", entity: { table: "homeworkSubmissions", id: submissionId }, summary: `Submitted "${hw.title}"${status === "late" ? " (late)" : ""}` });
    return { submissionId, status };
  },
});

/** One homework item with the viewer's own submission (students), or the item alone (staff in scope). */
export const get = academicsQuery({
  args: { homeworkId: v.id("homework"), studentId: v.optional(v.id("students")) },
  handler: async (ctx, { homeworkId, studentId }) => {
    const hw = await getInSchool(ctx, "homework", homeworkId, "Homework");
    if (!(await canReadHomework(ctx, hw))) throw notFound("Homework");
    let own = null;
    const target = ctx.actor.studentId ?? studentId;
    if (target && hasPermission(ctx.actor, "homework:read:own")) {
      const linked = await linkedStudentIds(ctx, ctx.actor);
      if (linked.includes(target)) {
        const sub = await ctx.db.query("homeworkSubmissions").withIndex("by_homework_student", (q) => q.eq("homeworkId", hw._id).eq("studentId", target)).first();
        own = sub ? { submissionId: sub._id, status: sub.status, submittedAt: sub.submittedAt, content: sub.content ?? null, attachmentFileIds: sub.attachmentFileIds, feedback: sub.feedback ?? null } : null;
      }
    }
    const teacherScope = ctx.actor.teacherId ? await teacherSectionIds(ctx, ctx.actor.teacherId, hw.academicYearId) : new Set();
    return {
      ...(await summary(ctx, hw)),
      submission: own,
      canEdit: !!ctx.actor.teacherId && hw.teacherId === ctx.actor.teacherId,
      canTeacherView: teacherScope.has(hw.sectionId) || (await isSubjectTeacherOf(ctx, ctx.actor.teacherId, hw.sectionId, hw.subjectId)),
    };
  },
});

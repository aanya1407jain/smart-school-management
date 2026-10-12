/**
 * Generic, dataset-driven seeding (development / demo deployments ONLY).
 *
 *   npx convex env set ALLOW_DEMO_SEED true
 *   npx convex run seed:demo                       # seeds the "aster-academy" dataset
 *   npx convex run seed:demo '{"dataset":"aster-academy"}'
 *
 * The seeder never branches on a school's identity; every school-specific value
 * comes from a dataset in convex/seedData/. It refuses to run unless
 * ALLOW_DEMO_SEED=true, and refuses to seed a slug that already exists.
 *
 * Demo logins are created through the SAME invitation path real users take:
 * an invited membership + one-time code → Convex Auth `createAccount` →
 * `createOrUpdateUser` callback activates the membership.
 */
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { conflict, forbidden, notFound } from "./core/errors";
import { generateInviteCode, hashInviteCode, INVITE_TTL_MS } from "./model/memberships";
import { addDays, isSchoolDay, todayIn } from "./model/calendar";
import { gradeFor } from "./model/grading";
import { writeAudit } from "./model/audit";
import { nextAdmissionNumber, nextEmployeeId, nextReceiptNumber } from "./model/counters";
import { notifyUsers } from "./model/notifications";
import { asterAcademy } from "./seedData/asterAcademy";
import type { SeedDataset } from "./seedData/types";

const DATASETS: Record<string, SeedDataset> = { [asterAcademy.school.slug]: asterAcademy };

function datasetOrThrow(key: string): SeedDataset {
  const ds = DATASETS[key];
  if (!ds) throw notFound(`Seed dataset "${key}"`);
  return ds;
}

type Login = { email: string; password: string };

function loginsOf(ds: SeedDataset): Login[] {
  const out: Login[] = [{ email: ds.admin.email, password: ds.admin.login.password }];
  ds.teachers.forEach((t) => t.login && out.push({ email: t.email, password: t.login.password }));
  ds.students.forEach((s) => s.login && out.push({ email: s.email, password: s.login.password }));
  ds.guardians.forEach((g) => g.login && out.push({ email: g.email, password: g.login.password }));
  return out;
}

// ================================================================ entry point
export const demo = internalAction({
  args: { dataset: v.optional(v.string()) },
  handler: async (ctx, { dataset = asterAcademy.school.slug }): Promise<{ schoolId: Id<"schools">; logins: string[]; attendanceRegisters: number; results: number }> => {
    if (process.env.ALLOW_DEMO_SEED !== "true") {
      throw forbidden("Seeding is disabled. Set ALLOW_DEMO_SEED=true on a development deployment.");
    }
    const ds = datasetOrThrow(dataset);
    const logins = loginsOf(ds);
    const invites: { email: string; code: string; codeHash: string }[] = [];
    for (const l of logins) {
      const code = generateInviteCode();
      invites.push({ email: l.email, code, codeHash: await hashInviteCode(code) });
    }

    const { schoolId }: { schoolId: Id<"schools"> } = await ctx.runMutation(internal.seed.createStructure, {
      dataset, invites: invites.map(({ email, codeHash }) => ({ email, codeHash })),
    });

    for (const l of logins) {
      const code = invites.find((i) => i.email === l.email)!.code;
      await createAccount(ctx, {
        provider: "password",
        account: { id: l.email, secret: l.password },
        // `inviteCode` is consumed by the createOrUpdateUser callback in convex/auth.ts.
        profile: { email: l.email, inviteCode: code } as unknown as { email: string },
      });
    }

    const summary: { attendanceRegisters: number; results: number } = await ctx.runMutation(internal.seed.createActivity, { dataset, schoolId });
    return { schoolId, logins: logins.map((l) => l.email), ...summary };
  },
});

// ================================================================ step 1: structure
export const createStructure = internalMutation({
  args: { dataset: v.string(), invites: v.array(v.object({ email: v.string(), codeHash: v.string() })) },
  handler: async (ctx, { dataset, invites }) => {
    const ds = datasetOrThrow(dataset);
    const existing = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", ds.school.slug)).unique();
    if (existing) throw conflict(`A school with slug "${ds.school.slug}" already exists.`);

    const schoolId = await ctx.db.insert("schools", { ...ds.school, status: "active" });
    const school = (await ctx.db.get(schoolId))!;
    const yearId = await ctx.db.insert("academicYears", { schoolId, ...ds.academicYear, status: "active" });
    await ctx.db.insert("schoolSettings", {
      schoolId, currentAcademicYearId: yearId, workingDays: ds.settings.workingDays, attendance: ds.settings.attendance, grading: ds.settings.grading,
      notifications: { attendanceAlerts: true, feeReminders: true, homeworkAlerts: true, examAlerts: true, noticeAlerts: true },
    });

    const subjectIds: Record<string, Id<"subjects">> = {};
    for (const s of ds.subjects) subjectIds[s.code] = await ctx.db.insert("subjects", { schoolId, name: s.name, code: s.code, active: true });

    const classIds: Record<number, Id<"classes">> = {};
    const sectionIds: Record<string, Id<"sections">> = {};
    for (const c of ds.classes) {
      classIds[c.level] = await ctx.db.insert("classes", { schoolId, name: c.name, level: c.level, active: true });
      for (const name of c.sections) {
        sectionIds[`${c.level}-${name}`] = await ctx.db.insert("sections", {
          schoolId, academicYearId: yearId, classId: classIds[c.level], name, displayName: `${c.level}-${name}`, room: `Room ${c.level}${name}`, capacity: 40,
        });
      }
    }

    const teacherIds: Record<string, Id<"teachers">> = {};
    for (const t of ds.teachers) {
      teacherIds[t.key] = await ctx.db.insert("teachers", {
        schoolId, employeeId: await nextEmployeeId(ctx, school), title: t.title, firstName: t.firstName, lastName: t.lastName,
        gender: t.gender, email: t.email, designation: t.designation, qualification: t.qualification,
        specializationSubjectIds: t.subjects.map((c) => subjectIds[c]), joiningDate: t.joiningDate, status: "active",
      });
    }
    for (const [label, key] of Object.entries(ds.classTeachers)) await ctx.db.patch(sectionIds[label], { classTeacherId: teacherIds[key] });
    // Curriculum: each class studies the subjects assigned in any of its sections.
    const curriculum = new Map<Id<"classes">, Set<Id<"subjects">>>();
    for (const [label, bySubject] of Object.entries(ds.assignments)) {
      const classId = classIds[Number(label.split("-")[0])];
      const set = curriculum.get(classId) ?? new Set();
      Object.keys(bySubject).forEach((code) => set.add(subjectIds[code]));
      curriculum.set(classId, set);
    }
    for (const [classId, subjects] of curriculum) {
      for (const subjectId of subjects) await ctx.db.insert("classSubjects", { schoolId, academicYearId: yearId, classId, subjectId });
    }

    for (const [label, bySubject] of Object.entries(ds.assignments)) {
      const section = (await ctx.db.get(sectionIds[label]))!;
      for (const [code, key] of Object.entries(bySubject)) {
        await ctx.db.insert("teacherAssignments", {
          schoolId, academicYearId: yearId, teacherId: teacherIds[key], subjectId: subjectIds[code], classId: section.classId, sectionId: section._id, periodsPerWeek: 6,
        });
      }
    }

    const studentIds: Record<string, Id<"students">> = {};
    for (const s of ds.students) {
      const section = (await ctx.db.get(sectionIds[s.section]))!;
      studentIds[s.key] = await ctx.db.insert("students", {
        schoolId, admissionNo: await nextAdmissionNumber(ctx, school, ds.academicYear.startDate.slice(0, 4)),
        firstName: s.firstName, lastName: s.lastName, gender: s.gender, dateOfBirth: s.dateOfBirth, admissionDate: ds.academicYear.startDate, status: "active", email: s.email,
      });
      await ctx.db.insert("enrollments", {
        schoolId, studentId: studentIds[s.key], academicYearId: yearId, classId: section.classId, sectionId: section._id, rollNo: s.rollNo, status: "active", startDate: ds.academicYear.startDate,
      });
    }

    const guardianIds: Record<string, Id<"guardians">> = {};
    for (const g of ds.guardians) {
      guardianIds[g.key] = await ctx.db.insert("guardians", { schoolId, name: g.name, phone: g.phone, email: g.email, ...(g.occupation ? { occupation: g.occupation } : {}) });
      for (const link of g.links) {
        await ctx.db.insert("guardianLinks", { schoolId, guardianId: guardianIds[g.key], studentId: studentIds[link.student], relationship: link.relationship, isPrimary: link.isPrimary });
      }
    }

    // Invited memberships for every login (activated when the account is created).
    const hashFor = (email: string) => invites.find((i) => i.email === email)?.codeHash;
    const expires = Date.now() + INVITE_TTL_MS;
    const invite = async (m: Omit<Doc<"schoolMemberships">, "_id" | "_creationTime" | "schoolId" | "status" | "inviteCodeHash" | "inviteExpiresAt" | "permissionSets">) => {
      const codeHash = hashFor(m.email);
      if (!codeHash) return;
      await ctx.db.insert("schoolMemberships", { schoolId, status: "invited", permissionSets: [], inviteCodeHash: codeHash, inviteExpiresAt: expires, ...m });
    };
    await invite({ email: ds.admin.email, displayName: ds.admin.displayName, role: "admin" });
    for (const t of ds.teachers) if (t.login) await invite({ email: t.email, displayName: `${t.firstName} ${t.lastName}`, role: "teacher", teacherId: teacherIds[t.key] });
    for (const s of ds.students) if (s.login) await invite({ email: s.email, displayName: `${s.firstName} ${s.lastName}`, role: "student", studentId: studentIds[s.key] });
    for (const g of ds.guardians) if (g.login) await invite({ email: g.email, displayName: g.name, role: "student", guardianId: guardianIds[g.key] });

    // Fee structures + per-student obligations (amounts in minor units).
    for (const fs of ds.feeStructures) {
      const total = fs.components.reduce((a, c) => a + c.amountMinor, 0);
      let allocated = 0;
      const installments = fs.installments.map((ins, i) => {
        const amountMinor = i === fs.installments.length - 1 ? total - allocated : Math.round(total * ins.share);
        allocated += amountMinor;
        return { label: ins.label, dueDate: ins.dueDate, amountMinor };
      });
      const feeStructureId = await ctx.db.insert("feeStructures", {
        schoolId, academicYearId: yearId, name: fs.name, classIds: fs.classLevels.map((l) => classIds[l]), components: fs.components, installments, status: "active",
      });
      for (const s of ds.students) {
        if (!fs.classLevels.includes(Number(s.section.split("-")[0]))) continue;
        for (const ins of installments) {
          await ctx.db.insert("studentFees", { schoolId, studentId: studentIds[s.key], academicYearId: yearId, feeStructureId, label: ins.label, amountMinor: ins.amountMinor, dueDate: ins.dueDate, status: "active" });
        }
      }
    }

    // Exams and papers.
    for (const ex of ds.exams) {
      const examId = await ctx.db.insert("exams", {
        schoolId, academicYearId: yearId, name: ex.name, term: ex.term, classIds: ex.classLevels.map((l) => classIds[l]), startDate: ex.startDate, endDate: ex.endDate, status: ex.status,
      });
      for (const level of ex.classLevels) {
        for (const [i, code] of ex.subjects.entries()) {
          await ctx.db.insert("examSubjects", {
            schoolId, examId, classId: classIds[level], subjectId: subjectIds[code], date: addDays(ex.startDate, i), startTime: "09:30", endTime: "12:30", maxMarks: ex.maxMarks, passMarks: ex.passMarks,
          });
        }
      }
    }

    // Bell schedule + timetables (entries reference periods).
    const periodIds: Id<"periods">[] = [];
    for (const [i, p] of ds.periods.entries()) {
      periodIds.push(await ctx.db.insert("periods", { schoolId, index: i + 1, label: `Period ${i + 1}`, startTime: p.start, endTime: p.end, isBreak: false }));
    }
    for (const [label, days] of Object.entries(ds.timetables)) {
      const sectionId = sectionIds[label];
      for (const [day, codes] of Object.entries(days)) {
        for (const [i, code] of codes.entries()) {
          const teacherKey = ds.assignments[label][code];
          await ctx.db.insert("timetableEntries", {
            schoolId, academicYearId: yearId, sectionId, dayOfWeek: Number(day), periodId: periodIds[i],
            subjectId: subjectIds[code], teacherId: teacherIds[teacherKey], room: `Room ${label.replace("-", "")}`,
          });
        }
      }
    }
    return { schoolId };
  },
});

// ================================================================ step 2: activity (needs user ids)
function score(seed: number) {
  // Deterministic 0..1 from an integer (no Math.random, so seeds are reproducible).
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

async function userIdByEmail(ctx: MutationCtx, schoolId: Id<"schools">, email: string) {
  const m = await ctx.db.query("schoolMemberships").withIndex("by_school_email", (q) => q.eq("schoolId", schoolId).eq("email", email)).first();
  return m?.userId ?? null;
}

export const createActivity = internalMutation({
  args: { dataset: v.string(), schoolId: v.id("schools") },
  handler: async (ctx, { dataset, schoolId }) => {
    const ds = datasetOrThrow(dataset);
    const school = (await ctx.db.get(schoolId))!;
    const settings = (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).unique())!;
    const yearId = settings.currentAcademicYearId!;
    const adminUserId = await userIdByEmail(ctx, schoolId, ds.admin.email);
    if (!adminUserId) throw notFound("Seeded admin account");
    const today = todayIn(school.timezone);
    const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).collect();
    const byLabel = Object.fromEntries(sections.map((s) => [s.displayName, s]));
    const students = await ctx.db.query("students").withIndex("by_school_admission", (q) => q.eq("schoolId", schoolId)).collect();
    const studentByEmail = Object.fromEntries(students.map((s) => [s.email!, s]));
    const keyToStudent = (key: string) => studentByEmail[ds.students.find((s) => s.key === key)!.email];
    const subjects = await ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", schoolId)).collect();
    const subjectByCode = Object.fromEntries(subjects.map((s) => [s.code, s]));

    // Holidays first (attendance generation skips them).
    for (const h of ds.holidays) {
      await ctx.db.insert("events", { schoolId, title: h.title, kind: "holiday", startDate: h.date, endDate: h.date, audience: { kind: "all" }, createdByUserId: adminUserId });
    }

    // --- Attendance: the last N school days before today, marked by each section's class teacher.
    let registers = 0;
    const days: string[] = [];
    for (let d = addDays(today, -1); days.length < ds.attendanceDays && d >= ds.academicYear.startDate; d = addDays(d, -1)) {
      if (await isSchoolDay(ctx, school, settings, d)) days.push(d);
    }
    for (const section of sections) {
      if (!section.classTeacherId) continue;
      const ctMembership = await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", section.classTeacherId!)).first();
      if (!ctMembership?.userId) continue;
      const roster = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).collect();
      for (const [di, date] of days.entries()) {
        const statuses = roster.map((e, si) => {
          const r = score(di * 97 + si * 13 + section.displayName.length);
          return (r < 0.06 ? "absent" : r < 0.1 ? "late" : "present") as "absent" | "late" | "present";
        });
        const sessionId = await ctx.db.insert("attendanceSessions", {
          schoolId, academicYearId: yearId, sectionId: section._id, date, markedByUserId: ctMembership.userId, markedByTeacherId: section.classTeacherId,
          markedAt: Date.now(), presentCount: statuses.filter((s) => s === "present").length, absentCount: statuses.filter((s) => s === "absent").length,
          lateCount: statuses.filter((s) => s === "late").length, excusedCount: 0,
        });
        for (const [si, e] of roster.entries()) {
          await ctx.db.insert("attendanceRecords", { schoolId, sessionId, sectionId: section._id, studentId: e.studentId, date, status: statuses[si] });
        }
        registers++;
      }
    }

    // --- Fees: payments (FIFO allocation to the earliest obligations) + receipts; concessions.
    const year = (await ctx.db.get(yearId))!;
    let receiptSeq = 1;
    for (const p of ds.payments) {
      const student = keyToStudent(p.student);
      const fees = (await ctx.db.query("studentFees").withIndex("by_student_year", (q) => q.eq("studentId", student._id).eq("academicYearId", yearId)).collect())
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, p.installments);
      const amountMinor = fees.reduce((a, f) => a + f.amountMinor, 0);
      const paymentId = await ctx.db.insert("feePayments", {
        schoolId, studentId: student._id, academicYearId: yearId, amountMinor, method: p.method, reference: `SEED-${receiptSeq++}`, paidOn: addDays(today, -p.daysAgo),
        status: "completed", allocations: fees.map((f) => ({ studentFeeId: f._id, amountMinor: f.amountMinor })), recordedByUserId: adminUserId,
      });
      await ctx.db.insert("receipts", { schoolId, paymentId, studentId: student._id, receiptNo: await nextReceiptNumber(ctx, school, year), issuedAt: Date.now() });
    }
    for (const c of ds.concessions) {
      const student = keyToStudent(c.student);
      await ctx.db.insert("feeConcessions", { schoolId, studentId: student._id, academicYearId: yearId, kind: "percent", value: c.percent * 100, reason: c.reason, approvedByUserId: adminUserId, status: "active" });
    }

    // --- Exams: marks for published exams + computed results with ranks.
    const exams = await ctx.db.query("exams").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).collect();
    let resultCount = 0;
    for (const exam of exams.filter((e) => e.status === "published")) {
      for (const section of sections) {
        const papers = await ctx.db.query("examSubjects").withIndex("by_exam_class", (q) => q.eq("examId", exam._id).eq("classId", section.classId)).collect();
        if (papers.length === 0) continue;
        const roster = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", section._id).eq("status", "active")).collect();
        const rows: { studentId: Id<"students">; total: number; max: number; subjects: Doc<"results">["subjects"] }[] = [];
        for (const [si, e] of roster.entries()) {
          const subjectsOut: Doc<"results">["subjects"] = [];
          let total = 0, max = 0;
          for (const [pi, paper] of papers.entries()) {
            const m = Math.round((0.45 + 0.55 * score(si * 31 + pi * 7 + section.displayName.length)) * paper.maxMarks * 2) / 2;
            await ctx.db.insert("marks", { schoolId, examId: exam._id, examSubjectId: paper._id, studentId: e.studentId, sectionId: section._id, marks: m, isAbsent: false, enteredByUserId: adminUserId, updatedAt: Date.now() });
            total += m; max += paper.maxMarks;
            subjectsOut.push({ examSubjectId: paper._id, subjectId: paper.subjectId, marks: m, isAbsent: false, maxMarks: paper.maxMarks, grade: gradeFor(settings.grading.scheme, (m / paper.maxMarks) * 100), passed: m >= paper.passMarks });
          }
          rows.push({ studentId: e.studentId, total, max, subjects: subjectsOut });
        }
        rows.sort((a, b) => b.total - a.total);
        for (const [i, r] of rows.entries()) {
          const percentage = Math.round((r.total / r.max) * 1000) / 10;
          await ctx.db.insert("results", {
            schoolId, examId: exam._id, studentId: r.studentId, sectionId: section._id, totalMarks: r.total, maxMarks: r.max, percentage,
            grade: gradeFor(settings.grading.scheme, percentage), rank: i + 1, subjects: r.subjects, publishedAt: Date.now(),
          });
          resultCount++;
        }
      }
      await ctx.db.patch(exam._id, { publishedAt: Date.now(), publishedByUserId: adminUserId });
    }

    // --- Notices.
    for (const n of ds.notices) {
      const audience = n.audience.kind === "all" ? { kind: "all" as const } : { kind: "sections" as const, sectionIds: n.audience.sections.map((l) => byLabel[l]._id) };
      await ctx.db.insert("notices", { schoolId, title: n.title, body: n.body, type: n.type, priority: n.priority, audience, status: "published", publishDate: addDays(today, -n.daysAgo), createdByUserId: adminUserId });
    }

    // --- Homework.
    for (const h of ds.homework) {
      const section = byLabel[h.section];
      const assignment = await ctx.db.query("teacherAssignments").withIndex("by_section_subject", (q) => q.eq("sectionId", section._id).eq("subjectId", subjectByCode[h.subject]._id)).unique();
      await ctx.db.insert("homework", {
        schoolId, academicYearId: yearId, sectionId: section._id, subjectId: subjectByCode[h.subject]._id, teacherId: assignment!.teacherId,
        title: h.title, description: h.description, assignedOn: today, dueDate: addDays(today, h.dueInDays), status: "active", attachmentFileIds: [],
      });
    }

    // --- A welcome notification for every active member, and an audit marker.
    const members = await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", schoolId)).collect();
    await notifyUsers(ctx, schoolId, members.filter((m) => m.status === "active" && m.userId).map((m) => m.userId!), {
      type: "general", title: `Welcome to ${school.name}`, message: "Your account is ready.",
    });
    await writeAudit(ctx, { schoolId, action: "school.seeded", entity: { table: "schools", id: schoolId }, summary: `Seeded demo dataset "${dataset}"`, metadata: { registers, results: resultCount } });
    return { attendanceRegisters: registers, results: resultCount };
  },
});

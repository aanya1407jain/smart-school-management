/**
 * Real student records for the student portal and the staff profile:
 *  - academics.getStudentProfile (regression for "Could not find public
 *    function academics:getStudentProfile"): who may read it, and which
 *    fields each tier gets (explicit fields only, no spread documents);
 *  - studentPortal.myTimetable / myHomework / myResults / myFees / myNotices:
 *    resolved from the signed-in account, own records only.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;
const TODAY = "2026-07-15";

/** Seed timetable, homework, a published exam, fees and notices for the fixture school. */
async function seedRecords(t: T, A: School) {
  return await t.run(async (ctx) => {
    const p1 = await ctx.db.insert("periods", { schoolId: A.schoolId, index: 1, label: "Period 1", startTime: "08:30", endTime: "09:15", isBreak: false });
    await ctx.db.insert("timetableEntries", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.subjectTeacher, room: "R1" });
    await ctx.db.insert("timetableEntries", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionB, dayOfWeek: 1, periodId: p1, subjectId: A.subjectId, teacherId: A.classTeacher });
    const hwA = await ctx.db.insert("homework", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionA, subjectId: A.subjectId, teacherId: A.subjectTeacher, title: "Fractions sheet", description: "Q1-10", assignedOn: "2026-07-10", dueDate: "2026-07-12", status: "active", attachmentFileIds: [] });
    await ctx.db.insert("homework", { schoolId: A.schoolId, academicYearId: A.yearId, sectionId: A.sectionB, subjectId: A.subjectId, teacherId: A.classTeacher, title: "B only", description: "", assignedOn: "2026-07-10", dueDate: "2026-07-20", status: "active", attachmentFileIds: [] });
    await ctx.db.insert("homeworkSubmissions", { schoolId: A.schoolId, homeworkId: hwA, studentId: A.studentA, submittedAt: 1, attachmentFileIds: [], status: "reviewed", feedback: "Well done" });
    const exam = await ctx.db.insert("exams", { schoolId: A.schoolId, academicYearId: A.yearId, name: "Unit Test 1", term: "Term 1", classIds: [A.classId], startDate: "2026-07-01", endDate: "2026-07-03", status: "published", publishedAt: 1 });
    const draft = await ctx.db.insert("exams", { schoolId: A.schoolId, academicYearId: A.yearId, name: "Draft exam", classIds: [A.classId], startDate: "2026-08-01", endDate: "2026-08-03", status: "marks_entry" });
    const paper = await ctx.db.insert("examSubjects", { schoolId: A.schoolId, examId: exam, classId: A.classId, subjectId: A.subjectId, date: "2026-07-01", startTime: "09:00", endTime: "10:00", maxMarks: 50, passMarks: 17 });
    const subj = [{ examSubjectId: paper, subjectId: A.subjectId, marks: 41, isAbsent: false, maxMarks: 50, grade: "A2", passed: true }];
    await ctx.db.insert("results", { schoolId: A.schoolId, examId: exam, studentId: A.studentA, sectionId: A.sectionA, totalMarks: 41, maxMarks: 50, percentage: 82, grade: "A2", rank: 1, subjects: subj, publishedAt: 1 });
    await ctx.db.insert("results", { schoolId: A.schoolId, examId: draft, studentId: A.studentA, sectionId: A.sectionA, totalMarks: 1, maxMarks: 50, percentage: 2, rank: 1, subjects: subj, publishedAt: 1 });
    await ctx.db.insert("results", { schoolId: A.schoolId, examId: exam, studentId: A.studentB, sectionId: A.sectionB, totalMarks: 30, maxMarks: 50, percentage: 60, rank: 1, subjects: subj, publishedAt: 1 });
    const fs = await ctx.db.insert("feeStructures", { schoolId: A.schoolId, academicYearId: A.yearId, name: "Grade 8", classIds: [A.classId], components: [], installments: [], status: "active" });
    const q1 = await ctx.db.insert("studentFees", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, feeStructureId: fs, label: "Q1", amountMinor: 1000000, dueDate: "2026-04-10", status: "active" });
    const q2 = await ctx.db.insert("studentFees", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, feeStructureId: fs, label: "Q2", amountMinor: 1000000, dueDate: "2026-07-10", status: "active" });
    await ctx.db.insert("feeConcessions", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, kind: "percent", value: 1000, reason: "Sibling", approvedByUserId: A.users.admin, status: "active" });
    const paid = await ctx.db.insert("feePayments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, amountMinor: 900000, method: "upi", paidOn: "2026-04-05", status: "completed", allocations: [{ studentFeeId: q1, amountMinor: 900000 }], recordedByUserId: A.users.admin });
    await ctx.db.insert("receipts", { schoolId: A.schoolId, paymentId: paid, studentId: A.studentA, receiptNo: "AL/26-27/0001", issuedAt: 1 });
    const wrong = await ctx.db.insert("feePayments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, amountMinor: 900000, method: "cash", paidOn: "2026-07-01", status: "completed", allocations: [{ studentFeeId: q2, amountMinor: 900000 }], recordedByUserId: A.users.admin });
    await ctx.db.insert("feePayments", { schoolId: A.schoolId, studentId: A.studentA, academicYearId: A.yearId, amountMinor: -900000, method: "cash", paidOn: "2026-07-02", status: "reversed", reversalOfPaymentId: wrong, allocations: [], recordedByUserId: A.users.admin });
    const notice = (title: string, audience: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("notices", { schoolId: A.schoolId, title, body: "…", type: "notice", priority: "normal", audience: audience as never, status: "published", publishDate: "2026-07-01", createdByUserId: A.users.admin, ...extra });
    await notice("Everyone", { kind: "all" });
    await notice("Students", { kind: "roles", roles: ["student"] });
    await notice("Teachers only", { kind: "roles", roles: ["teacher"] });
    await notice("Grade 8", { kind: "classes", classIds: [A.classId] });
    await notice("8-A only", { kind: "sections", sectionIds: [A.sectionA] });
    await notice("8-B only", { kind: "sections", sectionIds: [A.sectionB] });
    await notice("Expired", { kind: "all" }, { expiresOn: "2026-07-05" });
    await notice("Scheduled", { kind: "all" }, { publishDate: "2026-08-01" });
    await notice("Draft", { kind: "all" }, { status: "draft" });
    return { q1, q2 };
  });
}

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  await seedRecords(t, A);
  return { t, A, B };
}

const FORBIDDEN_KEYS = ["_creationTime", "schoolId", "photoStorageId", "passwordHash", "secret", "userId", "tokenIdentifier"];
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}

describe("academics.getStudentProfile", () => {
  test("is a deployed public query (regression: 'Could not find public function') and admins get the full, explicit-field profile", async () => {
    const { t, A } = await setup();
    expect(api.academics.getStudentProfile).toBeDefined();
    const p = (await (await as(t, A.users.admin)).query(api.academics.getStudentProfile, { studentId: A.studentA }))!;
    expect(p.access).toBe("school");
    expect(p.student).toMatchObject({ studentId: A.studentA, firstName: "Asha", admissionNo: "alpha-Asha" });
    expect(p.enrollment).toMatchObject({ sectionDisplayName: "8-A", className: "Grade 8", status: "active", classTeacher: "Class T" });
    expect(p.parentContacts[0]).toMatchObject({ name: "Parent Contact", relationship: "Mother", phone: "+91-alpha" });
    expect(p.results.map((r) => r.examName)).toEqual(["Unit Test 1"]); // the unpublished exam's row is not shown
    expect(p.fees?.totals).toEqual({ grossMinor: 2000000, concessionMinor: 200000, paidMinor: 900000, outstandingMinor: 900000 });
    expect(p.homework.map((h) => h.title)).toEqual(["Fractions sheet"]);
    const keys = keysDeep(p);
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k)).toBe(false);
  });

  test("an assigned teacher sees the student without parent-contact phone/email or fees; an unassigned teacher sees nothing", async () => {
    const { t, A } = await setup();
    // subjectTeacher teaches section A (where Asha is).
    const p = (await (await as(t, A.users.subjectTeacher)).query(api.academics.getStudentProfile, { studentId: A.studentA }))!;
    expect(p.access).toBe("assigned");
    expect(p.parentContacts[0]).toMatchObject({ name: "Parent Contact", phone: null, email: null });
    expect(p.fees).toBeNull();
    // A teacher of another school / no scope:
    const outsider = await t.run(async (ctx) => {
      const tid = await ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "X", firstName: "No", lastName: "Scope", specializationSubjectIds: [], status: "active" });
      const uid = await ctx.db.insert("users", { email: "noscope@x.test" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: uid, displayName: "No Scope", role: "teacher", status: "active", permissionSets: [], teacherId: tid });
      return uid;
    });
    expect(await errorCode((await as(t, outsider)).query(api.academics.getStudentProfile, { studentId: A.studentA }))).toBe("NOT_FOUND");
  });

  test("a student sees only their own profile; a legacy guardian sign-in sees nothing; other schools and malformed ids are not found", async () => {
    const { t, A, B } = await setup();
    const student = await as(t, A.users.student); // Asha
    const own = (await student.query(api.academics.getStudentProfile, { studentId: A.studentA }))!;
    expect(own.access).toBe("own");
    expect(own.fees).not.toBeNull();
    expect(await errorCode(student.query(api.academics.getStudentProfile, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(student.query(api.academics.getStudentProfile, { studentId: B.studentA }))).toBe("NOT_FOUND");
    expect(await student.query(api.academics.getStudentProfile, { studentId: "stu_aarav" })).toBeNull();
    const legacy = await as(t, A.users.legacyGuardian); // was linked to Asha — no access any more
    expect(await errorCode(legacy.query(api.academics.getStudentProfile, { studentId: A.studentA }))).toBe("NO_SCHOOL_ACCESS");
    expect(await errorCode((await as(t, B.users.admin)).query(api.academics.getStudentProfile, { studentId: A.studentA }))).toBe("NOT_FOUND");
  });

  test("missing or ended enrollments are reported, not invented", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const e = await t.run(async (ctx) => (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", A.studentB).eq("academicYearId", A.yearId)).unique())!);
    await admin.mutation(api.academics.endEnrollment, { enrollmentId: e._id, status: "withdrawn", endDate: "2026-07-01" });
    let p = (await admin.query(api.academics.getStudentProfile, { studentId: A.studentB }))!;
    expect(p.enrollmentState).toBe("ended");
    expect(p.homework).toEqual([]);
    await t.run((ctx) => ctx.db.delete(e._id));
    p = (await admin.query(api.academics.getStudentProfile, { studentId: A.studentB }))!;
    expect(p.enrollmentState).toBe("missing");
    expect(p.enrollment).toBeNull();
  });
});

describe("student portal modules (live accounts)", () => {
  test("timetable, homework, results, fees and notices resolve to the signed-in student's own records", async () => {
    const { t, A } = await setup();
    const me = await as(t, A.users.student); // Asha, 8-A
    const tt = await me.query(api.studentPortal.myTimetable, {});
    expect(tt.state === "ok" && tt.section === "8-A" && tt.lessons.length === 1 && tt.lessons[0].teacher === "Subject T").toBe(true);
    const hw = await me.query(api.studentPortal.myHomework, {});
    expect(hw.state === "ok" && hw.homework.map((h) => [h.title, h.submission?.status, h.submission?.feedback])).toEqual([["Fractions sheet", "reviewed", "Well done"]]);
    // The fields the student homework screen renders: homework status, attachments, and the student's own submission text.
    expect(hw.state === "ok" && hw.homework.map((h) => [h.homeworkStatus, h.attachmentFileIds, h.submission?.content, typeof h.submission?.submissionId])).toEqual([["active", [], null, "string"]]);
    const res = await me.query(api.studentPortal.myResults, {});
    expect(res.state === "ok" && res.results.map((r) => [r.examName, r.percentage, r.rank, r.sectionSize])).toEqual([["Unit Test 1", 82, 1, 1]]);
    const fees = await me.query(api.studentPortal.myFees, {});
    if (fees.state !== "ok") throw new Error(fees.state);
    expect(fees.obligations.map((o) => [o.label, o.concessionMinor, o.paidMinor, o.outstandingMinor])).toEqual([["Q1", 100000, 900000, 0], ["Q2", 100000, 0, 900000]]);
    expect(fees.payments.map((p) => [p.receiptNo, p.amountMinor])).toEqual([["AL/26-27/0001", 900000]]); // the reversed payment is excluded
    const notices = await me.query(api.studentPortal.myNotices, { today: TODAY });
    expect(notices.state === "ok" && notices.notices.map((n) => n.title).sort()).toEqual(["8-A only", "Everyone", "Grade 8", "Students"]);
  });

  test("a student cannot read another student's modules; a legacy guardian sign-in reads none", async () => {
    const { t, A, B } = await setup();
    const me = await as(t, A.users.student);
    for (const q of [api.studentPortal.myTimetable, api.studentPortal.myHomework, api.studentPortal.myResults, api.studentPortal.myFees] as const) {
      expect(await errorCode(me.query(q, { studentId: A.studentB }))).toBe("NOT_FOUND");
      expect(await errorCode(me.query(q, { studentId: B.studentA }))).toBe("NOT_FOUND");
    }
    expect(await errorCode(me.query(api.studentPortal.myNotices, { studentId: A.studentB, today: TODAY }))).toBe("NOT_FOUND");
    const g = await as(t, A.users.legacyGuardian);
    expect(await errorCode(g.query(api.studentPortal.myResults, { studentId: A.studentA }))).toBe("NO_SCHOOL_ACCESS");
    expect(await errorCode(g.query(api.studentPortal.myFees, {}))).toBe("NO_SCHOOL_ACCESS");
    // Staff are not student-portal identities.
    expect(await errorCode((await as(t, A.users.admin)).query(api.studentPortal.myFees, {}))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.studentPortal.myTimetable, {}))).toBe("FORBIDDEN");
  });

  test("a bulk-created student (no seeded data) gets real, empty-but-honest modules for their section", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const sid = await t.run(async (ctx) => {
      const id = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "NEW-1", scholarNo: "NEW-1", scholarNoKey: "NEW-1", firstName: "Kabir", lastName: "Rao", status: "active", admissionDate: "2026-06-01" });
      await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: id, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionB, status: "active", startDate: "2026-06-01" });
      return id;
    });
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: [sid] } });
    await admin.mutation(api.bulkAccounts.startJob, { jobId });
    const res = await admin.action(api.bulkAccounts.processBatch, { jobId });
    const userId = await t.run(async (ctx) => (await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", sid)).unique())!.userId!);
    const me = await as(t, userId);
    expect(await errorCode(me.query(api.studentPortal.myTimetable, {}))).toBe("PASSWORD_CHANGE_REQUIRED");
    await me.action(api.account.changePassword, { currentPassword: res.credentials[0].temporaryPassword, newPassword: "Kabir#2026x" });
    const tt = await me.query(api.studentPortal.myTimetable, {});
    expect(tt.state === "ok" && tt.section === "8-B" && tt.lessons.length === 1).toBe(true); // 8-B's real timetable
    const hw = await me.query(api.studentPortal.myHomework, {});
    expect(hw.state === "ok" && hw.homework.map((h) => [h.title, h.submission])).toEqual([["B only", null]]);
    // The report-card header (school name, student name and admission number) comes with the results.
    expect((await me.query(api.studentPortal.myResults, {}))).toEqual({ state: "ok", school: "School alpha", student: { name: "Kabir Rao", admissionNo: "NEW-1" }, results: [] });
    const fees = await me.query(api.studentPortal.myFees, {});
    expect(fees.state === "ok" && fees.obligations.length === 0 && fees.totals.grossMinor === 0).toBe(true);
    const n = await me.query(api.studentPortal.myNotices, { today: TODAY });
    expect(n.state === "ok" && n.notices.map((x) => x.title).sort()).toEqual(["8-B only", "Everyone", "Grade 8", "Students"]);
  });

  test("not-enrolled and unlinked accounts get explicit states", async () => {
    const { t, A } = await setup();
    const e = await t.run(async (ctx) => (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", A.studentA).eq("academicYearId", A.yearId)).unique())!);
    await t.run((ctx) => ctx.db.patch(e._id, { status: "withdrawn" }));
    const me = await as(t, A.users.student);
    expect(await me.query(api.studentPortal.myTimetable, {})).toEqual({ state: "not_enrolled" });
    expect(await me.query(api.studentPortal.myHomework, {})).toEqual({ state: "not_enrolled" });
    await t.run((ctx) => ctx.db.patch(A.memberships.student, { studentId: undefined }));
    expect(await me.query(api.studentPortal.myFees, {})).toEqual({ state: "no_student_record" });
    expect(await errorCode(me.query(api.studentPortal.myNotices, { today: "14/07/2026" }))).toBe("INVALID_ARGUMENT");
  });
});

describe("attendance register (regression: ArgumentValidationError for sectionId \"sec_10a\")", () => {
  test("the register only accepts real section ids; listSections gives teachers exactly their scope", async () => {
    const { t, A } = await setup();
    const teacher = await as(t, A.users.classTeacher); // class teacher of 8-A, subject teacher in 8-B
    // The old UI sent a demo id: the server keeps rejecting it at validation.
    await expect(teacher.query(api.attendance.getByDate, { sectionId: "sec_10a" as Id<"sections">, date: "2026-07-13", today: TODAY })).rejects.toThrow(/sectionId|Validator/);
    const sections = await teacher.query(api.academics.listSections, {});
    expect(sections.map((s) => [s.displayName, s.isClassTeacher])).toEqual([["8-A", true], ["8-B", false]]);
    const { pickSection } = await import("../../src/features/attendance/section-pick");
    const live = sections.map((s) => ({ _id: s._id, classId: s.classId, name: s.name, displayName: s.displayName, isClassTeacher: s.isClassTeacher }));
    expect(pickSection(live, "sec_10a")?._id).toBe(A.sectionA); // demo link ignored → own class
    expect(pickSection(live, "8-B")?._id).toBe(A.sectionB); // label deep link
    expect(pickSection(live, A.sectionB)?._id).toBe(A.sectionB);
    expect(pickSection([], "8-A")).toBeNull();
    // The register for a picked section loads; only the class teacher may mark.
    const own = await teacher.query(api.attendance.getByDate, { sectionId: A.sectionA, date: "2026-07-13", today: TODAY });
    expect(own.isClassTeacher && own.canMark).toBe(true);
    const other = await teacher.query(api.attendance.getByDate, { sectionId: A.sectionB, date: "2026-07-13", today: TODAY });
    expect(other.canMark || other.canEdit).toBe(false);
    const entries = other.students.map((s) => ({ studentId: s.studentId, status: "present" as const }));
    expect(await errorCode(teacher.mutation(api.attendance.mark, { sectionId: A.sectionB, date: "2026-07-13", entries }))).toBe("FORBIDDEN");
    // Admins view registers but cannot mark.
    const adminView = await (await as(t, A.users.admin)).query(api.attendance.getByDate, { sectionId: A.sectionA, date: "2026-07-13", today: TODAY });
    expect(adminView.canMark || adminView.canEdit).toBe(false);
  });
});

/**
 * Minimal multi-school fixture for convex-test. Builds two independent
 * schools with the same shape so tests can prove tenant isolation.
 */
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function makeTest() {
  return convexTest(schema, modules);
}
export type T = ReturnType<typeof makeTest>;

export type SchoolFixture = {
  schoolId: Id<"schools">;
  yearId: Id<"academicYears">;
  sectionA: Id<"sections">;
  sectionB: Id<"sections">;
  studentA: Id<"students">;
  studentB: Id<"students">;
  classTeacher: Id<"teachers">; // owns sectionA, teaches subject in sectionB
  subjectTeacher: Id<"teachers">; // teaches in sectionA only, owns sectionB
  users: { admin: Id<"users">; classTeacher: Id<"users">; subjectTeacher: Id<"users">; student: Id<"users">; guardian: Id<"users"> };
  memberships: Record<"admin" | "classTeacher" | "subjectTeacher" | "student" | "guardian", Id<"schoolMemberships">>;
};

export async function createSchool(t: T, slug: string): Promise<SchoolFixture> {
  return await t.run(async (ctx) => {
    const schoolId = await ctx.db.insert("schools", { name: `School ${slug}`, slug, shortName: slug, code: slug.slice(0, 2).toUpperCase(), status: "active", timezone: "Asia/Kolkata", locale: "en-IN", currency: "INR" });
    const yearId = await ctx.db.insert("academicYears", { schoolId, name: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" });
    await ctx.db.insert("schoolSettings", {
      schoolId, currentAcademicYearId: yearId, workingDays: [1, 2, 3, 4, 5, 6],
      attendance: { lateCountsAsPresent: true, lowAttendanceThreshold: 85 }, grading: { scheme: "cbse_8_point", passPercentage: 33 },
      notifications: { attendanceAlerts: true, feeReminders: true, homeworkAlerts: true, examAlerts: true, noticeAlerts: true },
    });
    const classId = await ctx.db.insert("classes", { schoolId, name: "Grade 8", level: 8, active: true });
    const subjectId = await ctx.db.insert("subjects", { schoolId, name: "Mathematics", code: "MATH", active: true });
    const teacher = (first: string) => ctx.db.insert("teachers", { schoolId, employeeId: `${slug}-${first}`, firstName: first, lastName: "T", specializationSubjectIds: [], status: "active" });
    const classTeacher = await teacher("Class");
    const subjectTeacher = await teacher("Subject");
    const sectionA = await ctx.db.insert("sections", { schoolId, academicYearId: yearId, classId, name: "A", displayName: "8-A", classTeacherId: classTeacher });
    const sectionB = await ctx.db.insert("sections", { schoolId, academicYearId: yearId, classId, name: "B", displayName: "8-B", classTeacherId: subjectTeacher });
    await ctx.db.insert("teacherAssignments", { schoolId, academicYearId: yearId, teacherId: subjectTeacher, subjectId, classId, sectionId: sectionA });
    await ctx.db.insert("teacherAssignments", { schoolId, academicYearId: yearId, teacherId: classTeacher, subjectId, classId, sectionId: sectionB });
    const student = async (first: string, sectionId: Id<"sections">) => {
      const id = await ctx.db.insert("students", { schoolId, admissionNo: `${slug}-${first}`, firstName: first, lastName: "S", status: "active" });
      await ctx.db.insert("enrollments", { schoolId, studentId: id, academicYearId: yearId, classId, sectionId, rollNo: 1, status: "active", startDate: "2026-04-01" });
      return id;
    };
    const studentA = await student("Asha", sectionA);
    const studentB = await student("Bala", sectionB);
    const guardianId = await ctx.db.insert("guardians", { schoolId, name: "Guardian", phone: `+91-${slug}` });
    await ctx.db.insert("guardianLinks", { schoolId, guardianId, studentId: studentA, relationship: "Mother", isPrimary: true });

    const user = (email: string) => ctx.db.insert("users", { email });
    const users = {
      admin: await user(`admin@${slug}.test`), classTeacher: await user(`ct@${slug}.test`), subjectTeacher: await user(`st@${slug}.test`),
      student: await user(`student@${slug}.test`), guardian: await user(`guardian@${slug}.test`),
    };
    const member = (userId: Id<"users">, role: "admin" | "teacher" | "student", extra: Record<string, unknown> = {}) =>
      ctx.db.insert("schoolMemberships", { schoolId, userId, email: `${role}-${userId}@x.test`, displayName: role, role, status: "active", permissionSets: [], ...extra });
    const memberships = {
      admin: await member(users.admin, "admin"),
      classTeacher: await member(users.classTeacher, "teacher", { teacherId: classTeacher }),
      subjectTeacher: await member(users.subjectTeacher, "teacher", { teacherId: subjectTeacher }),
      student: await member(users.student, "student", { studentId: studentA }),
      guardian: await member(users.guardian, "student", { guardianId }),
    };
    return { schoolId, yearId, sectionA, sectionB, studentA, studentB, classTeacher, subjectTeacher, users, memberships };
  });
}

/** Act as a user. Convex Auth identities use `subject = "<userId>|<sessionId>"`. */
export async function as(t: T, userId: Id<"users">) {
  const sessionId = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 }));
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

/** A past date guaranteed to be a Monday (school day in the fixture). */
export function pastMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7 - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data;
    return data?.code ?? `THROWN: ${(e as Error).message}`;
  }
}

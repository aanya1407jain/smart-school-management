/**
 * Minimal multi-school fixture for convex-test. Builds two independent
 * schools with the same shape so tests can prove tenant isolation.
 */
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "../../convex/_generated/api";
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
  classId: Id<"classes">;
  subjectId: Id<"subjects">; // Mathematics, in Grade 8's curriculum
  sectionA: Id<"sections">;
  sectionB: Id<"sections">;
  studentA: Id<"students">;
  studentB: Id<"students">;
  classTeacher: Id<"teachers">; // owns sectionA, teaches subject in sectionB
  subjectTeacher: Id<"teachers">; // teaches in sectionA only, owns sectionB
  /**
   * `legacyGuardian`: a user holding ONLY a leftover guardian sign-in (the removed account type,
   * as it may still exist in a not-yet-migrated deployment). It must never get access.
   */
  users: { admin: Id<"users">; classTeacher: Id<"users">; subjectTeacher: Id<"users">; student: Id<"users">; legacyGuardian: Id<"users"> };
  memberships: Record<"admin" | "classTeacher" | "subjectTeacher" | "student" | "legacyGuardian", Id<"schoolMemberships">>;
  /** Parent contact record of studentA (contact data only). */
  parentContactId: Id<"guardians">;
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
      // Scholar numbers are the students' Login IDs, which are unique across schools: prefix with the school.
      const scholarNo = `${slug}${first}`.toUpperCase();
      const id = await ctx.db.insert("students", { schoolId, admissionNo: `${slug}-${first}`, firstName: first, lastName: "S", status: "active", scholarNo, scholarNoKey: scholarNo });
      await ctx.db.insert("enrollments", { schoolId, studentId: id, academicYearId: yearId, classId, sectionId, rollNo: 1, status: "active", startDate: "2026-04-01" });
      return id;
    };
    const studentA = await student("Asha", sectionA);
    const studentB = await student("Bala", sectionB);
    const guardianId = await ctx.db.insert("guardians", { schoolId, name: "Parent Contact", phone: `+91-${slug}` });
    await ctx.db.insert("guardianLinks", { schoolId, guardianId, studentId: studentA, relationship: "Mother", isPrimary: true });

    const user = (email: string) => ctx.db.insert("users", { email });
    const users = {
      admin: await user(`admin@${slug}.test`), classTeacher: await user(`ct@${slug}.test`), subjectTeacher: await user(`st@${slug}.test`),
      student: await user(`student@${slug}.test`), legacyGuardian: await user(`legacy-guardian@${slug}.test`),
    };
    const member = (userId: Id<"users">, role: "admin" | "teacher" | "student", extra: Record<string, unknown> = {}) =>
      ctx.db.insert("schoolMemberships", { schoolId, userId, email: `${role}-${userId}@x.test`, displayName: role, role, status: "active", permissionSets: [], ...extra });
    const memberships = {
      admin: await member(users.admin, "admin"),
      classTeacher: await member(users.classTeacher, "teacher", { teacherId: classTeacher }),
      subjectTeacher: await member(users.subjectTeacher, "teacher", { teacherId: subjectTeacher }),
      student: await member(users.student, "student", { studentId: studentA }),
      // Written directly (as an old deployment would hold it) — the API can no longer create one.
      legacyGuardian: await member(users.legacyGuardian, "student", { guardianId }),
    };
    await ctx.db.insert("classSubjects", { schoolId, academicYearId: yearId, classId, subjectId });
    return { schoolId, yearId, classId, subjectId, sectionA, sectionB, studentA, studentB, classTeacher, subjectTeacher, users, memberships, parentContactId: guardianId };
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

/** A password that meets the owner policy (convex/auth.ts validateOwnPassword). */
export const OWN_PASSWORD = "My#Own-Pass1";

/**
 * First sign-in of an account with an issued temporary password (SEC-01):
 * the owner replaces it through the real convex/account.ts changePassword,
 * as the UI forces on /set-password. Returns a caller with full access.
 */
export async function changeOwnPassword(t: T, userId: Id<"users">, currentPassword: string, newPassword = OWN_PASSWORD) {
  const me = await as(t, userId);
  await me.action(api.account.changePassword, { currentPassword, newPassword });
  return me;
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

// ---------------------------------------------------------------- credentials (OTP-gated overwrite, sign-in)

export type SentEmail = { to: string; subject: string; text: string };

/**
 * Route convex/model/email.ts through a stubbed Resend endpoint and collect
 * every message. `fail: true` makes delivery fail (HTTP 500). Call restore().
 */
export function captureEmails(options: { fail?: boolean } = {}) {
  const sent: SentEmail[] = [];
  const prev = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  process.env.RESEND_API_KEY = "test-only-key";
  process.env.EMAIL_FROM = "School <no-reply@school.test>";
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { to: string[]; subject: string; text: string };
    sent.push({ to: body.to[0], subject: body.subject, text: body.text });
    return new Response("{}", { status: options.fail ? 500 : 200 });
  });
  return {
    sent,
    /** The 6-digit code in the latest email. */
    lastCode: () => /code is (\d{6})/.exec(sent[sent.length - 1]?.text ?? "")?.[1] ?? "",
    restore() {
      vi.unstubAllGlobals();
      if (prev.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prev.key;
      if (prev.from === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = prev.from;
    },
  };
}

type Caller = Awaited<ReturnType<typeof as>>;

/** An administrator overwrites a password through the OTP-gated flow (code read from the captured email). */
export async function overwritePassword(admin: Caller, targetMembershipId: Id<"schoolMemberships">, newPassword: string) {
  const mail = captureEmails();
  try {
    const { challengeId } = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId });
    return await admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code: mail.lastCode(), newPassword });
  } finally {
    mail.restore();
  }
}

let signInKeyReady: Promise<void> | null = null;
/** Test-only RS256 key so Convex Auth can issue tokens (never a real key). */
export function enableSignIn(): Promise<void> {
  signInKeyReady ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    let bin = "";
    for (const b of pkcs8) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
    process.env.JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
    process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
  })();
  return signInKeyReady;
}

/** Real Convex Auth sign-in with a Login ID: "OK", or the error code / message. Call enableSignIn() first. */
export async function signInResult(t: T, loginId: string, password: string): Promise<string> {
  try {
    const r = (await t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", loginId, password } })) as { tokens?: { token: string } | null };
    return r.tokens?.token ? "OK" : "NO_TOKEN";
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data;
    return data?.code ?? (e instanceof Error ? e.message : String(e));
  }
}

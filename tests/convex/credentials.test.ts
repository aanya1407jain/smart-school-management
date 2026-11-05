/**
 * Admin-only credential management (convex/credentials.ts):
 *  - every credential query and action refuses non-admins (FORBIDDEN), on the server;
 *  - lookup by name / scholar number / employee ID / Login ID, tenant-isolated, never a password;
 *  - a password overwrite is gated by a one-time code emailed to the ADMINISTRATOR:
 *    bound to that admin and target, hashed at rest, expires, single use, attempt-limited,
 *    rate-limited; success signs the target out and writes a PASSWORD_OVERWRITE audit entry;
 *  - nobody changes their own password: no self-service endpoint, no Convex Auth reset/sign-up,
 *    no OTP bypass through the first-credential endpoints.
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, captureEmails, changeOwnPassword, createSchool, enableSignIn, errorCode, makeTest, modules, OWN_PASSWORD, overwritePassword, signInResult, type T } from "./fixtures";
import { OTP_MAX_ATTEMPTS, OTP_MAX_REQUESTS, PASSWORD_OVERWRITE } from "../../convex/credentials";
import { ACCOUNTANT_ACCESS } from "../../convex/core/grants";

beforeAll(() => enableSignIn());

let mail: ReturnType<typeof captureEmails> | null = null;
afterEach(() => { mail?.restore(); mail = null; });

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  const admin = await as(t, A.users.admin);
  const teacherId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "EMP-77", firstName: "Nina", lastName: "Rao", designation: "Science Department", specializationSubjectIds: [], status: "active" }));
  const tch = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId } });
  const stu = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
  const userOf = (id: Id<"schoolMemberships">) => t.run(async (ctx) => (await ctx.db.get(id))!.userId!);
  const adminEmail = await t.run(async (ctx) => (await ctx.db.get(A.memberships.admin))!.email!);
  // The teacher has replaced the issued password with their own (OWN_PASSWORD); the student is still on the temporary one.
  await changeOwnPassword(t, await userOf(tch.membershipId), tch.temporaryPassword);
  return { t, A, B, admin, tch, stu, userOf, adminEmail };
}

const otpRows = (t: T) => t.run((ctx) => ctx.db.query("credentialOtps").collect());
const overwriteAudits = (t: T) => t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === PASSWORD_OVERWRITE));

describe("only administrators reach credential functions", () => {
  test("teachers, students, restricted office logins and signed-out callers get FORBIDDEN / UNAUTHENTICATED on every query and action", async () => {
    const { t, A, admin, stu } = await setup();
    mail = captureEmails();
    const { challengeId } = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId });
    // An office login limited to the Accountant preset (admin role, no users:manage).
    const accountantUser = await t.run((ctx) => ctx.db.insert("users", { email: "acc@alpha.test" }));
    await t.run((ctx) => ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: accountantUser, email: "acc@alpha.test", displayName: "Accountant", role: "admin", status: "active", permissionSets: [], ...ACCOUNTANT_ACCESS }));

    const callers = [await as(t, A.users.classTeacher), await as(t, A.users.subjectTeacher), await as(t, A.users.student), await as(t, accountantUser)];
    for (const c of callers) {
      expect(await errorCode(c.query(api.credentials.search, { query: "bala" }))).toBe("FORBIDDEN");
      expect(await errorCode(c.query(api.credentials.account, { targetMembershipId: stu.membershipId }))).toBe("FORBIDDEN");
      expect(await errorCode(c.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("FORBIDDEN");
      expect(await errorCode(c.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code: mail.lastCode(), newPassword: "Hijack#2026" }))).toBe("FORBIDDEN");
      expect(await errorCode(c.action(api.accounts.issuePendingCredentials, { targetMembershipIds: [stu.membershipId] }).then((r) => { if (!r[0].ok) throw Object.assign(new Error(r[0].error), { data: { code: "FORBIDDEN" } }); }))).toBe("FORBIDDEN");
    }
    expect(await errorCode(t.query(api.credentials.search, { query: "bala" }))).toBe("UNAUTHENTICATED");
    expect(await errorCode(t.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("UNAUTHENTICATED");
    // Nothing changed: the issued password still works, and only the admin's own challenge exists.
    expect(await signInResult(t, stu.loginId, stu.temporaryPassword)).toBe("OK");
    expect((await otpRows(t)).length).toBe(1);
    expect(await overwriteAudits(t)).toEqual([]);
  });
});

describe("credential lookup", () => {
  test("finds accounts by name, scholar number, employee ID and Login ID with class/section and department — never a password", async () => {
    const { t, admin, tch, stu } = await setup();
    const find = async (query: string) => (await admin.query(api.credentials.search, { query })).results;

    const byScholar = await find("alphabala");
    expect(byScholar[0]).toMatchObject({ membershipId: stu.membershipId, role: "student", loginId: "ALPHABALA", scholarNo: "ALPHABALA", classSection: "8-B", state: "active", defaultPassword: false, passwordAction: "reset" });
    expect((await find("Bala")).map((r) => r.membershipId)).toContain(stu.membershipId);
    const byEmployee = await find("emp-77");
    expect(byEmployee[0]).toMatchObject({ membershipId: tch.membershipId, role: "teacher", employeeId: "EMP-77", department: "Science Department", loginId: tch.loginId, defaultPassword: false });
    expect((await find(tch.loginId.toLowerCase()))[0].membershipId).toBe(tch.membershipId);
    expect((await find("nina rao"))[0].membershipId).toBe(tch.membershipId);
    expect(await find("a")).toEqual([]); // at least 2 characters

    const details = await admin.query(api.credentials.account, { targetMembershipId: stu.membershipId });
    expect(details.history.map((h) => h.action)).toContain("account.created");
    const json = JSON.stringify([byScholar, byEmployee, details]);
    expect(json).not.toContain(stu.temporaryPassword);
    expect(json).not.toContain(OWN_PASSWORD);
    expect(json).not.toMatch(/secret|hash/i);
  });

  test("another school's accounts are invisible (search) and NOT_FOUND (details, OTP)", async () => {
    const { t, B, stu } = await setup();
    const otherAdmin = await as(t, B.users.admin);
    expect((await otherAdmin.query(api.credentials.search, { query: "alphabala" })).results).toEqual([]);
    expect(await errorCode(otherAdmin.query(api.credentials.account, { targetMembershipId: stu.membershipId }))).toBe("NOT_FOUND");
    mail = captureEmails();
    expect(await errorCode(otherAdmin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("NOT_FOUND");
    expect(mail.sent).toEqual([]);
  });
});

describe("OTP-gated password overwrite", () => {
  test("the code goes to the ADMIN's email; success changes the password, signs the target out and audits PASSWORD_OVERWRITE", async () => {
    const { t, A, admin, tch, userOf, adminEmail } = await setup();
    const targetUser = await userOf(tch.membershipId);
    const targetSession = await as(t, targetUser);
    expect((await targetSession.query(api.users.session, {})).status).toBe("signedIn");

    mail = captureEmails();
    const req = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: tch.membershipId });
    expect(req).toMatchObject({ sentTo: adminEmail, targetLoginId: tch.loginId });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(adminEmail);
    expect(mail.sent[0].text).toContain(tch.loginId);
    const code = mail.lastCode();
    expect(code).toMatch(/^\d{6}$/);
    // Only a salted hash is stored.
    const [row] = await otpRows(t);
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row).toMatchObject({ adminMembershipId: A.memberships.admin, targetMembershipId: tch.membershipId, attempts: 0 });

    const before = Date.now();
    const r = await admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId: req.challengeId, code, newPassword: "Fresh#Pass2026" });
    expect(r).toMatchObject({ ok: true, loginId: tch.loginId });
    expect(await signInResult(t, tch.loginId, "Fresh#Pass2026")).toBe("OK");
    expect(await signInResult(t, tch.loginId, OWN_PASSWORD)).toMatch(/InvalidSecret/);
    expect((await targetSession.query(api.users.session, {})).status).toBe("signedOut");

    const [audit] = await overwriteAudits(t);
    expect(audit).toMatchObject({
      schoolId: A.schoolId, actorUserId: A.users.admin, actorRole: "admin", action: "PASSWORD_OVERWRITE",
      entity: { table: "schoolMemberships", id: tch.membershipId },
      metadata: { adminUserId: A.users.admin, targetUserId: targetUser, targetMembershipId: tch.membershipId, targetLoginId: tch.loginId, authorizedBy: "email_otp" },
    });
    expect(audit.metadata.at).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(audit)).not.toContain("Fresh#Pass2026");
    expect(JSON.stringify(audit)).not.toContain(code);

    // Single use: the same code never works twice.
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId: req.challengeId, code, newPassword: "Again#Pass2026" }))).toBe("FORBIDDEN");
    expect(await signInResult(t, tch.loginId, "Fresh#Pass2026")).toBe("OK");
  });

  test("wrong codes count, and after OTP_MAX_ATTEMPTS even the right code is refused", async () => {
    const { t, admin, stu } = await setup();
    mail = captureEmails();
    const { challengeId } = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId });
    const code = mail.lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code: wrong, newPassword: "Guess#2026x" }))).toBe("INVALID_ARGUMENT");
      expect((await otpRows(t))[0].attempts).toBe(i); // the counter survives the error
    }
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code: wrong, newPassword: "Guess#2026x" }))).toBe("FORBIDDEN");
    expect((await otpRows(t))[0]).toMatchObject({ closedReason: "locked" });
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code, newPassword: "Guess#2026x" }))).toBe("FORBIDDEN");
    expect(await signInResult(t, stu.loginId, stu.temporaryPassword)).toBe("OK");
    expect(await overwriteAudits(t)).toEqual([]);
  });

  test("an expired code is refused; malformed codes and weak passwords do not use up an attempt", async () => {
    const { t, admin, stu } = await setup();
    mail = captureEmails();
    const { challengeId } = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId });
    const code = mail.lastCode();
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code: "12ab", newPassword: "Strong#2026" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code, newPassword: "short" }))).toBe("INVALID_ARGUMENT");
    expect((await otpRows(t))[0]).toMatchObject({ attempts: 0 });
    expect((await otpRows(t))[0].closedAt).toBeUndefined();
    await t.run((ctx) => ctx.db.patch(challengeId, { expiresAt: Date.now() - 1 }));
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code, newPassword: "Strong#2026" }))).toBe("INVALID_ARGUMENT");
    expect(await signInResult(t, stu.loginId, "Strong#2026")).toMatch(/InvalidSecret/);
  });

  test("a code is bound to its administrator; a new request replaces the open one", async () => {
    const { t, A, admin, stu, tch } = await setup();
    // A second full administrator of the same school.
    const admin2User = await t.run((ctx) => ctx.db.insert("users", { email: "second@alpha.test" }));
    await t.run((ctx) => ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: admin2User, email: "second@alpha.test", displayName: "Vice Principal", role: "admin", status: "active", permissionSets: [] }));
    const admin2 = await as(t, admin2User);
    mail = captureEmails();
    const first = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId });
    const firstCode = mail.lastCode();
    expect(await errorCode(admin2.action(api.credentials.verifyOtpAndSetPassword, { challengeId: first.challengeId, code: firstCode, newPassword: "Taken#2026x" }))).toBe("NOT_FOUND");

    const second = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: tch.membershipId });
    expect(await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId: first.challengeId, code: firstCode, newPassword: "Taken#2026x" }))).toBe("FORBIDDEN");
    // The challenge decides the target: the second code changes the TEACHER, never the student.
    await admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId: second.challengeId, code: mail.lastCode(), newPassword: "Teach#2026x" });
    expect(await signInResult(t, tch.loginId, "Teach#2026x")).toBe("OK");
    expect(await signInResult(t, stu.loginId, stu.temporaryPassword)).toBe("OK");
  });

  test("requests are rate-limited per administrator", async () => {
    const { admin, stu } = await setup();
    mail = captureEmails();
    for (let i = 0; i < OTP_MAX_REQUESTS; i++) await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId });
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("FORBIDDEN");
    expect(mail.sent).toHaveLength(OTP_MAX_REQUESTS);
  });

  test("no code without a deliverable admin email; a failed delivery leaves an unusable challenge", async () => {
    const { t, A, admin, stu } = await setup();
    // Delivery not configured.
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("EMAIL_UNAVAILABLE");
    expect((await otpRows(t))[0]).toMatchObject({ closedReason: "undelivered" });
    // Provider error.
    mail = captureEmails({ fail: true });
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("EMAIL_UNAVAILABLE");
    mail.restore();
    // No email address on the administrator's account.
    mail = captureEmails();
    await t.run(async (ctx) => {
      await ctx.db.patch(A.memberships.admin, { email: undefined });
      await ctx.db.patch(A.users.admin, { email: undefined });
    });
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("EMAIL_UNAVAILABLE");
    expect(mail.sent).toEqual([]);
  });

  test("own account, pending and disabled accounts cannot be overwritten", async () => {
    const { t, A, admin, stu } = await setup();
    mail = captureEmails();
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: A.memberships.admin }))).toBe("FORBIDDEN");
    // Pending: a reserved account without a password (e.g. after an import).
    const pending = await t.run((ctx) => ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, loginId: "TCH-00999", displayName: "Pending", role: "teacher", status: "invited", permissionSets: [] }));
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: pending }))).toBe("INVALID_ARGUMENT");
    await admin.action(api.accounts.setStatus, { targetMembershipId: stu.membershipId, status: "suspended" });
    expect(await errorCode(admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: stu.membershipId }))).toBe("INVALID_ARGUMENT");
    expect(mail.sent).toEqual([]);
  });

  test("the overwrite clears the legacy student-default marker", async () => {
    const { t, admin, stu, userOf } = await setup();
    const userId = await userOf(stu.membershipId);
    await t.run((ctx) => ctx.db.patch(userId, { defaultPassword: true })); // an account from before SEC-01
    expect((await admin.query(api.credentials.search, { query: "alphabala" })).results[0].defaultPassword).toBe(true);
    await overwritePassword(admin, stu.membershipId, "Bala#2026x");
    expect((await t.run((ctx) => ctx.db.get(userId)))?.defaultPassword).toBeUndefined();
    expect((await admin.query(api.credentials.search, { query: "alphabala" })).results[0].defaultPassword).toBe(false);
  });
});

describe("self-service credentials: only the owner's own password change (SEC-01)", () => {
  test("the only self-service endpoint is account.changePassword; Convex Auth reset / sign-up flows are refused", async () => {
    const { t, stu } = await setup();
    // convex/account.ts changePassword (current password required; covered in password-change.test.ts).
    expect(Object.keys(modules).filter((k) => /\/convex\/account\.ts$/.test(k))).toHaveLength(1);
    expect(await errorCode(t.action(api.account.changePassword, { currentPassword: stu.temporaryPassword, newPassword: "Mine#2026x" }))).toBe("UNAUTHENTICATED");
    const reset = String(await errorCode(t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", loginId: stu.loginId } })));
    expect(reset).not.toBe("NO_ERROR");
    const verify = String(await errorCode(t.action(api.auth.signIn, { provider: "password", params: { flow: "reset-verification", loginId: stu.loginId, code: "123456", newPassword: "Mine#2026x" } })));
    expect(verify).not.toBe("NO_ERROR");
    expect(String(await errorCode(t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", loginId: stu.loginId, password: "Mine#2026x" } })))).toBe("FORBIDDEN");
    expect(await signInResult(t, stu.loginId, "Mine#2026x")).toMatch(/InvalidSecret/);
    expect(await signInResult(t, stu.loginId, stu.temporaryPassword)).toBe("OK");
  });

  test("first-credential issuing cannot overwrite a password the owner chose (no OTP bypass)", async () => {
    const { t, admin, tch, stu, userOf } = await setup();
    // The teacher set their own password: refused.
    const [r] = await admin.action(api.accounts.issuePendingCredentials, { targetMembershipIds: [tch.membershipId] });
    expect(r).toMatchObject({ ok: false });
    expect(await signInResult(t, tch.loginId, OWN_PASSWORD)).toBe("OK");
    // A student still on an undelivered temporary password gets a NEW temporary one (signed out; still must change it).
    const [again] = await admin.action(api.accounts.issuePendingCredentials, { targetMembershipIds: [stu.membershipId] });
    expect(again).toMatchObject({ ok: true });
    const rotated = again.ok ? again.temporaryPassword : "";
    expect(rotated).not.toBe(stu.temporaryPassword);
    expect(await signInResult(t, stu.loginId, stu.temporaryPassword)).toMatch(/InvalidSecret/);
    expect(await signInResult(t, stu.loginId, rotated)).toBe("OK");
    const stuUser = await userOf(stu.membershipId);
    expect((await t.run((ctx) => ctx.db.get(stuUser)))?.requiresPasswordChange).toBe(true);
    // Once an administrator set another password, it is refused too.
    await overwritePassword(admin, stu.membershipId, "Bala#2026x");
    const [after] = await admin.action(api.accounts.issuePendingCredentials, { targetMembershipIds: [stu.membershipId] });
    expect(after).toMatchObject({ ok: false });
    expect(await signInResult(t, stu.loginId, "Bala#2026x")).toBe("OK");
  });

  test("the removed legacy 'must change password' flag does not lock anyone out (only requiresPasswordChange does)", async () => {
    const { t, stu, userOf, A } = await setup();
    const userId = await userOf(stu.membershipId);
    await changeOwnPassword(t, userId, stu.temporaryPassword);
    await t.run((ctx) => ctx.db.patch(userId, { mustChangePassword: true, temporaryPasswordIssuedAt: Date.now() - 365 * 24 * 3600 * 1000 }));
    const me = await as(t, userId);
    expect((await me.query(api.attendance.studentHistory, { studentId: A.studentB })).studentId).toBe(A.studentB);
    expect(await signInResult(t, stu.loginId, OWN_PASSWORD)).toBe("OK");
  });
});

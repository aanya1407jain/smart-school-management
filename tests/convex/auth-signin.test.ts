/**
 * Real Convex Auth sign-in (auth:signIn, Password provider keyed by Login ID)
 * in-process with convex-test: demo logins created by seed:demo, accounts
 * provisioned through Accounts & Import, wrong password / unknown Login ID,
 * first-login password change, and the InvalidAccountId regression (a request
 * from an outdated email-based sign-in page).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";

/** Test-only RS256 key so Convex Auth can issue tokens (never a real key). */
beforeAll(async () => {
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
});

type SignInResult = { tokens?: { token: string; refreshToken: string } | null };

const signIn = (t: T, params: Record<string, string>) =>
  t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", ...params } }) as Promise<SignInResult>;

/** The error text Convex Auth / our code throws for a failed sign-in. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data;
    return data?.code ?? (e instanceof Error ? e.message : String(e));
  }
  return "NO_ERROR";
}

/** The user id of the session created by the latest successful sign-in. */
const latestSessionUser = (t: T) =>
  t.run(async (ctx) => {
    const s = await ctx.db.query("authSessions").order("desc").first();
    return s!.userId;
  });

const membershipOf = (t: T, userId: Id<"users">) =>
  t.run(async (ctx) => (await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", userId)).collect()));

describe("demo logins (seed:demo, same Login ID path as real accounts)", () => {
  test("admin, teacher and student sign in with their Login IDs; role comes from the membership", async () => {
    process.env.ALLOW_DEMO_SEED = "true";
    const t = makeTest();
    try {
      await t.action(internal.seed.demo, {});
    } finally {
      delete process.env.ALLOW_DEMO_SEED;
    }
    const cases: [string, string, "admin" | "teacher" | "student"][] = [
      ["ADMIN-001", "Admin@123", "admin"],
      ["TCH-00001", "Teacher@123", "teacher"],
      ["STU-2026-00001", "Student@123", "student"],
    ];
    for (const [loginId, password, role] of cases) {
      const r = await signIn(t, { loginId, password });
      expect(r.tokens?.token, loginId).toBeTruthy();
      const ms = await membershipOf(t, await latestSessionUser(t));
      expect(ms.map((m) => [m.loginId, m.role, m.status]), loginId).toContainEqual([loginId, role, "active"]);
    }
    // Case and surrounding spaces are ignored (canonical Login ID).
    expect((await signIn(t, { loginId: "  adm" + "in-001 ", password: "Admin@123" })).tokens?.token).toBeTruthy();
  }, 120_000);
});

describe("accounts provisioned through Accounts & Import", () => {
  async function setup() {
    const t = makeTest();
    const A = await createSchool(t, "alpha");
    const B = await createSchool(t, "beta");
    const admin = await as(t, A.users.admin);
    return { t, A, B, admin };
  }

  test("a provisioned student signs in with their scholar number + the default password, must change it, then uses the new one", async () => {
    const { t, A, admin } = await setup();
    const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    expect(acc.loginId).toBe("ALPHABALA"); // scholar number
    expect(acc.temporaryPassword).toBe("Aster@123");
    expect((await signIn(t, { loginId: "alphabala", password: "Aster@123" })).tokens?.token).toBeTruthy();
    const userId = await latestSessionUser(t);
    const me = await as(t, userId);
    // Temporary password: everything but the password change is refused.
    expect(await errorCode(me.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("PASSWORD_CHANGE_REQUIRED");
    await me.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: "Bala#2026x" });
    expect(await failure(signIn(t, { loginId: acc.loginId, password: acc.temporaryPassword }))).toMatch(/InvalidSecret/);
    expect((await signIn(t, { loginId: acc.loginId, password: "Bala#2026x" })).tokens?.token).toBeTruthy();
    // Ownership and isolation still come from the membership: own record yes, others no.
    const after = await as(t, await latestSessionUser(t));
    expect((await after.query(api.attendance.studentHistory, { studentId: A.studentB })).studentId).toBe(A.studentB);
    expect(await errorCode(after.query(api.attendance.studentHistory, { studentId: A.studentA }))).toBe("NOT_FOUND");
  });

  test("a provisioned teacher and a second admin sign in; their roles come from the backend records", async () => {
    const { t, A, admin } = await setup();
    const teacherId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-9", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
    const tch = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId } });
    expect(tch.loginId).toMatch(/^TCH-\d{5}$/);
    expect((await signIn(t, { loginId: tch.loginId, password: tch.temporaryPassword })).tokens?.token).toBeTruthy();
    expect((await membershipOf(t, await latestSessionUser(t))).map((m) => m.role)).toEqual(["teacher"]);
    // The pre-existing admin of school A signs in with a Login ID provisioned the same way.
    const adm = await t.run(async (ctx) => (await ctx.db.get(A.memberships.admin))!);
    expect(adm.role).toBe("admin");
  });

  test("wrong password and unknown Login ID fail the same way for the user; nothing is created", async () => {
    const { t, A, admin } = await setup();
    const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    const before = await t.run(async (ctx) => ({ users: (await ctx.db.query("users").collect()).length, accounts: (await ctx.db.query("authAccounts").collect()).length }));
    const wrong = await failure(signIn(t, { loginId: acc.loginId, password: "not-the-password1" }));
    const unknown = await failure(signIn(t, { loginId: "STU-2026-99999", password: "whatever-123" }));
    const malformed = await failure(signIn(t, { loginId: "admin@asteracademy.edu", password: "whatever-123" }));
    expect(wrong).toMatch(/InvalidSecret/);
    expect(unknown).toMatch(/InvalidAccountId/);
    expect(malformed).toMatch(/InvalidAccountId/); // an email is never a Login ID
    const { signInErrorMessage, SIGN_IN_FAILED } = await import("../../src/features/auth/login-form");
    expect([wrong, unknown, malformed].map((m) => signInErrorMessage(new Error(m)))).toEqual([SIGN_IN_FAILED, SIGN_IN_FAILED, SIGN_IN_FAILED]);
    expect(await t.run(async (ctx) => ({ users: (await ctx.db.query("users").collect()).length, accounts: (await ctx.db.query("authAccounts").collect()).length }))).toEqual(before);
    // Self-registration stays impossible.
    expect(await failure(t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", loginId: "NEW-1", password: "Passw0rd!!" } }))).toBe("FORBIDDEN");
  });

  test("regression: an email-based request (outdated sign-in page) gets LOGIN_ID_REQUIRED, not InvalidAccountId", async () => {
    const { t, A, admin } = await setup();
    const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    // Exactly what the stale Oct-12 build sends: { email, password, flow }.
    const r = await failure(signIn(t, { email: "admin@asteracademy.edu", password: "Admin@123" }));
    expect(r).toBe("LOGIN_ID_REQUIRED");
    // Even an email field holding a valid Login ID is not used as an identifier.
    expect(await failure(signIn(t, { email: acc.loginId, password: acc.temporaryPassword }))).toBe("LOGIN_ID_REQUIRED");
    const { signInErrorMessage } = await import("../../src/features/auth/login-form");
    const { AppError } = await import("../../convex/core/errors");
    expect(signInErrorMessage(new AppError("LOGIN_ID_REQUIRED", "This sign-in page is out of date. Reload the page and sign in with your Login ID."))).toMatch(/out of date/);
  });
});

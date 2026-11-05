/**
 * Security hotfixes from SECURITY_AUDIT.md:
 *  - SEC-01 forced password change + convex/account.ts changePassword
 *  - SEC-05 post-sign-in redirect sanitizer (safeInternalPath)
 *  - SEC-04 TC QR generated locally (no third-party request)
 *  - SEC-03 security headers in next.config.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, changeOwnPassword, createSchool, enableSignIn, errorCode, makeTest, OWN_PASSWORD, signInResult, type T } from "./fixtures";
import { validateOwnPassword } from "../../convex/auth";
import { newPasswordProblem } from "../../src/features/auth/set-password-form";
import { safeInternalPath } from "../../src/lib/permissions/routes";
import { qrSvgPath } from "../../src/features/students/lifecycle/tc-document";
import nextConfig from "../../next.config";

beforeAll(() => enableSignIn());

const ROOT = join(__dirname, "../..");

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const admin = await as(t, A.users.admin);
  const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
  const userId = await t.run(async (ctx) => (await ctx.db.get(acc.membershipId))!.userId!);
  return { t, A, admin, acc, userId };
}
const userRow = (t: T, id: Id<"users">) => t.run((ctx) => ctx.db.get(id));
const appError = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return (e as { data?: { code: string; fields?: Record<string, string> } }).data ?? null; }
};

describe("SEC-01: no shared default; temporary passwords must be changed", () => {
  test("every issued password is random and different; the old shared default never signs in", async () => {
    const { t, A, admin, acc } = await setup();
    const tId = await t.run((ctx) => ctx.db.insert("teachers", { schoolId: A.schoolId, employeeId: "E-1", firstName: "Nina", lastName: "Rao", specializationSubjectIds: [], status: "active" }));
    const tch = await admin.action(api.accounts.create, { person: { kind: "teacher", teacherId: tId } });
    expect(acc.temporaryPassword).not.toBe(tch.temporaryPassword);
    expect(await signInResult(t, acc.loginId, "Aster@123")).toMatch(/InvalidSecret/);
    // The constant is gone from the backend source.
    expect(readFileSync(join(ROOT, "convex/model/accounts.ts"), "utf8")).not.toMatch(/Aster@123|STUDENT_DEFAULT_PASSWORD\s*=/);
  });

  test("before the change: the session says passwordChangeRequired (no viewer) and every school function refuses", async () => {
    const { t, A, userId, acc } = await setup();
    const me = await as(t, userId);
    const s = await me.query(api.users.session, {});
    expect(s).toMatchObject({ status: "passwordChangeRequired", loginId: acc.loginId, displayName: expect.any(String), schoolName: "School alpha" });
    expect(JSON.stringify(s)).not.toMatch(/permissions|viewer/);
    for (const call of [
      () => me.query(api.users.viewer, {}),
      () => me.query(api.studentPortal.myProfile, {}),
      () => me.query(api.attendance.studentHistory, { studentId: A.studentB }),
      () => me.query(api.notifications.unreadCount, {}),
    ]) expect(await errorCode(call())).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  test("an account still on the former shared default (defaultPassword) is gated the same way", async () => {
    const { t, A, userId, acc } = await setup();
    await t.run((ctx) => ctx.db.patch(userId, { requiresPasswordChange: undefined, defaultPassword: true }));
    const me = await as(t, userId);
    expect((await me.query(api.users.session, {})).status).toBe("passwordChangeRequired");
    expect(await errorCode(me.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("PASSWORD_CHANGE_REQUIRED");
    await changeOwnPassword(t, userId, acc.temporaryPassword);
    const after = await userRow(t, userId);
    expect(after?.requiresPasswordChange).toBeUndefined();
    expect(after?.defaultPassword).toBeUndefined();
  });
});

describe("SEC-01: account.changePassword", () => {
  test("requires an active session", async () => {
    const { t, userId, acc } = await setup();
    expect(await errorCode(t.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: OWN_PASSWORD }))).toBe("UNAUTHENTICATED");
    const me = await as(t, userId);
    await t.run(async (ctx) => { for (const s of await ctx.db.query("authSessions").collect()) await ctx.db.delete(s._id); }); // signed out
    expect(await errorCode(me.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: OWN_PASSWORD }))).toBe("UNAUTHENTICATED");
    expect((await userRow(t, userId))?.requiresPasswordChange).toBe(true);
  });

  test("requires the correct current password (wrong guesses are rate-limited like sign-in)", async () => {
    const { t, userId, acc } = await setup();
    const me = await as(t, userId);
    const wrong = await appError(me.action(api.account.changePassword, { currentPassword: "Nope#1234", newPassword: OWN_PASSWORD }));
    expect(wrong).toMatchObject({ code: "INVALID_ARGUMENT", fields: { currentPassword: "Incorrect" } });
    expect((await userRow(t, userId))?.requiresPasswordChange).toBe(true);
    // Convex Auth's per-account limit (10 failures/hour) also covers this endpoint.
    let last = "";
    for (let i = 0; i < 12; i++) last = await errorCode(me.action(api.account.changePassword, { currentPassword: `Nope#${i}xyz`, newPassword: OWN_PASSWORD }));
    expect(last).toBe("FORBIDDEN");
    expect(await errorCode(me.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: OWN_PASSWORD }))).toBe("FORBIDDEN");
  });

  test("enforces the policy: 8+ characters with a letter, a number and a symbol; not the Login ID; not the current one", async () => {
    const { t, userId, acc } = await setup();
    const me = await as(t, userId);
    for (const weak of ["Sh0rt!", "NoSymbol123", "NoDigits!!x", "12345678!", `${acc.loginId.toLowerCase()}#1`, acc.temporaryPassword]) {
      expect(await errorCode(me.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: weak }))).toBe("INVALID_ARGUMENT");
    }
    expect((await userRow(t, userId))?.requiresPasswordChange).toBe(true);
    expect(await signInResult(t, acc.loginId, acc.temporaryPassword)).toBe("OK");
  });

  test("success: salted hash stored, flag cleared, other sessions signed out, audited without secrets", async () => {
    const { t, A, userId, acc } = await setup();
    const other = await as(t, userId); // e.g. another device
    const me = await as(t, userId);
    await me.action(api.account.changePassword, { currentPassword: acc.temporaryPassword, newPassword: OWN_PASSWORD });

    expect((await userRow(t, userId))?.requiresPasswordChange).toBeUndefined();
    expect((await me.query(api.users.session, {})).status).toBe("signedIn"); // this session stays
    expect((await other.query(api.users.session, {})).status).toBe("signedOut"); // the others end
    expect(await signInResult(t, acc.loginId, acc.temporaryPassword)).toMatch(/InvalidSecret/);
    expect(await signInResult(t, acc.loginId, OWN_PASSWORD)).toBe("OK");

    const stored = await t.run(async (ctx) => ({
      account: await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", acc.loginId)).first(),
      audit: (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === "account.password_changed"),
    }));
    expect(stored.account?.secret).toBeDefined();
    expect(stored.account?.secret).not.toContain(OWN_PASSWORD);
    expect(stored.audit).toHaveLength(1);
    expect(stored.audit[0]).toMatchObject({ schoolId: A.schoolId, actorUserId: userId, entity: { table: "schoolMemberships", id: acc.membershipId }, metadata: { firstChange: true } });
    expect(JSON.stringify(stored.audit)).not.toContain(OWN_PASSWORD);
    expect(JSON.stringify(stored.audit)).not.toContain(acc.temporaryPassword);
  });

  test("a signed-in person can change their password again later (voluntary change)", async () => {
    const { t, userId, acc } = await setup();
    const me = await changeOwnPassword(t, userId, acc.temporaryPassword);
    await me.action(api.account.changePassword, { currentPassword: OWN_PASSWORD, newPassword: "Second#Pass9" });
    expect(await signInResult(t, acc.loginId, "Second#Pass9")).toBe("OK");
    expect((await userRow(t, userId))?.requiresPasswordChange).toBeUndefined();
  });

  test("the browser rules mirror the server policy", () => {
    const cases = ["", "Sh0rt!", "NoSymbol123", "NoDigits!!x", "12345678!", "ALPHABALA#1x", "Good#Pass1", "pass phrase 9!", "x".repeat(130) + "1!"];
    for (const p of cases) {
      let server: string | null = null;
      try { validateOwnPassword(p, "ALPHABALA"); } catch { server = "invalid"; }
      expect([p, newPasswordProblem(p, "ALPHABALA") === null]).toEqual([p, server === null]);
    }
  });
});

describe("SEC-05: post-sign-in redirect", () => {
  test.each([
    ["https://evil.example/login"], ["http://evil.example"], ["//evil.example/x"], ["/\\evil.example"], ["\\\\evil.example"],
    ["javascript:alert(1)"], ["JaVaScRiPt:alert(1)"], ["data:text/html,hi"], ["admin/dashboard"], ["/admin\t/x"], ["/\u0000x"], [""], [null],
  ])("rejects %s", (next) => {
    expect(safeInternalPath(next as string | null)).toBeNull();
  });

  test("keeps same-origin paths with their query and hash", () => {
    expect(safeInternalPath("/student/dashboard")).toBe("/student/dashboard");
    expect(safeInternalPath("/admin/fees?tab=dues#top")).toBe("/admin/fees?tab=dues#top");
    expect(safeInternalPath("/teacher/../admin")).toBe("/admin"); // normalised, still same-origin
  });

  test("the login screen sanitizes `next` before navigating", () => {
    const src = readFileSync(join(ROOT, "src/features/auth/login-screen.tsx"), "utf8");
    expect(src).toMatch(/safeInternalPath\(params\.get\("next"\)\)/);
    expect(src).not.toMatch(/const next = params\.get\("next"\);/);
  });
});

describe("SEC-04: TC verification QR is generated locally", () => {
  test("no third-party QR service is referenced anywhere in src/", () => {
    const src = readFileSync(join(ROOT, "src/features/students/lifecycle/tc-document.tsx"), "utf8");
    expect(src).not.toMatch(/qrserver|https?:\/\/[^"'`\s]*qr/i);
  });

  test("qrSvgPath builds a valid QR matrix as an SVG path", () => {
    const { modules, d } = qrSvgPath("https://school.example/verify/tc/0123456789ABCDEF");
    expect(modules).toBeGreaterThanOrEqual(21); // version 1 or larger
    expect((modules - 17) % 4).toBe(0); // QR sizes are 17 + 4·version
    expect(d).toMatch(/^(M\d+,\d+h1v1h-1z)+$/);
    // Finder pattern: the top-left module is always dark.
    expect(d.startsWith("M0,0h1v1h-1z")).toBe(true);
    expect(qrSvgPath("https://school.example/verify/tc/0123456789ABCDEF")).toEqual({ modules, d }); // deterministic
  });
});

describe("SEC-03: security headers", () => {
  test("every route sends CSP, HSTS, frame, nosniff and referrer headers; X-Powered-By is off", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    const h = Object.fromEntries((all?.headers ?? []).map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    const csp = h["Content-Security-Policy"];
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/qrserver|\*(?!\.)/); // no third-party QR host, no bare wildcard source
  });
});

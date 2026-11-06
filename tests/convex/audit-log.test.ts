/**
 * Audit logging (convex/audit.ts, convex/model/audit.ts): categories and actor
 * names on every entry, the /admin/audit viewer query (filters, pagination,
 * access), CSV export (formula-safe, itself audited), sign-in / one-time-code
 * events, the category backfill, and the append-only guarantee.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, captureEmails, changeOwnPassword, createSchool, enableSignIn, errorCode, makeTest, type T } from "./fixtures";
import { ACCOUNTANT_ACCESS } from "../../convex/core/grants";
import { AUDIT_CATEGORIES, auditCategoryOf, auditOutcomeOf } from "../../convex/core/auditCategories";
import { csvCell, toCsv, writeAudit } from "../../convex/model/audit";
import { OTP_MAX_ATTEMPTS } from "../../convex/credentials";
import { actionLabel, dateRangeMs, diffOf, otherDetails, serverFilters } from "../../src/features/audit/audit-format";

beforeAll(() => enableSignIn());
let mail: ReturnType<typeof captureEmails> | null = null;
afterEach(() => { mail?.restore(); mail = null; });

const page = { numItems: 50, cursor: null };
const ROOT = join(__dirname, "../..");

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  const admin = await as(t, A.users.admin);
  return { t, A, B, admin };
}

/** Write rows directly (as the mutations would), at controlled times. */
async function seedRows(t: T, schoolId: Id<"schools">, actor: { userId: Id<"users">; role: "admin" | "teacher" | "student"; displayName: string } | null, rows: [action: string, summary: string, metadata?: Record<string, unknown>][]) {
  return await t.run(async (ctx) => {
    const ids = [];
    for (const [action, summary, metadata] of rows) {
      ids.push(await writeAudit(ctx, { schoolId, actor, action, entity: { table: "students", id: `ent-${action}` }, summary, metadata }));
    }
    return ids;
  });
}

describe("every entry gets a category and the actor's name", () => {
  test("writeAudit derives category from the action and records the display name", async () => {
    const { t, A } = await setup();
    const [id] = await seedRows(t, A.schoolId, { userId: A.users.admin, role: "admin", displayName: "Principal Rao" }, [["fees.payment_recorded", "Paid"]]);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ category: "FEES", actorName: "Principal Rao", actorRole: "admin" });
    // Without a display name, the membership's name in that school is used.
    const [id2] = await t.run(async (ctx) => [await writeAudit(ctx, { schoolId: A.schoolId, actor: { userId: A.users.classTeacher, role: "teacher" }, action: "attendance.marked", entity: { table: "sections", id: "s" }, summary: "Marked" })]);
    expect(await t.run((ctx) => ctx.db.get(id2))).toMatchObject({ category: "ACADEMICS", actorName: "teacher" });
  });

  test("category and outcome mapping", () => {
    expect(auditCategoryOf("auth.signed_in")).toBe("AUTHENTICATION");
    expect(auditCategoryOf("PASSWORD_OVERWRITE")).toBe("AUTHENTICATION");
    expect(auditCategoryOf("credential.otp_failed")).toBe("AUTHENTICATION");
    expect(auditCategoryOf("account.password_changed")).toBe("AUTHENTICATION");
    expect(auditCategoryOf("account.disabled")).toBe("STAFF");
    expect(auditCategoryOf("membership.permissions_changed")).toBe("STAFF");
    expect(auditCategoryOf("student.tc_issued")).toBe("STUDENTS");
    expect(auditCategoryOf("students.promoted")).toBe("STUDENTS");
    expect(auditCategoryOf("enrollment.transferred")).toBe("STUDENTS");
    expect(auditCategoryOf("fees.concession_added")).toBe("FEES");
    expect(auditCategoryOf("marks.entered")).toBe("ACADEMICS");
    expect(auditCategoryOf("school.settings_updated")).toBe("SETTINGS");
    expect(auditCategoryOf("something.new")).toBe("SETTINGS");
    expect(auditOutcomeOf("credential.otp_failed")).toBe("failed");
    expect(auditOutcomeOf("credential.otp_locked")).toBe("blocked");
    expect(auditOutcomeOf("fees.payment_recorded")).toBe("success");
  });

  test("every action written in convex/ maps to a known category", () => {
    const dir = join(ROOT, "convex");
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts") && !f.includes("_generated"));
    const actions = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(dir, f), "utf8").matchAll(/action: "([a-z_]+\.[a-z_]+)"/g)) actions.add(m[1]);
    expect(actions.size).toBeGreaterThan(60);
    for (const a of actions) expect(AUDIT_CATEGORIES).toContain(auditCategoryOf(a));
  });
});

describe("getAuditLogs (the /admin/audit viewer)", () => {
  test("only audit:read (full administrators) — teachers, students and accountants are refused; other schools are invisible", async () => {
    const { t, A, B, admin } = await setup();
    await seedRows(t, A.schoolId, null, [["school.seeded", "Seeded A"]]);
    await seedRows(t, B.schoolId, null, [["school.seeded", "Seeded B"]]);
    const accountantUser = await t.run((ctx) => ctx.db.insert("users", { email: "acc@alpha.test" }));
    await t.run((ctx) => ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: accountantUser, displayName: "Accountant", role: "admin", status: "active", permissionSets: [], ...ACCOUNTANT_ACCESS }));
    for (const u of [A.users.classTeacher, A.users.student, accountantUser]) {
      const c = await as(t, u);
      expect(await errorCode(c.query(api.audit.getAuditLogs, { paginationOpts: page }))).toBe("FORBIDDEN");
      expect(await errorCode(c.action(api.audit.exportAuditLogsCsv, {}))).toBe("FORBIDDEN");
    }
    expect(await errorCode(t.query(api.audit.getAuditLogs, { paginationOpts: page }))).toBe("UNAUTHENTICATED");
    const rows = (await admin.query(api.audit.getAuditLogs, { paginationOpts: page })).page;
    expect(rows.map((r) => r.summary)).toEqual(["Seeded A"]);
  });

  test("filters: category, actor role (incl. system), date range and text search; newest first", async () => {
    const { t, A, admin } = await setup();
    const principal = { userId: A.users.admin, role: "admin" as const, displayName: "Principal Rao" };
    const teacher = { userId: A.users.classTeacher, role: "teacher" as const, displayName: "Anita Desai" };
    const tick = () => new Promise((r) => setTimeout(r, 15)); // distinct creation times for the date filter
    await seedRows(t, A.schoolId, principal, [["fees.payment_recorded", "Payment from ALPHABALA", { targetLoginId: "ALPHABALA" }]]);
    await tick();
    await seedRows(t, A.schoolId, teacher, [["attendance.corrected", "Corrected 8-A"]]);
    await tick();
    const [sysId] = await seedRows(t, A.schoolId, null, [["school.modules_changed", "Modules changed"]]);
    const q = (args: Record<string, unknown>) => admin.query(api.audit.getAuditLogs, { ...args, paginationOpts: page }).then((r) => r.page.map((x) => x.summary));

    expect(await q({})).toEqual(["Modules changed", "Corrected 8-A", "Payment from ALPHABALA"]);
    expect(await q({ category: "FEES" })).toEqual(["Payment from ALPHABALA"]);
    expect(await q({ category: "ACADEMICS" })).toEqual(["Corrected 8-A"]);
    expect(await q({ actorRole: "teacher" })).toEqual(["Corrected 8-A"]);
    expect(await q({ actorRole: "system" })).toEqual(["Modules changed"]);
    expect(await q({ search: "anita" })).toEqual(["Corrected 8-A"]); // actor name
    expect(await q({ search: "alphabala" })).toEqual(["Payment from ALPHABALA"]); // affected account / scholar no.
    expect(await q({ search: "ent-school.modules_changed" })).toEqual(["Modules changed"]); // entity id
    const sysAt = (await t.run((ctx) => ctx.db.get(sysId)))!._creationTime;
    expect(await q({ startDate: sysAt })).toEqual(["Modules changed"]);
    expect(await q({ endDate: sysAt - 1 })).toEqual(["Corrected 8-A", "Payment from ALPHABALA"]);
    expect(await errorCode(admin.query(api.audit.getAuditLogs, { startDate: 10, endDate: 5, paginationOpts: page }))).toBe("INVALID_ARGUMENT");

    const [row] = (await admin.query(api.audit.getAuditLogs, { category: "FEES", paginationOpts: page })).page;
    expect(row).toMatchObject({ category: "FEES", outcome: "success", actorRole: "admin", target: "ALPHABALA", actor: { name: "Principal Rao", profile: "Administrator" } });
  });

  test("paginates newest first", async () => {
    const { t, A, admin } = await setup();
    await seedRows(t, A.schoolId, null, Array.from({ length: 7 }, (_, i) => [`school.step_${i}`, `Step ${i}`] as [string, string]));
    const first = await admin.query(api.audit.getAuditLogs, { paginationOpts: { numItems: 4, cursor: null } });
    const second = await admin.query(api.audit.getAuditLogs, { paginationOpts: { numItems: 4, cursor: first.continueCursor } });
    expect([...first.page, ...second.page].map((r) => r.summary)).toEqual(["Step 6", "Step 5", "Step 4", "Step 3", "Step 2", "Step 1", "Step 0"]);
    expect(second.isDone).toBe(true);
  });
});

describe("CSV export", () => {
  test("filtered, formula-safe, and the export itself is audited", async () => {
    const { t, A, admin } = await setup();
    await seedRows(t, A.schoolId, { userId: A.users.admin, role: "admin", displayName: "=HYPERLINK(\"x\")" }, [["fees.payment_recorded", "Paid \"in full\""]]);
    await seedRows(t, A.schoolId, null, [["school.seeded", "Seeded"]]);
    const r = await admin.action(api.audit.exportAuditLogsCsv, { category: "FEES" });
    expect(r).toMatchObject({ rowCount: 1, truncated: false });
    expect(r.fileName).toMatch(/^audit-log-alpha-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = r.csv.replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Timestamp (UTC)"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`); // neutralised formula, doubled quotes
    expect(lines[1]).toContain('"Paid ""in full"""');
    expect(r.csv).not.toContain("Seeded");
    const exported = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((x) => x.action === "audit.exported"));
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ actorUserId: A.users.admin, metadata: { rowCount: 1, filters: { category: "FEES" } } });
  });

  test("csvCell escapes quotes and spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    for (const f of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"]) expect(csvCell(f).startsWith(`"'`)).toBe(true);
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe('"a","b"\r\n"c","d"');
  });
});

describe("authentication events", () => {
  test("a successful sign-in is audited in the person's school", async () => {
    const { t, A, admin } = await setup();
    const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", loginId: acc.loginId, password: acc.temporaryPassword } });
    const rows = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((x) => x.action === "auth.signed_in"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schoolId: A.schoolId, category: "AUTHENTICATION", actorRole: "student", entity: { table: "schoolMemberships", id: acc.membershipId }, metadata: { targetLoginId: acc.loginId } });
    expect(JSON.stringify(rows)).not.toContain(acc.temporaryPassword);
  });

  test("one-time codes: request, wrong attempts and the lock are audited (never the code)", async () => {
    const { t, A, admin } = await setup();
    const acc = await admin.action(api.accounts.create, { person: { kind: "student", studentId: A.studentB } });
    const studentUser = await t.run(async (ctx) => (await ctx.db.get(acc.membershipId))!.userId!);
    await changeOwnPassword(t, studentUser, acc.temporaryPassword);
    mail = captureEmails();
    const { challengeId } = await admin.action(api.credentials.requestPasswordOverwriteOtp, { targetMembershipId: acc.membershipId });
    const code = mail.lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await errorCode(admin.action(api.credentials.verifyOtpAndSetPassword, { challengeId, code: wrong, newPassword: "Guess#2026x" }));
    const rows = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((x) => x.action.startsWith("credential.")));
    expect(rows.map((r) => r.action)).toEqual(["credential.otp_requested", ...Array(OTP_MAX_ATTEMPTS - 1).fill("credential.otp_failed"), "credential.otp_locked"]);
    expect(rows.every((r) => r.category === "AUTHENTICATION" && r.actorUserId === A.users.admin && r.entity.id === acc.membershipId)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(code);
    const viewer = (await admin.query(api.audit.getAuditLogs, { search: "locked", paginationOpts: page })).page;
    expect(viewer[0]).toMatchObject({ action: "credential.otp_locked", outcome: "blocked" });
  });
});

describe("student edits record before/after", () => {
  test("student.updated carries the changed fields' old and new values", async () => {
    const { t, A, admin } = await setup();
    await admin.mutation(api.students.updateStudentProfile, { studentId: A.studentA, phone: "+91 98100 00099", bloodGroup: "o+" });
    const [row] = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((x) => x.action === "student.updated"));
    expect(row.metadata).toMatchObject({ before: { phone: null, bloodGroup: null }, after: { bloodGroup: "O+" } });
    expect((row.metadata as { after: { phone: string } }).after.phone).toMatch(/98100/);
  });
});

describe("viewer helpers (src/features/audit/audit-format.ts)", () => {
  test("action labels", () => {
    expect(actionLabel("fees.payment_recorded")).toBe("Payment recorded");
    expect(actionLabel("student.updated")).toBe("Student updated");
    expect(actionLabel("credential.otp_failed")).toBe("OTP failed");
    expect(actionLabel("student.tc_issued")).toBe("TC issued");
    expect(actionLabel("PASSWORD_OVERWRITE")).toBe("Password overwrite");
  });

  test("before/after and from/to diffs; other details exclude them", () => {
    expect(diffOf({ before: { phone: "1", city: "A" }, after: { phone: "2", city: "A" }, fields: ["phone"] })).toEqual([
      { field: "phone", before: "1", after: "2", changed: true },
      { field: "city", before: "A", after: "A", changed: false },
    ]);
    expect(diffOf({ from: { status: "active" }, to: { status: "suspended" } })).toEqual([{ field: "status", before: "active", after: "suspended", changed: true }]);
    expect(diffOf({ amountMinor: 5 })).toBeNull();
    expect(otherDetails({ before: {}, after: {}, fields: ["x"] })).toEqual({ fields: ["x"] });
  });

  test("filter state → server arguments (empty values omitted, inclusive local-day range)", () => {
    expect(serverFilters({ search: "  ", category: "", actorRole: "", from: "", to: "" })).toEqual({});
    const r = dateRangeMs("2026-11-01", "2026-11-02");
    expect(r.endDate! - r.startDate!).toBe(2 * 86_400_000 - 1);
    expect(serverFilters({ search: " bala ", category: "FEES", actorRole: "system", from: "", to: "" })).toEqual({ search: "bala", category: "FEES", actorRole: "system" });
  });
});

describe("append-only", () => {
  test("backfillCategories fills only the derived category of old rows", async () => {
    const { t, A } = await setup();
    const id = await t.run((ctx) => ctx.db.insert("auditLogs", { schoolId: A.schoolId, action: "fees.payment_recorded", entity: { table: "x", id: "1" }, summary: "Old row" }));
    const before = await t.run((ctx) => ctx.db.get(id));
    await t.mutation(internal.audit.backfillCategories, {});
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after).toEqual({ ...before, category: "FEES" });
  });

  test("no public function writes audit rows, and nothing but the backfill patches or deletes them", () => {
    const audit = readFileSync(join(ROOT, "convex/audit.ts"), "utf8");
    const publicBuilders = [...audit.matchAll(/export const (\w+) = (\w+)\(/g)].filter(([, , b]) => !b.startsWith("internal"));
    expect(publicBuilders.map(([, n, b]) => `${n}:${b}`).sort()).toEqual(["actions:schoolQuery", "exportAuditLogsCsv:schoolAction", "feed:schoolQuery", "getAuditLogs:schoolQuery", "list:schoolQuery"]);
    // Writes to auditLogs: inserts only through model/audit.ts; the single patch is the category backfill.
    const dir = join(ROOT, "convex");
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts") && !f.includes("_generated"));
    const inserts = files.filter((f) => /insert\("auditLogs"/.test(readFileSync(join(dir, f), "utf8")));
    expect(inserts.map((f) => f.replace(/\\/g, "/"))).toEqual(["model/audit.ts"]);
    expect(audit.match(/ctx\.db\.(patch|replace|delete)\(/g)).toEqual(["ctx.db.patch("]);
  });
});

/**
 * Bulk student-account creation (convex/bulkAccounts.ts).
 */
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { as, createSchool, errorCode, makeTest, type T } from "./fixtures";
import { BULK_BATCH_SIZE, PREPARE_PAGE, STALE_CLAIM_MS } from "../../convex/bulkAccounts";
import { toCsv } from "../../src/features/imports/spreadsheet";

type Admin = Awaited<ReturnType<typeof as>>;

/** Add `n` active students to section A of the fixture school (no accounts). */
async function addStudents(t: T, A: Awaited<ReturnType<typeof createSchool>>, n: number, prefix = "Stu") {
  return await t.run(async (ctx) => {
    const ids: Id<"students">[] = [];
    for (let i = 0; i < n; i++) {
      const id = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: `${prefix}-${i}`, firstName: `${prefix}${String(i).padStart(4, "0")}`, lastName: "Bulk", status: "active", admissionDate: "2026-04-01" });
      await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: id, academicYearId: A.yearId, classId: A.classId, sectionId: A.sectionB, rollNo: i + 2, status: "active", startDate: "2026-04-01" });
      ids.push(id);
    }
    return ids;
  });
}

/** Drive a run the way the browser does: prepare → start → processBatch until done, acknowledging every batch. */
async function runJob(admin: Admin, jobId: Id<"bulkAccountJobs">, opts: { ack?: boolean } = {}) {
  for (;;) { const r = await admin.mutation(api.bulkAccounts.prepareJob, { jobId }); if (r.done) break; }
  const job = await admin.query(api.bulkAccounts.getJob, { jobId });
  if (job.status === "ready") await admin.mutation(api.bulkAccounts.startJob, { jobId });
  const creds: { itemId: Id<"bulkAccountJobItems">; loginId: string; temporaryPassword: string; displayName: string; admissionNo: string }[] = [];
  let calls = 0;
  for (;;) {
    const r = await admin.action(api.bulkAccounts.processBatch, { jobId });
    calls++;
    expect(r.credentials.length).toBeLessThanOrEqual(BULK_BATCH_SIZE);
    creds.push(...r.credentials);
    if (opts.ack !== false && r.credentials.length) await admin.mutation(api.bulkAccounts.acknowledge, { jobId, itemIds: r.credentials.map((c) => c.itemId) });
    if (r.done) break;
  }
  return { creds, calls, job: await admin.query(api.bulkAccounts.getJob, { jobId }) };
}

async function setup(n = 0) {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const admin = await as(t, A.users.admin);
  const ids = n ? await addStudents(t, A, n) : [];
  return { t, A, admin, ids };
}

const studentAccounts = (t: T) => t.run(async (ctx) => (await ctx.db.query("schoolMemberships").collect()).filter((m) => m.role === "student" && m.studentId));

describe("bulk account creation", () => {
  test("selected students get accounts with the existing policies; existing accounts are skipped; roll numbers untouched", async () => {
    const { t, A, admin, ids } = await setup(3);
    const rollsBefore = await t.run(async (ctx) => (await ctx.db.query("enrollments").collect()).map((e) => [e._id, e.rollNo]));
    // A.studentA already has an active account (fixture).
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: [ids[0], ids[1], ids[2], A.studentA] } });
    const ready = await admin.query(api.bulkAccounts.getJob, { jobId });
    expect(ready).toMatchObject({ status: "ready", total: 4, queued: 3, skipped: 1, batches: 1 });
    const skipped = await admin.query(api.bulkAccounts.jobItems, { jobId, status: "skipped" });
    expect(skipped.map((s) => s.reason)).toEqual(["Already has an account"]);
    const { creds, job } = await runJob(admin, jobId);
    expect(job).toMatchObject({ status: "completed", created: 3, skipped: 1, failed: 0, delivered: 3, undelivered: 0 });
    expect(creds.map((c) => c.admissionNo).sort()).toEqual(["Stu-0", "Stu-1", "Stu-2"]);
    expect(new Set(creds.map((c) => c.loginId)).size).toBe(3);
    expect(creds.every((c) => /^STU-2026-\d{5}$/.test(c.loginId) && /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(c.temporaryPassword))).toBe(true);

    const state = await t.run(async (ctx) => {
      const users = [];
      for (const c of creds) users.push(await ctx.db.query("users").withIndex("by_login_id", (q) => q.eq("loginId", c.loginId)).unique());
      return { users, rolls: (await ctx.db.query("enrollments").collect()).map((e) => [e._id, e.rollNo]), items: await ctx.db.query("bulkAccountJobItems").collect() };
    });
    expect(state.users.every((u) => u?.mustChangePassword === true && (u.temporaryPasswordIssuedAt ?? 0) > 0)).toBe(true);
    expect(state.rolls).toEqual(rollsBefore); // creating accounts never touches enrollments
    expect(JSON.stringify(state.items)).not.toMatch(/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}/); // no password stored
    // The temporary password works and is forced to change.
    const u0 = state.users[0]!;
    const student = await as(t, u0._id);
    expect(await errorCode(student.query(api.users.viewer, {}))).toBe("PASSWORD_CHANGE_REQUIRED");
    await student.action(api.account.changePassword, { currentPassword: creds.find((c) => c.loginId === u0.loginId)!.temporaryPassword, newPassword: "Chosen2026" });
    expect((await student.query(api.users.viewer, {})).role).toBe("student");
    // Audit: start + completion, without passwords.
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action.startsWith("accounts.bulk_")));
    expect(audit.map((a) => a.action).sort()).toEqual(["accounts.bulk_completed", "accounts.bulk_started"]);
    expect(JSON.stringify(audit)).not.toContain(creds[0].temporaryPassword);
  });

  test("“all matching” is snapshotted on the server across pages and is not widened by later changes", async () => {
    const n = PREPARE_PAGE + 60;
    const { t, A, admin } = await setup(n);
    const counts = await admin.query(api.bulkAccounts.scopeCounts, {});
    expect(counts).toMatchObject({ total: n + 2, withAccount: 1, withoutAccount: n + 1, capped: false }); // + fixture students A (account) and B
    const section = await admin.query(api.bulkAccounts.scopeCounts, { sectionId: A.sectionB });
    expect(section).toMatchObject({ total: n + 1, withoutAccount: n + 1 });

    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "all", sectionId: A.sectionB } });
    let calls = 0;
    for (;;) { calls++; if ((await admin.mutation(api.bulkAccounts.prepareJob, { jobId })).done) break; }
    expect(calls).toBe(2); // two bounded pages
    expect(await admin.query(api.bulkAccounts.getJob, { jobId })).toMatchObject({ status: "ready", total: n + 1, queued: n + 1, batches: Math.ceil((n + 1) / BULK_BATCH_SIZE) });
    // A student added after the snapshot is NOT part of the confirmed run.
    const [late] = await addStudents(t, A, 1, "Late");
    const { job } = await runJob(admin, jobId);
    expect(job).toMatchObject({ status: "completed", created: n + 1, skipped: 0, failed: 0 });
    const accounts = await studentAccounts(t);
    expect(accounts.some((m) => m.studentId === late)).toBe(false);
    expect(accounts.some((m) => m.studentId === A.studentA && m.loginId === undefined)).toBe(true); // fixture account untouched
    expect(new Set(accounts.map((m) => m.studentId)).size).toBe(accounts.length); // one account per student
  }, 240000);

  test("duplicate and concurrent requests never create a second account", async () => {
    const { t, admin, ids } = await setup(30);
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } });
    expect(await errorCode(admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } }))).toBe("CONFLICT");
    await admin.mutation(api.bulkAccounts.startJob, { jobId });
    // Two "tabs" processing at once + the normal loop.
    const [a, b] = await Promise.all([admin.action(api.bulkAccounts.processBatch, { jobId }), admin.action(api.bulkAccounts.processBatch, { jobId })]);
    const first = [...a.credentials, ...b.credentials];
    await admin.mutation(api.bulkAccounts.acknowledge, { jobId, itemIds: first.map((c) => c.itemId) });
    const { creds, job } = await runJob(admin, jobId);
    const all = [...first, ...creds];
    expect(all).toHaveLength(30);
    expect(new Set(all.map((c) => c.loginId)).size).toBe(30);
    expect(job).toMatchObject({ status: "completed", created: 30, failed: 0, processing: 0, queued: 0 });
    // Running again after completion is a no-op.
    expect((await admin.action(api.bulkAccounts.processBatch, { jobId })).credentials).toHaveLength(0);
    // A second run for the same students skips them all.
    const again = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } });
    expect(await admin.query(api.bulkAccounts.getJob, { jobId: again })).toMatchObject({ queued: 0, skipped: 30 });
    const accounts = await studentAccounts(t);
    expect(accounts.filter((m) => ids.includes(m.studentId!))).toHaveLength(30);
    const logins = await t.run(async (ctx) => (await ctx.db.query("users").collect()).map((u) => u.loginId).filter(Boolean));
    expect(new Set(logins).size).toBe(logins.length); // unique Login IDs and counter consistency
  }, 120000);

  test("a lost batch response or a crashed batch is recovered without duplicates; undelivered passwords can be re-issued", async () => {
    const { t, A, admin, ids } = await setup(4);
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } });
    await admin.mutation(api.bulkAccounts.startJob, { jobId });

    // Simulate a crash after an account was created but before the item was marked: claim + create the
    // account for ids[0] outside the batch, then make the claim stale.
    const claim = await admin.mutation(internal.bulkAccounts.claimBatch, { callerMembershipId: A.memberships.admin, jobId });
    expect(claim.items).toHaveLength(4);
    const created = await admin.action(api.accounts.create, { person: { kind: "student", studentId: ids[0] } });
    await t.run(async (ctx) => {
      for (const it of await ctx.db.query("bulkAccountJobItems").collect()) {
        if (it.status === "processing") await ctx.db.patch(it._id, { claimedAt: Date.now() - STALE_CLAIM_MS - 1000, ...(it.studentId === ids[0] ? { membershipId: created.membershipId } : {}) });
      }
    });
    // The response of the next batch is "lost": processed but never acknowledged.
    const { job } = await runJob(admin, jobId, { ack: false });
    expect(job).toMatchObject({ status: "completed", created: 4, failed: 0, delivered: 0, undelivered: 4 });
    expect((await studentAccounts(t)).filter((m) => ids.includes(m.studentId!))).toHaveLength(4); // never twice

    // Re-issue new temporary passwords for exactly the undelivered accounts, then acknowledge.
    const undelivered = await admin.query(api.bulkAccounts.jobItems, { jobId, status: "created", undeliveredOnly: true });
    expect(undelivered).toHaveLength(4);
    const re = await admin.action(api.accounts.issuePendingCredentials, { targetMembershipIds: undelivered.map((u) => u.membershipId!) });
    expect(re.every((r) => r.ok)).toBe(true);
    await admin.mutation(api.bulkAccounts.acknowledge, { jobId, itemIds: undelivered.map((u) => u.itemId) });
    expect(await admin.query(api.bulkAccounts.getJob, { jobId })).toMatchObject({ delivered: 4, undelivered: 0 });
    expect(await admin.query(api.bulkAccounts.activeJob, {})).toBeNull();
  });

  test("partial failures are reported and only the failed students are retried", async () => {
    const { t, A, admin, ids } = await setup(3);
    // ids[1] has a pending account whose Login ID is already taken in Convex Auth → createAccount fails.
    const bogus = await t.run(async (ctx) => {
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, loginId: "STU-2026-77777", displayName: "x", role: "student", status: "invited", permissionSets: [], studentId: ids[1] });
      const u = await ctx.db.insert("users", { name: "someone else" });
      return await ctx.db.insert("authAccounts", { userId: u, provider: "password", providerAccountId: "STU-2026-77777", secret: "x" });
    });
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } });
    let { job } = await runJob(admin, jobId);
    expect(job).toMatchObject({ status: "completed", created: 2, failed: 1 });
    const failed = await admin.query(api.bulkAccounts.jobItems, { jobId, status: "failed" });
    expect(failed).toMatchObject([{ admissionNo: "Stu-1", reason: "A sign-in account with this Login ID already exists" }]);
    // Fix the cause, retry only the failure.
    await t.run((ctx) => ctx.db.delete(bogus));
    expect(await admin.mutation(api.bulkAccounts.retryFailed, { jobId })).toMatchObject({ requeued: 1 });
    const second = await runJob(admin, jobId);
    job = second.job;
    expect(job).toMatchObject({ status: "completed", created: 3, failed: 0 });
    expect(second.creds.map((c) => c.loginId)).toEqual(["STU-2026-77777"]); // only the retried student
  });

  test("authorization: only school admins, only their school, only the initiator receives passwords", async () => {
    const { t, A, admin, ids } = await setup(2);
    const B = await createSchool(t, "beta");
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.query(api.bulkAccounts.scopeCounts, {}))).toBe("FORBIDDEN");
    expect(await errorCode((await as(t, A.users.student)).mutation(api.bulkAccounts.createJob, { scope: { type: "all" } }))).toBe("FORBIDDEN");
    // Another school's student in the selection → NOT_FOUND, nothing created.
    expect(await errorCode(admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: [ids[0], B.studentB] } }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.bulkAccounts.createJob, { scope: { type: "all", sectionId: B.sectionA } }))).toBe("NOT_FOUND");
    const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "selected", studentIds: ids } });
    await admin.mutation(api.bulkAccounts.startJob, { jobId });
    const otherAdmin = await as(t, B.users.admin);
    expect(await errorCode(otherAdmin.query(api.bulkAccounts.getJob, { jobId }))).toBe("NOT_FOUND");
    expect(await errorCode(otherAdmin.action(api.bulkAccounts.processBatch, { jobId }))).toBe("NOT_FOUND");
    // A second administrator of the same school cannot take over the run (passwords go to the initiator).
    const secondAdmin = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { name: "Vice" });
      await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: u, displayName: "Vice", role: "admin", status: "active", permissionSets: [] });
      return u;
    });
    expect(await errorCode((await as(t, secondAdmin)).action(api.bulkAccounts.processBatch, { jobId }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.action(api.bulkAccounts.processBatch, { jobId }))).toBe("FORBIDDEN");
    expect((await studentAccounts(t)).filter((m) => ids.includes(m.studentId!))).toHaveLength(0);
    // Forged extra arguments are rejected by validation.
    expect(await errorCode(admin.mutation(api.bulkAccounts.createJob, { scope: { type: "all" }, schoolId: B.schoolId } as never))).toMatch(/THROWN/);
  });

  test("credential CSV export contains only the new accounts and neutralises formulas", () => {
    const csv = toCsv([
      ["Student name", "Admission number", "Class", "Login ID", "Temporary password"],
      ["=HYPERLINK(\"http://x\")", "+91", "8-A", "STU-2026-00001", "Abcd-2345-Efgh"],
    ]);
    expect(csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""http://x"")","'+91","8-A","STU-2026-00001","Abcd-2345-Efgh"`);
  });
});

describe("scale (convex-test, real account creation incl. password hashing)", () => {
  for (const n of [25, 300]) {
    test(`${n} students`, async () => {
      const { t, admin } = await setup(n);
      const started = Date.now();
      const jobId = await admin.mutation(api.bulkAccounts.createJob, { scope: { type: "all" } });
      const { creds, calls, job } = await runJob(admin, jobId);
      const ms = Date.now() - started;
      // "all matching" = all WITHOUT an account: fixture student A (has one) is not part of the run.
      expect(job).toMatchObject({ status: "completed", total: n + 1, created: n + 1, skipped: 0, failed: 0, undelivered: 0 });
      expect(new Set(creds.map((c) => c.loginId)).size).toBe(n + 1);
      expect(calls).toBe(Math.ceil((n + 1) / BULK_BATCH_SIZE) + 1);
      const accounts = await studentAccounts(t);
      expect(new Set(accounts.map((m) => m.studentId)).size).toBe(accounts.length);
      console.log(`[scale] ${n + 1} accounts in ${calls} batches: ${ms} ms`);
    }, 900000);
  }
});

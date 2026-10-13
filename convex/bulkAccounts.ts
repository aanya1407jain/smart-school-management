/**
 * Bulk student-account creation (Admin → Accounts & Import), built on the SAME
 * account path as single accounts: reserveAccount (Login ID) → provisionAccount
 * (Convex Auth createAccount with a server-generated temporary password) →
 * createOrUpdateUser activates the membership with mustChangePassword.
 *
 * Lifecycle of a run ("job"):
 *   createJob   — selected students (explicit ids) or "all matching" (a filter)
 *   prepareJob  — "all matching" only: snapshots the matching students into
 *                 items, PREPARE_PAGE students per call (bounded, resumable).
 *                 After this the scope is fixed: later list changes cannot
 *                 widen what the administrator confirmed.
 *   startJob    — after the confirmation dialog.
 *   processBatch (action, called repeatedly by the initiator's browser) —
 *                 claims up to BULK_BATCH_SIZE queued items in a mutation,
 *                 creates their accounts and RETURNS the temporary passwords
 *                 to the caller. Passwords are never stored anywhere.
 *   acknowledge — the browser confirms it received a batch's passwords.
 *
 * Reliability:
 *   - Counters live on the job and change in the same transaction as the
 *     items they count, so progress is always exact.
 *   - Claims are exclusive (a mutation), so two tabs or a double click never
 *     process the same student twice. A claim older than STALE_CLAIM_MS (longer
 *     than Convex's action time limit, so its action is certainly gone) is
 *     re-queued.
 *   - Idempotent per student: an existing active account is skipped; an
 *     account this job already created is recognised (item.membershipId) and
 *     counted as created — never created twice. Uniqueness is ultimately
 *     enforced by reserveAccount (one student account per student) and by
 *     Convex Auth (one password account per Login ID).
 *   - If a batch response is lost, its accounts exist but their passwords were
 *     never seen: they show as "not delivered" and the administrator issues new
 *     temporary passwords for exactly those accounts (accounts.issuePendingCredentials).
 *
 * Authorization: every function requires `users:manage` in the caller's
 * school (server-derived); jobs and students of other schools are NOT_FOUND;
 * only the administrator who started a run can continue it or receive its
 * passwords.
 */
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { schoolAction, schoolMutation, schoolQuery } from "./core/functions";
import { requireActor, type Actor } from "./core/actor";
import { getCurrentAcademicYearId, getInSchool, requirePermission } from "./core/authorization";
import { conflict, forbidden, invalid } from "./core/errors";
import { fullName } from "./model/academics";
import { existingAccountFor, generateTemporaryPassword, provisionAccount, reserveAccount } from "./model/accounts";
import { writeAudit } from "./model/audit";

/**
 * Accounts per processBatch call. Measured on a local Convex backend: ~350 ms
 * per account (Scrypt hashing + account mutations), so a batch takes ~9 s —
 * far inside Convex's 10-minute action limit, and short enough for smooth
 * progress and cheap retries.
 */
export const BULK_BATCH_SIZE = 25;
/** Students snapshotted per prepareJob call (≈3 reads + 1 write each). */
export const PREPARE_PAGE = 200;
/** Largest explicit selection sent from the browser. */
export const MAX_SELECTED = 1000;
/** Largest run. Larger schools: run per section. */
export const MAX_JOB_SIZE = 10000;
/** A claim older than this belongs to a dead action (Convex actions time out after 10 minutes). */
export const STALE_CLAIM_MS = 11 * 60 * 1000;
/** Students counted by scopeCounts before reporting "more than". */
const COUNT_CAP = 10000;

const vScope = v.union(
  v.object({ type: v.literal("selected"), studentIds: v.array(v.id("students")) }),
  v.object({ type: v.literal("all"), sectionId: v.optional(v.id("sections")) }),
);
type Ctx = QueryCtx & { actor: Actor };
type Job = Doc<"bulkAccountJobs">;

// ================================================================ helpers

async function eligibility(ctx: QueryCtx, schoolId: Id<"schools">, student: Doc<"students">): Promise<{ status: "queued" } | { status: "skipped"; reason: string }> {
  if (student.status !== "active") return { status: "skipped", reason: "Student is not active" };
  const m = await existingAccountFor(ctx, schoolId, { role: "student", studentId: student._id });
  if (m && m.status === "suspended") return { status: "skipped", reason: "Already has an account (disabled)" };
  if (m && m.status !== "invited") return { status: "skipped", reason: "Already has an account" };
  return { status: "queued" };
}

/** The job, authorized: same school (else NOT_FOUND) and, by default, only its initiator. */
async function loadJob(ctx: Ctx, jobId: Id<"bulkAccountJobs">, opts: { initiatorOnly?: boolean } = { initiatorOnly: true }): Promise<Job> {
  requirePermission(ctx.actor, "users:manage");
  const job = await getInSchool(ctx, "bulkAccountJobs", jobId, "Account-creation run");
  if (opts.initiatorOnly !== false && job.createdByUserId !== ctx.actor.userId) {
    throw forbidden("Only the administrator who started this run can continue it.");
  }
  return job;
}

/**
 * Add one student to a run. Explicitly selected students are always recorded
 * (ineligible ones as "skipped" with the reason, so the report explains them);
 * an "all matching" scope means "all WITHOUT an account", so students who
 * already have one are simply not part of it.
 */
async function addItem(ctx: MutationCtx, job: Job, student: Doc<"students">, counts: { total: number; queued: number; skipped: number }) {
  const dup = await ctx.db.query("bulkAccountJobItems").withIndex("by_job_student", (q) => q.eq("jobId", job._id).eq("studentId", student._id)).first();
  if (dup) return;
  const e = await eligibility(ctx, job.schoolId, student);
  if (job.scope.type === "all" && e.status === "skipped") return;
  await ctx.db.insert("bulkAccountJobItems", {
    schoolId: job.schoolId, jobId: job._id, studentId: student._id, status: e.status, attempts: 0, delivered: false,
    ...(e.status === "skipped" ? { reason: e.reason } : {}),
  });
  counts.total++;
  if (e.status === "queued") counts.queued++; else counts.skipped++;
}

/** Move an item between statuses and keep the job counters exact (same transaction). */
async function transition(ctx: MutationCtx, item: Doc<"bulkAccountJobItems">, to: Doc<"bulkAccountJobItems">["status"], patch: Partial<Doc<"bulkAccountJobItems">> = {}) {
  const job = (await ctx.db.get(item.jobId))!;
  const counts: Record<string, number> = { queued: job.queued, processing: job.processing, created: job.created, skipped: job.skipped, failed: job.failed, cancelled: job.cancelled };
  counts[item.status]--;
  counts[to]++;
  await ctx.db.patch(item._id, { ...patch, status: to });
  await ctx.db.patch(job._id, counts);
}

async function currentSectionLabel(ctx: QueryCtx, schoolId: Id<"schools">, studentId: Id<"students">): Promise<string> {
  const yearId = await getCurrentAcademicYearId(ctx, schoolId);
  const enr = (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", studentId).eq("academicYearId", yearId)).collect()).find((e) => e.status === "active");
  const section = enr ? await ctx.db.get(enr.sectionId) : null;
  return section ? section.displayName : "";
}

function publicJob(job: Job) {
  return {
    _id: job._id, status: job.status, scope: job.scope, total: job.total, queued: job.queued, processing: job.processing,
    created: job.created, skipped: job.skipped, failed: job.failed, cancelled: job.cancelled, delivered: job.delivered,
    undelivered: job.created - job.delivered, startedAt: job.startedAt ?? null, finishedAt: job.finishedAt ?? null,
    batchSize: BULK_BATCH_SIZE, batches: Math.ceil(job.queued / BULK_BATCH_SIZE),
  };
}

// ================================================================ queries

/** How many students a filter matches, and how many still need an account. */
export const scopeCounts = schoolQuery({
  args: { sectionId: v.optional(v.id("sections")) },
  handler: async (ctx, { sectionId }) => {
    requirePermission(ctx.actor, "users:manage");
    const schoolId = ctx.actor.schoolId;
    let studentIds: Id<"students">[];
    if (sectionId) {
      await getInSchool(ctx, "sections", sectionId, "Section");
      studentIds = (await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).take(COUNT_CAP + 1)).map((e) => e.studentId);
    } else {
      studentIds = (await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", schoolId).eq("status", "active")).take(COUNT_CAP + 1)).map((s) => s._id);
    }
    const capped = studentIds.length > COUNT_CAP;
    const ids = new Set(studentIds.slice(0, COUNT_CAP));
    const withAccount = new Set<string>();
    const members = ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", schoolId).eq("role", "student"));
    for await (const m of members) {
      if (m.studentId && ids.has(m.studentId) && m.status !== "invited") withAccount.add(m.studentId);
    }
    return { total: ids.size, withAccount: withAccount.size, withoutAccount: ids.size - withAccount.size, capped };
  },
});

export const getJob = schoolQuery({
  args: { jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { jobId }) => publicJob(await loadJob(ctx, jobId)),
});

/** The caller's unfinished run (to resume after a reload), or null. */
export const activeJob = schoolQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.actor, "users:manage");
    const jobs = await ctx.db.query("bulkAccountJobs").withIndex("by_school_creator", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("createdByUserId", ctx.actor.userId)).order("desc").take(5);
    const open = jobs.find((j) => j.status === "preparing" || j.status === "ready" || j.status === "running" || (j.status === "completed" && j.created > j.delivered));
    return open ? publicJob(open) : null;
  },
});

/** Problem items of a run: failed and skipped (with reasons) and created-but-not-delivered. Bounded. */
export const jobItems = schoolQuery({
  args: { jobId: v.id("bulkAccountJobs"), status: v.union(v.literal("failed"), v.literal("skipped"), v.literal("created")), undeliveredOnly: v.optional(v.boolean()) },
  handler: async (ctx, { jobId, status, undeliveredOnly }) => {
    await loadJob(ctx, jobId);
    const items = await ctx.db.query("bulkAccountJobItems").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", status)).take(1000);
    const out = [];
    for (const it of items) {
      if (undeliveredOnly && it.delivered) continue;
      const s = await ctx.db.get(it.studentId);
      out.push({ itemId: it._id, name: s ? fullName(s) : "", admissionNo: s?.admissionNo ?? "", reason: it.reason ?? null, loginId: it.loginId ?? null, membershipId: it.membershipId ?? null });
      if (out.length >= 500) break;
    }
    return out;
  },
});

// ================================================================ mutations

export const createJob = schoolMutation({
  args: { scope: vScope },
  handler: async (ctx, { scope }) => {
    requirePermission(ctx.actor, "users:manage");
    const schoolId = ctx.actor.schoolId;
    const open = await ctx.db.query("bulkAccountJobs").withIndex("by_school_creator", (q) => q.eq("schoolId", schoolId).eq("createdByUserId", ctx.actor.userId)).order("desc").take(5);
    if (open.some((j) => j.status === "preparing" || j.status === "ready" || j.status === "running")) {
      throw conflict("You already have an account-creation run in progress. Resume or cancel it first.");
    }
    const base = {
      schoolId, createdByUserId: ctx.actor.userId, createdByMembershipId: ctx.actor.membershipId,
      total: 0, queued: 0, processing: 0, created: 0, skipped: 0, failed: 0, cancelled: 0, delivered: 0,
    };
    if (scope.type === "all") {
      if (scope.sectionId) await getInSchool(ctx, "sections", scope.sectionId, "Section");
      return await ctx.db.insert("bulkAccountJobs", { ...base, scope: { type: "all", ...(scope.sectionId ? { sectionId: scope.sectionId } : {}) }, status: "preparing" });
    }
    const ids = [...new Set(scope.studentIds)];
    if (ids.length === 0) throw invalid("Select at least one student.");
    if (ids.length > MAX_SELECTED) throw invalid(`Select at most ${MAX_SELECTED} students, or use "select all matching".`);
    const students = [];
    for (const id of ids) students.push(await getInSchool(ctx, "students", id, "Student")); // other schools → NOT_FOUND
    const jobId = await ctx.db.insert("bulkAccountJobs", { ...base, scope: { type: "selected" }, status: "ready" });
    const job = (await ctx.db.get(jobId))!;
    const counts = { total: 0, queued: 0, skipped: 0 };
    for (const s of students) await addItem(ctx, job, s, counts);
    await ctx.db.patch(jobId, counts);
    return jobId;
  },
});

/** Snapshot the next page of an "all matching" scope. Call until `done`. */
export const prepareJob = schoolMutation({
  args: { jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await loadJob(ctx, jobId);
    if (job.status !== "preparing" || job.scope.type !== "all") return { done: true };
    const paginationOpts = { numItems: PREPARE_PAGE, cursor: job.prepareCursor ?? null };
    const sectionId = job.scope.sectionId;
    let students: Doc<"students">[] = [];
    let isDone: boolean, continueCursor: string;
    if (sectionId) {
      const res = await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).paginate(paginationOpts);
      for (const e of res.page) { const s = await ctx.db.get(e.studentId); if (s && s.schoolId === job.schoolId) students.push(s); }
      ({ isDone, continueCursor } = res);
    } else {
      const res = await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", job.schoolId).eq("status", "active")).paginate(paginationOpts);
      students = res.page;
      ({ isDone, continueCursor } = res);
    }
    if (job.total + students.length > MAX_JOB_SIZE) {
      await ctx.db.patch(jobId, { status: "cancelled", finishedAt: Date.now(), prepareCursor: undefined });
      throw invalid(`More than ${MAX_JOB_SIZE} students match. Create accounts one section at a time.`);
    }
    const counts = { total: job.total, queued: job.queued, skipped: job.skipped };
    for (const s of students) await addItem(ctx, job, s, counts);
    await ctx.db.patch(jobId, { ...counts, ...(isDone ? { status: "ready" as const, prepareCursor: undefined } : { prepareCursor: continueCursor }) });
    return { done: isDone };
  },
});

export const startJob = schoolMutation({
  args: { jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await loadJob(ctx, jobId);
    if (job.status !== "ready") throw conflict(job.status === "preparing" ? "The run is still being prepared." : "This run has already started or finished.");
    const now = Date.now();
    await ctx.db.patch(jobId, job.queued === 0 ? { status: "completed", startedAt: now, finishedAt: now } : { status: "running", startedAt: now });
    await writeAudit(ctx, {
      schoolId: job.schoolId, actor: ctx.actor, action: "accounts.bulk_started", entity: { table: "bulkAccountJobs", id: jobId },
      summary: `Started creating student accounts: ${job.queued} to create, ${job.skipped} skipped of ${job.total} selected`,
      metadata: { jobId, total: job.total, queued: job.queued, skipped: job.skipped },
    });
    return { ok: true as const };
  },
});

export const cancelJob = schoolMutation({
  args: { jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await loadJob(ctx, jobId);
    if (job.status === "completed" || job.status === "cancelled") return { ok: true as const };
    // Queued items simply stay queued under a cancelled job (claims check the job status);
    // the counters say what happened. Items already being processed finish normally.
    await ctx.db.patch(jobId, { status: "cancelled", finishedAt: Date.now(), cancelled: job.cancelled + job.queued, queued: 0, prepareCursor: undefined });
    await writeAudit(ctx, {
      schoolId: job.schoolId, actor: ctx.actor, action: "accounts.bulk_cancelled", entity: { table: "bulkAccountJobs", id: jobId },
      summary: `Cancelled student account creation: ${job.created} created, ${job.queued} not processed`,
      metadata: { jobId, created: job.created, skipped: job.skipped, failed: job.failed, notProcessed: job.queued },
    });
    return { ok: true as const };
  },
});

/** Put failed items back in the queue (up to 500 per call). */
export const retryFailed = schoolMutation({
  args: { jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await loadJob(ctx, jobId);
    if (job.status === "cancelled" || job.status === "preparing") throw conflict("This run cannot be retried.");
    const failed = await ctx.db.query("bulkAccountJobItems").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "failed")).take(500);
    for (const it of failed) await transition(ctx, it, "queued", { reason: undefined });
    if (failed.length && job.status === "completed") await ctx.db.patch(jobId, { status: "running", finishedAt: undefined });
    return { requeued: failed.length, more: failed.length === 500 };
  },
});

/** The browser confirms it received the temporary passwords of these created items. */
export const acknowledge = schoolMutation({
  args: { jobId: v.id("bulkAccountJobs"), itemIds: v.array(v.id("bulkAccountJobItems")) },
  handler: async (ctx, { jobId, itemIds }) => {
    const job = await loadJob(ctx, jobId);
    if (itemIds.length > 200) throw invalid("Acknowledge at most 200 items at a time.");
    let n = 0;
    for (const id of itemIds) {
      const it = await ctx.db.get(id);
      if (!it || it.jobId !== jobId || it.status !== "created" || it.delivered) continue;
      await ctx.db.patch(id, { delivered: true });
      n++;
    }
    if (n) await ctx.db.patch(jobId, { delivered: job.delivered + n });
    return { acknowledged: n };
  },
});

// ================================================================ processing (internal)

export const claimBatch = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { callerMembershipId, jobId }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    const job = await loadJob({ ...ctx, actor }, jobId);
    if (job.status !== "running") return { items: [], done: true, status: job.status };
    const now = Date.now();
    // Re-queue claims whose action is certainly dead.
    const processing = await ctx.db.query("bulkAccountJobItems").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "processing")).take(BULK_BATCH_SIZE * 4);
    for (const it of processing) if ((it.claimedAt ?? 0) < now - STALE_CLAIM_MS) await transition(ctx, it, "queued");
    const queued = await ctx.db.query("bulkAccountJobItems").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "queued")).take(BULK_BATCH_SIZE);
    for (const it of queued) await transition(ctx, it, "processing", { claimedAt: now, attempts: it.attempts + 1 });
    if (queued.length === 0) {
      const fresh = (await ctx.db.get(jobId))!;
      if (fresh.processing === 0) {
        await ctx.db.patch(jobId, { status: "completed", finishedAt: now });
        await writeAudit(ctx, {
          schoolId: job.schoolId, actor, action: "accounts.bulk_completed", entity: { table: "bulkAccountJobs", id: jobId },
          summary: `Student account creation finished: ${fresh.created} created, ${fresh.skipped} skipped, ${fresh.failed} failed`,
          metadata: { jobId, total: fresh.total, created: fresh.created, skipped: fresh.skipped, failed: fresh.failed },
        });
        return { items: [], done: true, status: "completed" as const };
      }
      return { items: [], done: false, status: job.status }; // other claims still running
    }
    return { items: queued.map((it) => ({ itemId: it._id })), done: false, status: job.status };
  },
});

/** Decide what to do for one claimed item; reserve the Login ID if needed (idempotent). */
export const beginItem = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), itemId: v.id("bulkAccountJobItems") },
  handler: async (ctx, { callerMembershipId, itemId }): Promise<{ provision: false } | { provision: true; loginId: string; displayName: string; admissionNo: string; section: string }> => {
    const actor = await requireActor(ctx, callerMembershipId);
    const item = await getInSchool({ ...ctx, actor }, "bulkAccountJobItems", itemId, "Item");
    await loadJob({ ...ctx, actor }, item.jobId);
    if (item.status !== "processing") return { provision: false };
    const student = await ctx.db.get(item.studentId);
    if (!student || student.schoolId !== actor.schoolId) { await transition(ctx, item, "skipped", { reason: "Student not found" }); return { provision: false }; }
    if (student.status !== "active") { await transition(ctx, item, "skipped", { reason: "Student is not active" }); return { provision: false }; }
    const existing = await existingAccountFor(ctx, actor.schoolId, { role: "student", studentId: student._id });
    if (existing && existing.status !== "invited") {
      if (item.membershipId === existing._id) {
        // This run created it earlier but the batch result was lost: never create twice.
        await transition(ctx, item, "created", { loginId: existing.loginId, reason: "Created earlier in this run; password not delivered" });
      } else {
        await transition(ctx, item, "skipped", { reason: existing.status === "suspended" ? "Already has an account (disabled)" : "Already has an account" });
      }
      return { provision: false };
    }
    let membershipId: Id<"schoolMemberships">, loginId: string;
    if (existing) {
      if (!existing.loginId) { await transition(ctx, item, "failed", { reason: "Pending account has no Login ID" }); return { provision: false }; }
      membershipId = existing._id; loginId = existing.loginId;
    } else {
      const yearId = await getCurrentAcademicYearId(ctx, actor.schoolId);
      const year = await ctx.db.get(yearId);
      const reserved = await reserveAccount(ctx, {
        schoolId: actor.schoolId, role: "student", kind: "student", year: student.admissionDate?.slice(0, 4) ?? year?.startDate.slice(0, 4),
        displayName: fullName(student), email: student.email, studentId: student._id, createdByUserId: actor.userId,
      });
      membershipId = reserved.membershipId; loginId = reserved.loginId;
    }
    await ctx.db.patch(item._id, { membershipId, loginId });
    return { provision: true, loginId, displayName: fullName(student), admissionNo: student.admissionNo, section: await currentSectionLabel(ctx, actor.schoolId, student._id) };
  },
});

export const finishItem = internalMutation({
  args: { callerMembershipId: v.optional(v.id("schoolMemberships")), itemId: v.id("bulkAccountJobItems"), ok: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, { callerMembershipId, itemId, ok, reason }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    const item = await getInSchool({ ...ctx, actor }, "bulkAccountJobItems", itemId, "Item");
    await loadJob({ ...ctx, actor }, item.jobId);
    if (item.status !== "processing") return;
    await transition(ctx, item, ok ? "created" : "failed", ok ? { reason: undefined } : { reason: reason ?? "Could not create the account" });
  },
});

export type IssuedBulkCredential = { itemId: Id<"bulkAccountJobItems">; loginId: string; displayName: string; admissionNo: string; section: string; temporaryPassword: string };

/**
 * Process the next batch. Returns this batch's temporary passwords ONCE to the
 * initiator (they are not stored); call `acknowledge` after receiving them.
 */
export const processBatch = schoolAction({
  args: { jobId: v.id("bulkAccountJobs") },
  handler: async (ctx, { jobId }): Promise<{ done: boolean; status: string; credentials: IssuedBulkCredential[] }> => {
    const claim: { items: { itemId: Id<"bulkAccountJobItems"> }[]; done: boolean; status: string } =
      await ctx.runMutation(internal.bulkAccounts.claimBatch, { callerMembershipId: ctx.membershipId, jobId });
    const credentials: IssuedBulkCredential[] = [];
    for (const { itemId } of claim.items) {
      const begin: Infer<typeof vBegin> = await ctx.runMutation(internal.bulkAccounts.beginItem, { callerMembershipId: ctx.membershipId, itemId });
      if (!begin.provision) continue;
      const temporaryPassword = generateTemporaryPassword();
      try {
        await provisionAccount(ctx, { loginId: begin.loginId, password: temporaryPassword, mustChangePassword: true });
      } catch (e) {
        const msg = e instanceof Error && /already exists/i.test(e.message) ? "A sign-in account with this Login ID already exists" : "Could not create the account — retry later";
        await ctx.runMutation(internal.bulkAccounts.finishItem, { callerMembershipId: ctx.membershipId, itemId, ok: false, reason: msg });
        continue;
      }
      await ctx.runMutation(internal.bulkAccounts.finishItem, { callerMembershipId: ctx.membershipId, itemId, ok: true });
      credentials.push({ itemId, loginId: begin.loginId, displayName: begin.displayName, admissionNo: begin.admissionNo, section: begin.section, temporaryPassword });
    }
    return { done: claim.done, status: claim.status, credentials };
  },
});

const vBegin = v.union(
  v.object({ provision: v.literal(false) }),
  v.object({ provision: v.literal(true), loginId: v.string(), displayName: v.string(), admissionNo: v.string(), section: v.string() }),
);

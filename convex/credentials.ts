/**
 * Credentials — administrator-only lookup of sign-in accounts and the
 * OTP-authorized password overwrite. Nobody changes their own password.
 *
 *  - search / account: find an account by name, scholar number, employee ID
 *    or Login ID; shows who it is (role, class/section, designation) and its
 *    Login ID. Passwords are stored only as Scrypt hashes by Convex Auth, so
 *    no password can ever be shown here — a new one is shown once, to the
 *    administrator who sets it.
 *  - requestPasswordOverwriteOtp → verifyOtpAndSetPassword: overwriting the
 *    password of an account that has one. A 6-digit one-time code is emailed
 *    to the ADMINISTRATOR's own address (never the target's). It is bound to
 *    that administrator membership and that target account, expires after
 *    OTP_TTL_MS, allows OTP_MAX_ATTEMPTS wrong guesses, works once, and a new
 *    request replaces any open one. Only its salted SHA-256 hash is stored
 *    (credentialOtps); the new password is never stored. On success the
 *    target is signed out everywhere and the audit log gets a
 *    PASSWORD_OVERWRITE entry (admin, target, time).
 *
 * Every function requires an ADMIN membership with `users:manage`, checked on
 * the server; actions check inside the internal functions they call (which
 * run with the caller's identity). Records of another school are NOT_FOUND.
 */
import { v } from "convex/values";
import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { schoolAction, schoolQuery } from "./core/functions";
import { requireActor, type Actor } from "./core/actor";
import { getCurrentAcademicYearId, getInSchool, requirePermission } from "./core/authorization";
import { AppError, forbidden, invalid, notFound } from "./core/errors";
import { isAccountantGrants } from "./core/grants";
import { validatePassword } from "./auth";
import { accountState, credentialTarget } from "./accounts";
import { fullName, teacherDisplayName } from "./model/academics";
import { PASSWORD_PROVIDER, passwordIssuedFields } from "./model/accounts";
import { accountTarget, writeAudit } from "./model/audit";
import { emailUnavailable, isEmailAddress, sendEmail } from "./model/email";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** At most OTP_MAX_REQUESTS codes per administrator per OTP_REQUEST_WINDOW_MS. */
export const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;
export const OTP_MAX_REQUESTS = 5;
/** Audit action of an administrator's password overwrite. */
export const PASSWORD_OVERWRITE = "PASSWORD_OVERWRITE";
export const MAX_SEARCH_RESULTS = 25;
/** Largest number of accounts per role scanned by one search. */
const MAX_SCAN_PER_ROLE = 6000;
const MAX_TEACHERS = 2000;

/** Credentials are for administrators only — not teachers or students, whatever their grants. */
function requireCredentialAdmin(actor: Actor) {
  if (actor.role !== "admin") throw forbidden("Only administrators can manage sign-in credentials.");
  requirePermission(actor, "users:manage");
}

const callerArg = { callerMembershipId: v.optional(v.id("schoolMemberships")) };

// ================================================================ lookup

async function describeAccount(ctx: QueryCtx, actor: Actor, m: Doc<"schoolMemberships">, teacher: Doc<"teachers"> | null) {
  let classSection: string | null = null;
  let scholarNo: string | null = null;
  if (m.role === "student" && m.studentId) {
    const student = await ctx.db.get(m.studentId);
    scholarNo = student?.scholarNo ?? null;
    const yearId = await getCurrentAcademicYearId(ctx, actor.schoolId);
    const enrollment = (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", m.studentId!).eq("academicYearId", yearId)).collect())
      .find((e) => e.status === "active" && e.schoolId === actor.schoolId);
    const section = enrollment ? await ctx.db.get(enrollment.sectionId) : null;
    classSection = section ? section.displayName : "Not enrolled";
  }
  const accountantOnly = m.role === "admin" && ((m.grants === undefined && m.permissionSets.includes("accountant")) || isAccountantGrants(m.grants));
  const department = m.role === "teacher" ? (teacher?.designation ?? "Teacher") : m.role === "admin" ? (accountantOnly ? "Accounts" : "Administration") : null;
  const user = m.userId ? await ctx.db.get(m.userId) : null;
  const state = accountState(m);
  const isSelf = m._id === actor.membershipId;
  return {
    membershipId: m._id,
    name: teacher ? teacherDisplayName(teacher) : m.displayName,
    role: m.role,
    loginId: m.loginId ?? null,
    state,
    classSection,
    department,
    scholarNo,
    employeeId: teacher?.employeeId ?? null,
    /** The student still signs in with the school's default password. */
    defaultPassword: user?.defaultPassword === true,
    isSelf,
    /** "reset": overwrite with an emailed code; "issue": first password (Accounts & Import); null: not possible here. */
    passwordAction: isSelf || state === "suspended" ? null : state === "pending" ? ("issue" as const) : ("reset" as const),
  };
}
export type CredentialAccount = Awaited<ReturnType<typeof describeAccount>>;

/**
 * Accounts of the caller's school matching `query` (case-insensitive, at least
 * 2 characters) on name, Login ID, scholar number (students' Login ID) or
 * employee ID. Exact ID matches first, then names. At most MAX_SEARCH_RESULTS.
 */
export const search = schoolQuery({
  args: { query: v.string() },
  handler: async (ctx, { query }) => {
    const { actor } = ctx;
    requireCredentialAdmin(actor);
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return { results: [] as CredentialAccount[], more: false };
    const teachers = await ctx.db.query("teachers").withIndex("by_school_status", (q) => q.eq("schoolId", actor.schoolId)).take(MAX_TEACHERS);
    const teacherById = new Map(teachers.map((t) => [t._id, t]));
    const hits: { m: Doc<"schoolMemberships">; teacher: Doc<"teachers"> | null; rank: number }[] = [];
    for (const role of ["admin", "teacher", "student"] as const) {
      const rows = await ctx.db.query("schoolMemberships").withIndex("by_school_role", (q) => q.eq("schoolId", actor.schoolId).eq("role", role)).take(MAX_SCAN_PER_ROLE);
      for (const m of rows) {
        if (m.guardianId) continue; // removed sign-in type
        const teacher = (m.teacherId && teacherById.get(m.teacherId)) || null;
        const ids = [m.loginId, teacher?.employeeId].filter((x): x is string => !!x).map((x) => x.toLowerCase());
        const names = [m.displayName, teacher ? teacherDisplayName(teacher) : null].filter((x): x is string => !!x).map((x) => x.toLowerCase());
        const rank = ids.includes(needle) ? 0 : ids.some((x) => x.startsWith(needle)) ? 1 : ids.some((x) => x.includes(needle)) || names.some((x) => x.includes(needle)) ? 2 : -1;
        if (rank >= 0) hits.push({ m, teacher, rank });
      }
    }
    hits.sort((a, b) => a.rank - b.rank || a.m.displayName.localeCompare(b.m.displayName));
    const results: CredentialAccount[] = [];
    for (const h of hits.slice(0, MAX_SEARCH_RESULTS)) results.push(await describeAccount(ctx, actor, h.m, h.teacher));
    return { results, more: hits.length > MAX_SEARCH_RESULTS };
  },
});

const CREDENTIAL_EVENTS = new Set(["account.created", "account.credentials_issued", PASSWORD_OVERWRITE]);

/** One account with its recent credential events (created, password issued, overwritten). */
export const account = schoolQuery({
  args: { targetMembershipId: v.id("schoolMemberships") },
  handler: async (ctx, { targetMembershipId }) => {
    const { actor } = ctx;
    requireCredentialAdmin(actor);
    const m = await getInSchool(ctx, "schoolMemberships", targetMembershipId, "Account");
    if (m.guardianId) throw notFound("Account");
    const t = m.teacherId ? await ctx.db.get(m.teacherId) : null;
    const details = await describeAccount(ctx, actor, m, t && t.schoolId === actor.schoolId ? t : null);
    const logs = await ctx.db.query("auditLogs")
      .withIndex("by_school_entity", (q) => q.eq("schoolId", actor.schoolId).eq("entity.table", "schoolMemberships").eq("entity.id", m._id))
      .order("desc").take(50);
    const history = [];
    for (const log of logs.filter((l) => CREDENTIAL_EVENTS.has(l.action)).slice(0, 5)) {
      const by = log.actorUserId
        ? (await ctx.db.query("schoolMemberships").withIndex("by_user", (q) => q.eq("userId", log.actorUserId!)).collect()).find((x) => x.schoolId === actor.schoolId)?.displayName ?? null
        : null;
      history.push({ action: log.action, at: log._creationTime, by, summary: log.summary });
    }
    return { ...details, history };
  },
});

// ================================================================ OTP-authorized overwrite (internal)

/** Authorize and open a challenge for this administrator and target (replacing any open one). */
export const openChallenge = internalMutation({
  args: { ...callerArg, targetMembershipId: v.id("schoolMemberships"), codeHash: v.string(), salt: v.string() },
  handler: async (ctx, { callerMembershipId, targetMembershipId, codeHash, salt }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requireCredentialAdmin(actor);
    const target = await credentialTarget(ctx, actor, targetMembershipId);
    if (!target.userId) throw invalid(`${target.displayName} has no password yet. Issue one from Accounts & Import.`);
    const sentTo = actor.email?.trim() ?? "";
    if (!isEmailAddress(sentTo)) throw emailUnavailable("Your administrator account has no email address, so a confirmation code cannot be sent. Ask the system operator to add one.");
    const now = Date.now();
    const recent = await ctx.db.query("credentialOtps")
      .withIndex("by_admin", (q) => q.eq("adminMembershipId", actor.membershipId).gte("_creationTime", now - OTP_REQUEST_WINDOW_MS))
      .collect();
    if (recent.length >= OTP_MAX_REQUESTS) throw forbidden("Too many codes requested. Wait 15 minutes and try again.");
    for (const c of recent) if (c.closedAt === undefined) await ctx.db.patch(c._id, { closedAt: now, closedReason: "replaced" });
    const expiresAt = now + OTP_TTL_MS;
    const challengeId = await ctx.db.insert("credentialOtps", {
      schoolId: actor.schoolId, adminUserId: actor.userId, adminMembershipId: actor.membershipId, targetMembershipId,
      codeHash, salt, expiresAt, attempts: 0,
    });
    const school = (await ctx.db.get(actor.schoolId))!;
    return { challengeId, sentTo, expiresAt, school: school.name, adminName: actor.displayName, targetName: target.displayName, targetLoginId: target.loginId };
  },
});

/** The code could not be emailed: the challenge can never be used. */
export const closeUndelivered = internalMutation({
  args: { challengeId: v.id("credentialOtps") },
  handler: async (ctx, { challengeId }) => {
    const c = await ctx.db.get(challengeId);
    if (c && c.closedAt === undefined) await ctx.db.patch(challengeId, { closedAt: Date.now(), closedReason: "undelivered" });
  },
});

/** The caller's own challenge (anyone else's is NOT_FOUND). */
async function ownChallenge(ctx: QueryCtx, actor: Actor, challengeId: Id<"credentialOtps">) {
  const c = await ctx.db.get(challengeId);
  if (!c || c.adminMembershipId !== actor.membershipId || c.schoolId !== actor.schoolId) throw notFound("Confirmation code");
  return c;
}

export const challengeSalt = internalQuery({
  args: { ...callerArg, challengeId: v.id("credentialOtps") },
  handler: async (ctx, { callerMembershipId, challengeId }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requireCredentialAdmin(actor);
    return (await ownChallenge(ctx, actor, challengeId)).salt;
  },
});

/**
 * Check a code. Never throws for a wrong code — a throw would roll back the
 * attempt counter — but returns why it failed. On success the challenge is
 * consumed and the (re-authorized) target returned.
 */
export const consumeChallenge = internalMutation({
  args: { ...callerArg, challengeId: v.id("credentialOtps"), codeHash: v.string() },
  handler: async (ctx, { callerMembershipId, challengeId, codeHash }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requireCredentialAdmin(actor);
    const c = await ownChallenge(ctx, actor, challengeId);
    const now = Date.now();
    if (c.closedAt !== undefined) return { ok: false as const, reason: c.closedReason === "locked" ? ("locked" as const) : ("closed" as const) };
    if (now >= c.expiresAt) return { ok: false as const, reason: "expired" as const };
    if (c.codeHash !== codeHash) {
      const attempts = c.attempts + 1;
      const locked = attempts >= OTP_MAX_ATTEMPTS;
      await ctx.db.patch(c._id, { attempts, ...(locked ? { closedAt: now, closedReason: "locked" as const } : {}) });
      return { ok: false as const, reason: locked ? ("locked" as const) : ("wrong" as const), attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
    }
    await ctx.db.patch(c._id, { closedAt: now, closedReason: "used" });
    const target = await credentialTarget(ctx, actor, c.targetMembershipId);
    if (!target.userId) throw invalid(`${target.displayName} has no password yet. Issue one from Accounts & Import.`);
    return { ok: true as const, loginId: target.loginId, userId: target.userId, displayName: target.displayName };
  },
});

/** After the new password is stored: clear the account's password flags and write the audit entry. */
export const recordOverwrite = internalMutation({
  args: { ...callerArg, challengeId: v.id("credentialOtps") },
  handler: async (ctx, { callerMembershipId, challengeId }) => {
    const actor = await requireActor(ctx, callerMembershipId);
    requireCredentialAdmin(actor);
    const c = await ownChallenge(ctx, actor, challengeId);
    if (c.closedReason !== "used") throw forbidden("This code was not verified.");
    const m = await getInSchool({ ...ctx, actor }, "schoolMemberships", c.targetMembershipId, "Account");
    // Unchanged behaviour: an OTP-authorized overwrite is not forced to change (SEC-06 is a separate follow-up).
    if (m.userId) await ctx.db.patch(m.userId, passwordIssuedFields({ requiresPasswordChange: false }));
    await writeAudit(ctx, {
      schoolId: actor.schoolId, actor, action: PASSWORD_OVERWRITE,
      entity: { table: "schoolMemberships", id: m._id },
      summary: `Password of ${m.loginId ?? ""} (${m.displayName}) overwritten by ${actor.displayName}`,
      metadata: {
        ...accountTarget(m),
        adminUserId: actor.userId, adminMembershipId: actor.membershipId,
        targetUserId: m.userId ?? null, targetMembershipId: m._id,
        at: Date.now(), authorizedBy: "email_otp",
      },
    });
  },
});

// ================================================================ OTP-authorized overwrite (public)

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 6 random digits (rejection sampling: no modulo bias). Actions only. */
function generateOtp(): string {
  const limit = 4_294_000_000; // largest multiple of 1e6 below 2^32
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % 1_000_000).padStart(6, "0");
  }
}

async function hashCode(salt: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Step 1: email a one-time code to the calling administrator that authorizes
 * overwriting the target account's password. Returns where it was sent.
 */
export const requestPasswordOverwriteOtp = schoolAction({
  args: { targetMembershipId: v.id("schoolMemberships") },
  handler: async (ctx, { targetMembershipId }): Promise<{ challengeId: Id<"credentialOtps">; sentTo: string; expiresAt: number; targetLoginId: string }> => {
    const code = generateOtp();
    const salt = randomHex(16);
    const c: { challengeId: Id<"credentialOtps">; sentTo: string; expiresAt: number; school: string; adminName: string; targetName: string; targetLoginId: string } =
      await ctx.runMutation(internal.credentials.openChallenge, { callerMembershipId: ctx.membershipId, targetMembershipId, codeHash: await hashCode(salt, code), salt });
    try {
      await sendEmail({
        to: c.sentTo,
        subject: `${c.school}: confirm a password change for ${c.targetLoginId}`,
        text: [
          `Hello ${c.adminName},`,
          "",
          `Your one-time code is ${code}`,
          "",
          `It authorizes you to change the password of ${c.targetName} (Login ID ${c.targetLoginId}) at ${c.school}.`,
          `It expires in ${OTP_TTL_MS / 60000} minutes and works once. Never share it.`,
          "",
          "If you did not request this, someone may be using your administrator account: sign out everywhere and tell your system operator.",
        ].join("\n"),
      });
    } catch (e) {
      await ctx.runMutation(internal.credentials.closeUndelivered, { challengeId: c.challengeId });
      throw e instanceof AppError ? e : emailUnavailable("We couldn't send the email. Please try again.");
    }
    return { challengeId: c.challengeId, sentTo: c.sentTo, expiresAt: c.expiresAt, targetLoginId: c.targetLoginId };
  },
});

/**
 * Step 2: verify the code and set the new password. The target is signed out
 * everywhere and a PASSWORD_OVERWRITE audit entry is written.
 */
export const verifyOtpAndSetPassword = schoolAction({
  args: { challengeId: v.id("credentialOtps"), code: v.string(), newPassword: v.string() },
  handler: async (ctx, { challengeId, code, newPassword }): Promise<{ ok: true; loginId: string; displayName: string }> => {
    try {
      validatePassword(newPassword);
    } catch {
      throw invalid("Use at least 8 characters, including a letter and a number.", { newPassword: "At least 8 characters, with a letter and a number" });
    }
    const otp = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(otp)) throw invalid("Enter the 6-digit code from the email.", { code: "Enter 6 digits" });
    const salt: string = await ctx.runQuery(internal.credentials.challengeSalt, { callerMembershipId: ctx.membershipId, challengeId });
    const r: { ok: true; loginId: string; userId: Id<"users">; displayName: string } | { ok: false; reason: "wrong" | "locked" | "closed" | "expired"; attemptsLeft?: number } =
      await ctx.runMutation(internal.credentials.consumeChallenge, { callerMembershipId: ctx.membershipId, challengeId, codeHash: await hashCode(salt, otp) });
    if (!r.ok) {
      if (r.reason === "wrong") throw invalid(`Incorrect code. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? "" : "s"} left.`, { code: "Incorrect code" });
      if (r.reason === "expired") throw invalid("This code has expired. Request a new one.", { code: "Expired" });
      if (r.reason === "locked") throw forbidden("Too many incorrect codes. Request a new code.");
      throw forbidden("This code can no longer be used. Request a new one.");
    }
    await modifyAccountCredentials(ctx, { provider: PASSWORD_PROVIDER, account: { id: r.loginId, secret: newPassword } });
    await invalidateSessions(ctx, { userId: r.userId });
    await ctx.runMutation(internal.credentials.recordOverwrite, { callerMembershipId: ctx.membershipId, challengeId });
    return { ok: true, loginId: r.loginId, displayName: r.displayName };
  },
});

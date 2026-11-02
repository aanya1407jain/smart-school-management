/**
 * Account provisioning (server-only helpers).
 *
 * Identity model
 *   users              — one sign-in identity per person: canonical `loginId`
 *                        (+ optional contact email), `disabled`, `defaultPassword`.
 *   authAccounts       — Convex Auth "password" account: providerAccountId =
 *                        the canonical Login ID, secret = Scrypt hash. Never
 *                        read by app code, never sent to the browser.
 *   schoolMemberships  — what the identity may do: role + link to the
 *                        teacher or student record. The ONLY grant. Roles:
 *                        admin, teacher, student (no parent/guardian accounts).
 *
 * Lifecycle (same path for admin UI, imports, deployment setup and demo seed):
 *   1. reserveAccount (mutation): membership { status: "invited", loginId }
 *      — authorizes, validates the person link, reserves a unique Login ID.
 *   2. provisionAccount (action): Convex Auth createAccount(loginId, password)
 *      → convex/auth.ts createOrUpdateUser → activatePendingAccount: creates
 *      the users row and activates the reserved membership(s).
 * If step 2 fails, the membership simply stays "pending" (invited, no user)
 * and the admin can issue credentials again; nothing half-created can sign in.
 *
 * Credentials are managed ONLY by administrators: there is no self-service
 * password change or recovery. A password an administrator issues stays the
 * account's password until an administrator overwrites it
 * (convex/credentials.ts, authorized by a one-time code emailed to that
 * administrator).
 */
import { createAccount } from "@convex-dev/auth/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AppError, conflict } from "../core/errors";
import { normalizeLoginId } from "../core/validators";
import type { PermissionSetName, Role } from "../core/permissions";
import type { Grant } from "../core/grants";
import { allocateNumber, ensureCounterAtLeast } from "./counters";
import { canonicalLoginId, formatLoginId, loginIdCounterKey, parseGeneratedLoginId, type LoginIdKind } from "./loginIds";
import { assertMembershipShape, hasActiveAccess } from "./memberships";
import { accountTarget, roleInSchool, writeAudit } from "./audit";

export const PASSWORD_PROVIDER = "password";

/**
 * STUDENT accounts: the Login ID is the student's scholar number and the first
 * password is this school default (hashed by Convex Auth like any password),
 * marked `users.defaultPassword` so administrators can see who still uses it.
 * Teachers and office logins get a random password.
 */
export const STUDENT_DEFAULT_PASSWORD = "Aster@123";

/**
 * The session gate (Convex Auth `beforeSessionCreation`, after the password
 * was verified): enabled user with an active membership in an active school.
 */
export async function assertSessionAllowed(ctx: QueryCtx, userId: Id<"users">) {
  if (!(await hasActiveAccess(ctx, userId))) {
    throw new AppError("NO_SCHOOL_ACCESS", "Your account does not have active access to any school.");
  }
}

/**
 * User fields after an administrator (or operator) sets a password: the
 * student-default marker when that is what was set, and the legacy
 * temporary-password flags cleared.
 */
export function passwordIssuedFields(defaultPassword = false) {
  return { mustChangePassword: undefined, temporaryPasswordIssuedAt: undefined, defaultPassword: defaultPassword ? (true as const) : undefined };
}

/** The first password for a new account of this role: the student default, or a random one. Actions only. */
export function initialPasswordFor(role: Role): { password: string; defaultPassword: boolean } {
  return role === "student" ? { password: STUDENT_DEFAULT_PASSWORD, defaultPassword: true } : { password: generateSecurePassword(), defaultPassword: false };
}

/** A student's Login ID: their scholar number (canonical). Throws when they have none or it cannot be a Login ID. */
export async function studentLoginId(ctx: QueryCtx, schoolId: Id<"schools">, studentId: Id<"students">): Promise<string> {
  const student = await ctx.db.get(studentId);
  if (!student || student.schoolId !== schoolId) throw new AppError("NOT_FOUND", "Student not found.");
  if (!student.scholarNoKey) throw new AppError("INVALID_ARGUMENT", `${student.firstName} ${student.lastName} has no scholar number yet. Students sign in with their scholar number — add one first.`, { scholarNo: "Required for a sign-in account" });
  const id = canonicalLoginId(student.scholarNoKey);
  if (!id) throw new AppError("INVALID_ARGUMENT", `Scholar number ${student.scholarNo} cannot be used to sign in (only letters, digits, dot, dash and underscore). Change it first.`, { scholarNo: "Not usable as a Login ID" });
  return id;
}

/**
 * Rename an account's Login ID everywhere it is stored (membership, identity
 * and the Convex Auth password account) in one transaction. The password hash
 * and sessions are unaffected. Used when a student's scholar number changes.
 */
export async function renameLoginId(ctx: MutationCtx, membership: Doc<"schoolMemberships">, newLoginId: string): Promise<void> {
  const old = membership.loginId;
  if (!old || old === newLoginId) return;
  if (await isLoginIdTaken(ctx, newLoginId)) throw conflict(`Login ID ${newLoginId} is already in use.`);
  for (const m of await ctx.db.query("schoolMemberships").withIndex("by_login_id", (q) => q.eq("loginId", old)).collect()) {
    await ctx.db.patch(m._id, { loginId: newLoginId });
  }
  if (membership.userId) {
    const user = await ctx.db.get(membership.userId);
    if (user?.loginId === old) await ctx.db.patch(user._id, { loginId: newLoginId });
  }
  // Only this member's own password account moves; an auth account held by anyone else is never touched.
  const account = await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", PASSWORD_PROVIDER).eq("providerAccountId", old)).first();
  if (account && membership.userId && account.userId === membership.userId) await ctx.db.patch(account._id, { providerAccountId: newLoginId });
}

/** A Login ID is taken if any identity, reservation or auth account uses it. */
export async function isLoginIdTaken(ctx: QueryCtx, loginId: string): Promise<boolean> {
  if (await ctx.db.query("users").withIndex("by_login_id", (q) => q.eq("loginId", loginId)).first()) return true;
  if (await ctx.db.query("schoolMemberships").withIndex("by_login_id", (q) => q.eq("loginId", loginId)).first()) return true;
  const account = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) => q.eq("provider", PASSWORD_PROVIDER).eq("providerAccountId", loginId))
    .first();
  return account !== null;
}

/** Move the generator past an explicitly chosen ID that has the generated shape. */
export async function syncLoginIdCounter(ctx: MutationCtx, schoolId: Id<"schools">, loginId: string) {
  const parsed = parseGeneratedLoginId(loginId);
  if (parsed) await ensureCounterAtLeast(ctx, schoolId, loginIdCounterKey(parsed.kind, parsed.year), parsed.n);
}

/** Next free generated Login ID (transactional counter; skips IDs taken by explicit choices). */
export async function generateLoginId(ctx: MutationCtx, schoolId: Id<"schools">, kind: LoginIdKind, year?: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const n = await allocateNumber(ctx, schoolId, loginIdCounterKey(kind, year));
    const id = formatLoginId(kind, n, year);
    if (!(await isLoginIdTaken(ctx, id))) return id;
  }
  throw conflict("Could not generate a free Login ID. Enter one manually.");
}

export type ReserveAccountInput = {
  schoolId: Id<"schools">;
  role: Role;
  displayName: string;
  /** Explicit Login ID (validated, normalised, must be free); otherwise generated. */
  loginId?: string;
  /** Kind used when generating the Login ID. */
  kind: LoginIdKind;
  /** Year used in generated student IDs (STU-<year>-NNNNN). */
  year?: string;
  email?: string;
  teacherId?: Id<"teachers">;
  studentId?: Id<"students">;
  permissionSets?: PermissionSetName[];
  /** Admin only: a restricted office login with exactly these grants (core/grants.ts), e.g. the Accountant preset. */
  grants?: Grant[];
  accessProfile?: string;
  createdByUserId?: Id<"users">;
  /** Demo seed ONLY: keep the explicit `loginId` for a seeded demo student instead of the scholar number. */
  seedStudentLoginId?: true;
};

/** The membership (any status) that already gives this person this kind of access, if any. */
export async function existingAccountFor(
  ctx: QueryCtx,
  schoolId: Id<"schools">,
  link: { role: Role; teacherId?: Id<"teachers">; studentId?: Id<"students"> },
): Promise<Doc<"schoolMemberships"> | null> {
  let rows: Doc<"schoolMemberships">[] = [];
  if (link.studentId) rows = await ctx.db.query("schoolMemberships").withIndex("by_student", (q) => q.eq("studentId", link.studentId)).collect();
  else if (link.teacherId) rows = await ctx.db.query("schoolMemberships").withIndex("by_teacher", (q) => q.eq("teacherId", link.teacherId)).collect();
  return rows.find((m) => m.schoolId === schoolId && m.role === link.role) ?? null;
}

/** Step 1: reserve a membership + Login ID. Caller must already be authorized. */
export async function reserveAccount(ctx: MutationCtx, input: ReserveAccountInput): Promise<{ membershipId: Id<"schoolMemberships">; loginId: string }> {
  assertMembershipShape(input);
  if (input.role !== "admin" && (input.permissionSets?.length || input.grants)) {
    throw new AppError("INVALID_ARGUMENT", "Permission sets can only be added to administrative accounts.");
  }
  if (input.teacherId || input.studentId) {
    const existing = await existingAccountFor(ctx, input.schoolId, input);
    if (existing) {
      throw new AppError("CONFLICT", existing.status === "invited"
        ? "This person already has an account waiting for credentials. Issue a temporary password instead."
        : "This person already has an account.");
    }
  }
  let loginId: string;
  if (input.role === "student" && !input.seedStudentLoginId) {
    // Students always sign in with their scholar number — never a generated or typed ID.
    loginId = await studentLoginId(ctx, input.schoolId, input.studentId!);
    if (input.loginId?.trim() && canonicalLoginId(input.loginId) !== loginId) {
      throw new AppError("INVALID_ARGUMENT", `Students sign in with their scholar number (${loginId}); a different Login ID cannot be chosen.`, { loginId: "Students use their scholar number" });
    }
    if (await isLoginIdTaken(ctx, loginId)) throw new AppError("CONFLICT", `Login ID ${loginId} (the scholar number) is already in use by another account.`, { loginId: "Already in use" });
  } else if (input.loginId !== undefined && input.loginId.trim() !== "") {
    loginId = normalizeLoginId(input.loginId);
    if (await isLoginIdTaken(ctx, loginId)) throw new AppError("CONFLICT", `Login ID ${loginId} is already in use.`, { loginId: "Already in use" });
    await syncLoginIdCounter(ctx, input.schoolId, loginId);
  } else {
    loginId = await generateLoginId(ctx, input.schoolId, input.kind, input.year);
  }
  const membershipId = await ctx.db.insert("schoolMemberships", {
    schoolId: input.schoolId,
    loginId,
    displayName: input.displayName,
    role: input.role,
    status: "invited",
    permissionSets: input.permissionSets ?? [],
    ...(input.grants ? { grants: input.grants } : {}),
    ...(input.accessProfile ? { accessProfile: input.accessProfile } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.teacherId ? { teacherId: input.teacherId } : {}),
    ...(input.studentId ? { studentId: input.studentId } : {}),
    ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
  });
  return { membershipId, loginId };
}

/**
 * Called ONLY from the Convex Auth `createOrUpdateUser` callback when a new
 * password account is created server-side (step 2). Creates the identity and
 * activates every reserved membership for that Login ID.
 */
export async function activatePendingAccount(ctx: MutationCtx, args: { loginId: string; defaultPassword?: boolean }): Promise<Id<"users">> {
  const pending = (await ctx.db.query("schoolMemberships").withIndex("by_login_id", (q) => q.eq("loginId", args.loginId)).collect())
    .filter((m) => m.status === "invited" && !m.userId && !m.guardianId); // legacy guardian sign-ins are never activated
  if (pending.length === 0) throw new AppError("FORBIDDEN", "Accounts are created by your school.");
  if (await ctx.db.query("users").withIndex("by_login_id", (q) => q.eq("loginId", args.loginId)).first()) {
    throw conflict("This Login ID already belongs to an account.");
  }
  const first = pending[0];
  const now = Date.now();
  const userId = await ctx.db.insert("users", {
    loginId: args.loginId,
    name: first.displayName,
    ...(first.email ? { email: first.email } : {}),
    ...(args.defaultPassword ? { defaultPassword: true } : {}),
  });
  for (const m of pending) {
    await ctx.db.patch(m._id, { userId, status: "active", activatedAt: now });
    await writeAudit(ctx, {
      schoolId: m.schoolId,
      // Actor = the member who created the account (derived from their membership,
      // never assumed); the created account's own role goes in metadata.targetRole.
      actor: m.createdByUserId ? { userId: m.createdByUserId, role: await roleInSchool(ctx, m.createdByUserId, m.schoolId) } : null,
      action: "account.created",
      entity: { table: "schoolMemberships", id: m._id },
      summary: `Account ${args.loginId} created for ${m.displayName} (${m.role})`,
      metadata: accountTarget({ ...m, loginId: args.loginId }),
    });
  }
  return userId;
}

/**
 * A random password: 12 random characters (unambiguous letters/digits) in
 * groups of four, always containing a letter and a digit, e.g. "Kq7m-x3Rt-9pWd".
 * Uses crypto.getRandomValues — call ONLY from actions (never queries/mutations).
 * The admin UI generates the same shape in the browser (src/features/accounts/password-reset-dialog.tsx).
 */
export function generateSecurePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const limit = 65536 - (65536 % alphabet.length); // rejection sampling: no modulo bias
  for (;;) {
    const chars: string[] = [];
    while (chars.length < 12) {
      const buf = new Uint16Array(16);
      crypto.getRandomValues(buf);
      for (const x of buf) if (x < limit && chars.length < 12) chars.push(alphabet[x % alphabet.length]);
    }
    const pw = `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

/**
 * Step 2: create the Convex Auth password account for a reserved Login ID.
 * The secret is hashed by the provider (Scrypt); only the hash is stored.
 */
export async function provisionAccount(ctx: ActionCtx, args: { loginId: string; password: string; defaultPassword?: boolean }) {
  return await createAccount(ctx, {
    provider: PASSWORD_PROVIDER,
    account: { id: args.loginId, secret: args.password },
    profile: { loginId: args.loginId, ...(args.defaultPassword ? { defaultPassword: true } : {}) },
  });
}

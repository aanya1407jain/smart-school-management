import type { Role, UserAccount } from "@/types/domain";
import { readDb } from "@/lib/store/db";
import { latency, ServiceError, requireActor } from "./core";
import { clearSession, readSession, setDomainIdentity, subscribeSession, updateSession } from "./session-store";

/**
 * Authentication itself lives in Convex Auth (see src/features/auth/session-provider.tsx).
 * This service only BRIDGES the server-derived identity to the mock domain
 * data that the business modules still use. It never checks passwords and
 * never decides a role.
 */

/** The signed-in account as the UI sees it. */
export type CurrentUser = UserAccount;

/**
 * The parts of the server identity (`users.session` → viewer) the bridge needs.
 * Structural on purpose so it can be built from the Convex response or in tests.
 */
export interface ServerIdentity {
  email: string;
  role: Role;
  displayName: string;
  permissionSets: readonly string[];
  /** Students the server says this member may view (self, or linked children). */
  students: readonly { studentId: string; name: string }[];
}

export type BindResult =
  | { ok: true; user: CurrentUser; studentMap: Record<string, string> }
  | { ok: false };

const norm = (s: string) => s.trim().toLowerCase();

export const mockAuthService = {
  /**
   * Match the server identity to its demo-data counterpart and make it the
   * actor for the mock services. Role, permission sets and linked students
   * come from the SERVER; the mock record only supplies domain links
   * (teacher id, profile fields). Linked students must be linked on BOTH
   * sides, so the browser can never widen access.
   */
  bindIdentity(identity: ServerIdentity): BindResult {
    const db = readDb();
    const record = db.users.find((u) => norm(u.email) === norm(identity.email));
    if (!record || record.role !== identity.role) {
      clearSession();
      return { ok: false };
    }
    const studentMap: Record<string, string> = {};
    for (const s of identity.students) {
      const match = db.students.find((m) => `${m.firstName} ${m.lastName}` === s.name && (record.studentIds ?? []).includes(m.id));
      if (match) studentMap[s.studentId] = match.id;
    }
    const studentIds = Object.values(studentMap);
    if (identity.role === "student" && studentIds.length === 0) {
      clearSession();
      return { ok: false };
    }
    const previous = readSession();
    const activeStudentId = previous?.userId === record.id && previous.activeStudentId && studentIds.includes(previous.activeStudentId)
      ? previous.activeStudentId
      : studentIds[0] ?? null;
    setDomainIdentity({
      userId: record.id,
      role: identity.role,
      permissionSets: [...identity.permissionSets],
      email: identity.email,
      displayName: identity.displayName,
      studentIds,
      activeStudentId,
    });
    return { ok: true, user: requireActor(), studentMap };
  },

  clearIdentity() {
    clearSession();
  },

  /** Synchronous snapshot of the bound identity. */
  getSessionSnapshot(): { activeStudentId: string | null; user: CurrentUser | null } {
    const session = readSession();
    if (!session) return { activeStudentId: null, user: null };
    try {
      return { activeStudentId: session.activeStudentId, user: requireActor() };
    } catch {
      return { activeStudentId: null, user: null };
    }
  },

  subscribe(listener: () => void) {
    return subscribeSession(listener);
  },

  /**
   * Switch the student being viewed. The session provider verifies the
   * choice with the server (`users.studentContext`) before calling this.
   */
  setActiveStudent(studentId: string): void {
    const actor = requireActor();
    if (!actor.studentIds?.includes(studentId)) throw new ServiceError("FORBIDDEN", "This student is not linked to your account.");
    updateSession({ activeStudentId: studentId });
  },

  /** Password reset email is not wired up yet (no email provider) — simulated. */
  async requestPasswordReset(email: string): Promise<void> {
    await latency();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ServiceError("VALIDATION", "Enter a valid email address.");
    // Always resolve — never reveal whether an account exists.
  },
};

export type AuthService = typeof mockAuthService;

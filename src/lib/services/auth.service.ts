import type { Role, UserAccount } from "@/types/domain";
import { readDb } from "@/lib/store/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { latency, ServiceError, requireActor } from "./core";
import { clearSession, readSession, subscribeSession, updateSession, writeSession, type Session } from "./session-store";

export interface LoginInput {
  email: string;
  password: string;
  role: Role;
  remember: boolean;
}

/** Public view of the signed-in account (never exposes the password). */
export type CurrentUser = Omit<UserAccount, "password">;

const SESSION_HOURS = { remember: 24 * 14, normal: 12 };

function toPublic(u: UserAccount): CurrentUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...rest } = u;
  return rest;
}

export const mockAuthService = {
  /**
   * Validates credentials against the mock user table.
   * The selected role is only a hint for the login form — the ACCOUNT's role
   * decides access. A mismatch is rejected rather than "switching" roles.
   */
  async login(input: LoginInput): Promise<CurrentUser> {
    await latency();
    await latency();
    const email = input.email.trim().toLowerCase();
    const user = readDb().users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.password !== input.password) {
      throw new ServiceError("UNAUTHENTICATED", "The email or password you entered is incorrect.");
    }
    if (user.role !== input.role) {
      throw new ServiceError(
        "FORBIDDEN",
        `This account does not have ${ROLE_LABELS[input.role]} access. Select the role that matches your account.`,
      );
    }
    const now = new Date();
    const hours = input.remember ? SESSION_HOURS.remember : SESSION_HOURS.normal;
    const session: Session = {
      token: `mock.${user.id}.${now.getTime().toString(36)}`,
      userId: user.id,
      role: user.role,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
      activeStudentId: user.studentIds?.[0] ?? null,
    };
    writeSession(session, input.remember);
    return toPublic(user);
  },

  async logout(): Promise<void> {
    clearSession();
  },

  /** Synchronous snapshot used by the session provider. */
  getSessionSnapshot(): { session: Session | null; user: CurrentUser | null } {
    const session = readSession();
    if (!session) return { session: null, user: null };
    const user = readDb().users.find((u) => u.id === session.userId);
    if (!user) return { session: null, user: null };
    return { session, user: toPublic(user) };
  },

  subscribe(listener: () => void) {
    return subscribeSession(listener);
  },

  /** Guardians linked to several students switch the active student here. */
  async setActiveStudent(studentId: string): Promise<void> {
    const actor = requireActor();
    if (!actor.studentIds?.includes(studentId)) throw new ServiceError("FORBIDDEN", "This student is not linked to your account.");
    updateSession({ activeStudentId: studentId });
  },

  async requestPasswordReset(email: string): Promise<void> {
    await latency();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ServiceError("VALIDATION", "Enter a valid email address.");
    // Always resolve — never reveal whether an account exists.
  },
};

export type AuthService = typeof mockAuthService;

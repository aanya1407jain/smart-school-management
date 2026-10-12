"use client";

/**
 * The ONE session state of the app.
 *
 *  - Authentication: Convex Auth (email + password). Tokens live in httpOnly
 *    cookies managed by the Next.js proxy — never in Web Storage.
 *  - Identity: `users.session` derives the user, school, membership, role and
 *    linked teacher/student/guardian on the SERVER. The login form's role
 *    selector is only checked against it; it never grants anything.
 *  - Domain data: the business modules still run on the mock store, so the
 *    server identity is bound (in memory) to its demo-data counterpart — see
 *    src/lib/services/session-store.ts.
 *
 * Components read this via `useSession()` — never from storage directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Viewer } from "@convex/users";
import type { Role } from "@/types/domain";
import { services, type CurrentUser } from "@/lib/services";
import type { BindResult } from "@/lib/services/auth.service";
import { purgeLegacySessionStorage } from "@/lib/services/session-store";
import { subscribeDb } from "@/lib/store/db";
import { permissionsFor, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { isConvexConfigured } from "@/lib/convex/config";
import { getAppError } from "@/lib/convex/errors";
import { useMembership } from "@/lib/convex/membership";

/**
 *  loading          → resolving the session (or verifying a sign-in)
 *  unauthenticated  → signed out
 *  unavailable      → signed in, but there is nothing this account can open
 *                     (no active school membership, or no demo-data record yet)
 *  authenticated    → signed in with a resolved role
 */
type Status = "loading" | "authenticated" | "unauthenticated" | "unavailable";

export interface LoginInput {
  email: string;
  password: string;
  /** What the person SAYS they are. Only compared with the server role; never trusted. */
  role: Role;
}

interface SessionContextValue {
  status: Status;
  user: CurrentUser | null;
  /** Server-derived identity (null unless authenticated). */
  viewer: Viewer | null;
  /** Why the session is "unavailable". */
  notice: string | null;
  activeStudentId: string | null;
  can: (permission: Permission) => boolean;
  login: (input: LoginInput) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  /** Guardians: switch the linked student being viewed (verified by the server). */
  setActiveStudent: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const UNAVAILABLE_PREVIEW =
  "You're signed in, but your school records aren't available in this preview yet. Please contact the school office.";
const SIGN_IN_FAILED = "The email or password you entered is incorrect.";

function signInErrorMessage(error: unknown): string {
  const app = getAppError(error);
  if (app?.code === "NO_SCHOOL_ACCESS") return app.message;
  const raw = error instanceof Error ? error.message : String(error);
  if (/TooManyFailedAttempts/.test(raw)) return "Too many incorrect attempts. Please wait a while and try again.";
  if (/NO_SCHOOL_ACCESS/.test(raw)) return "Your account does not have active access to any school.";
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(raw)) return SIGN_IN_FAILED;
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return "We couldn't reach the server. Check your connection and try again.";
  return SIGN_IN_FAILED;
}

const roleMismatchMessage = (role: Role) =>
  `This account does not have ${ROLE_LABELS[role]} access. Select the role that matches your account.`;

// ------------------------------------------------------------------ no backend configured
function UnconfiguredSessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => { purgeLegacySessionStorage(); services.auth.clearIdentity(); }, []);
  const value = useMemo<SessionContextValue>(() => ({
    status: "unauthenticated", user: null, viewer: null, notice: null, activeStudentId: null,
    can: () => false,
    login: async () => { throw new Error("Sign-in is not available: the school backend is not configured for this deployment."); },
    logout: async () => {},
    setActiveStudent: async () => {},
  }), []);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// ------------------------------------------------------------------ Convex Auth
type PendingLogin = { role: Role; resolve: (u: CurrentUser) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

function ConvexSessionProvider({ children }: { children: ReactNode }) {
  const { signIn, signOut } = useAuthActions();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const { activeMembershipId } = useMembership();
  const convex = useConvex();
  const session = useQuery(api.users.session, isAuthenticated ? (activeMembershipId ? { membershipId: activeMembershipId } : {}) : "skip");

  const [bound, setBound] = useState<{ viewer: Viewer; result: BindResult } | null>(null);
  const [tick, setTick] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const pending = useRef<PendingLogin | null>(null);

  useEffect(() => { purgeLegacySessionStorage(); }, []);

  // Bind (or clear) the server identity for the mock domain services.
  const viewer = isAuthenticated && session?.status === "signedIn" ? session.viewer : null;
  useEffect(() => {
    if (viewer) {
      setBound({ viewer, result: services.auth.bindIdentity(viewer) });
    } else if (!authLoading && (!isAuthenticated || session !== undefined)) {
      services.auth.clearIdentity();
      setBound(null);
    }
  }, [viewer, authLoading, isAuthenticated, session]);

  // Domain changes (active student, demo data) refresh the snapshot.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const a = services.auth.subscribe(bump);
    const b = subscribeDb(bump);
    return () => { a(); b(); };
  }, []);

  const base = useMemo(() => {
    void tick;
    if (authLoading) return { status: "loading" as Status, notice: null, user: null, activeStudentId: null, viewer: null };
    if (!isAuthenticated) return { status: "unauthenticated" as Status, notice: null, user: null, activeStudentId: null, viewer: null };
    if (session === undefined) return { status: "loading" as Status, notice: null, user: null, activeStudentId: null, viewer: null };
    if (session.status === "signedOut") return { status: "unauthenticated" as Status, notice: null, user: null, activeStudentId: null, viewer: null };
    if (session.status === "noSchool") return { status: "unavailable" as Status, notice: session.message, user: null, activeStudentId: null, viewer: null };
    if (!bound || bound.viewer !== session.viewer) return { status: "loading" as Status, notice: null, user: null, activeStudentId: null, viewer: null };
    if (!bound.result.ok) return { status: "unavailable" as Status, notice: UNAVAILABLE_PREVIEW, user: null, activeStudentId: null, viewer: null };
    const snap = services.auth.getSessionSnapshot();
    if (!snap.user) return { status: "loading" as Status, notice: null, user: null, activeStudentId: null, viewer: null };
    return { status: "authenticated" as Status, notice: null, user: snap.user, activeStudentId: snap.activeStudentId, viewer: session.viewer };
  }, [authLoading, isAuthenticated, session, bound, tick]);

  const finishPending = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (p) clearTimeout(p.timer);
    setVerifying(false);
    return p;
  }, []);

  // A sign-in is only complete once the SERVER role is known and matches what was selected.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (base.status === "authenticated" && base.user) {
      if (base.user.role === p.role) {
        finishPending()?.resolve(base.user);
      } else {
        void signOut().finally(() => finishPending()?.reject(new Error(roleMismatchMessage(p.role))));
      }
    } else if (base.status === "unavailable") {
      const notice = base.notice ?? UNAVAILABLE_PREVIEW;
      void signOut().finally(() => finishPending()?.reject(new Error(notice)));
    }
  }, [base, signOut, finishPending]);

  const login = useCallback(async ({ email, password, role }: LoginInput): Promise<CurrentUser> => {
    if (pending.current) throw new Error("A sign-in is already in progress.");
    setVerifying(true);
    try {
      const result = await signIn("password", { email: email.trim().toLowerCase(), password, flow: "signIn" });
      if (!result.signingIn) throw new Error(SIGN_IN_FAILED);
    } catch (e) {
      setVerifying(false);
      throw new Error(signInErrorMessage(e));
    }
    return await new Promise<CurrentUser>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.current?.timer !== timer) return;
        void signOut().finally(() => finishPending()?.reject(new Error("Signing in is taking longer than expected. Please try again.")));
      }, 20_000);
      pending.current = { role, resolve, reject, timer };
    });
  }, [signIn, signOut, finishPending]);

  const logout = useCallback(async () => {
    await signOut();
    services.auth.clearIdentity();
    setBound(null);
  }, [signOut]);

  const setActiveStudent = useCallback(async (mockStudentId: string) => {
    if (!bound?.result.ok) throw new Error("Your session has ended. Please sign in again.");
    const serverId = Object.entries(bound.result.studentMap).find(([, m]) => m === mockStudentId)?.[0];
    if (!serverId) throw new Error("This student is not linked to your account.");
    // The server decides: only the student themself or a linked guardian passes.
    await convex.query(api.users.studentContext, {
      studentId: serverId as Id<"students">,
      ...(activeMembershipId ? { membershipId: activeMembershipId } : {}),
    });
    services.auth.setActiveStudent(mockStudentId);
  }, [bound, convex, activeMembershipId]);

  const value = useMemo<SessionContextValue>(() => {
    const status: Status = verifying ? "loading" : base.status;
    const user = verifying ? null : base.user;
    const perms = permissionsFor(user);
    return {
      status,
      user,
      viewer: verifying ? null : base.viewer,
      notice: verifying ? null : base.notice,
      activeStudentId: verifying ? null : base.activeStudentId,
      can: (p) => perms.has(p),
      login,
      logout,
      setActiveStudent,
    };
  }, [base, verifying, login, logout, setActiveStudent]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const SessionProvider = isConvexConfigured ? ConvexSessionProvider : UnconfiguredSessionProvider;

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

/** For student-portal pages: the student currently being viewed. */
export function useActiveStudentId(): string | null {
  const { user, activeStudentId } = useSession();
  if (!user || user.role !== "student") return null;
  if (activeStudentId && user.studentIds?.includes(activeStudentId)) return activeStudentId;
  return user.studentIds?.[0] ?? null;
}

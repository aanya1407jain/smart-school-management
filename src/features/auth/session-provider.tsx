"use client";

/**
 * The ONE session state of the app.
 *
 *  - Authentication: Convex Auth (Login ID + password). Tokens live in httpOnly
 *    cookies managed by the Next.js proxy — never in Web Storage.
 *  - Identity: `users.session` derives the user, school, membership, role and
 *    linked teacher/student/guardian on the SERVER. The browser never
 *    supplies a role; the portal opened after sign-in follows the server role.
 *  - Domain data, two sources (`dataSource`):
 *      "demo" → the demo school's persona accounts are bound (in memory) to
 *               their counterpart in the in-browser demo data — see
 *               src/lib/services/session-store.ts. Only the demo school
 *               (DEMO_SCHOOL_SLUG) can ever bind.
 *      "live" → every other student-portal account (students and guardians
 *               created by the school). The portal reads ONLY Convex
 *               (convex/studentPortal.ts, attendance, notifications) for the
 *               students the server links to the membership; the demo data
 *               stays unbound, so a real account can never see a demo persona.
 *
 * Components read this via `useSession()` — never from storage directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Viewer } from "@convex/users";
import { services, type CurrentUser } from "@/lib/services";
import { SIGN_IN_FAILED, signInErrorMessage } from "./login-form";
import type { BindResult } from "@/lib/services/auth.service";
import { purgeLegacySessionStorage } from "@/lib/services/session-store";
import { subscribeDb } from "@/lib/store/db";
import { permissionsFor, type Permission } from "@/lib/permissions";
import { isConvexConfigured } from "@/lib/convex/config";
import { useMembership } from "@/lib/convex/membership";
import { liveStudentPortalUser, liveWorkspaceUser } from "./live-user";

export { liveStudentPortalUser };

/**
 *  loading          → resolving the session (or verifying a sign-in)
 *  unauthenticated  → signed out
 *  unavailable      → signed in, but there is nothing this account can open:
 *                     no active school membership (viewer = null), or no
 *                     demo-data record yet (viewer set: the account is valid
 *                     and can still use /account, e.g. to change its password)
 *                     (no active school membership, or no demo-data record yet)
 *  authenticated    → signed in with a resolved role
 */
type Status = "loading" | "authenticated" | "unauthenticated" | "unavailable";

/** Where the portal's domain data comes from for this session (see the header). */
export type DataSource = "demo" | "live";

export interface LoginInput {
  /** Login ID issued by the school (case/whitespace-insensitive). */
  loginId: string;
  password: string;
}

interface SessionContextValue {
  status: Status;
  user: CurrentUser | null;
  /** Server-derived identity (null unless authenticated). */
  viewer: Viewer | null;
  /** Why the session is "unavailable". */
  notice: string | null;
  /** The account must replace an administrator-issued temporary password. */
  mustChangePassword: boolean;
  activeStudentId: string | null;
  /** "demo" (persona bound to demo data) or "live" (Convex only); null unless authenticated. */
  dataSource: DataSource | null;
  can: (permission: Permission) => boolean;
  /** Resolves to the portal user, or null when the account is valid but has no portal data yet (go to /account). */
  login: (input: LoginInput) => Promise<CurrentUser | null>;
  logout: () => Promise<void>;
  /** Guardians: switch the linked student being viewed (verified by the server). */
  setActiveStudent: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const UNAVAILABLE_PREVIEW =
  "You're signed in, but your school records aren't available in this preview yet. Please contact the school office.";


// ------------------------------------------------------------------ no backend configured
function UnconfiguredSessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => { purgeLegacySessionStorage(); services.auth.clearIdentity(); }, []);
  const value = useMemo<SessionContextValue>(() => ({
    status: "unauthenticated", user: null, viewer: null, notice: null, mustChangePassword: false, activeStudentId: null, dataSource: null,
    can: () => false,
    login: async () => { throw new Error("Sign-in is not available: the school backend is not configured for this deployment."); },
    logout: async () => {},
    setActiveStudent: async () => {},
  }), []);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// ------------------------------------------------------------------ Convex Auth
type PendingLogin = { resolve: (u: CurrentUser | null) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

function ConvexSessionProvider({ children }: { children: ReactNode }) {
  const { signIn, signOut } = useAuthActions();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const { activeMembershipId } = useMembership();
  const convex = useConvex();
  const session = useQuery(api.users.session, isAuthenticated ? (activeMembershipId ? { membershipId: activeMembershipId } : {}) : "skip");

  const [bound, setBound] = useState<{ viewer: Viewer; result: BindResult } | null>(null);
  const [tick, setTick] = useState(0);
  const [verifying, setVerifying] = useState(false);
  /** Live portal: the linked student being viewed (guardians with several children). */
  const [liveActiveStudentId, setLiveActiveStudentId] = useState<string | null>(null);
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

  const liveUser = useMemo(() => (viewer ? liveWorkspaceUser(viewer) : null), [viewer]);

  const base = useMemo(() => {
    void tick;
    const none = { notice: null, user: null, activeStudentId: null, viewer: null, dataSource: null };
    if (authLoading) return { status: "loading" as Status, ...none };
    if (!isAuthenticated) return { status: "unauthenticated" as Status, ...none };
    if (session === undefined) return { status: "loading" as Status, ...none };
    if (session.status === "signedOut") return { status: "unauthenticated" as Status, ...none };
    if (session.status === "noSchool") return { status: "unavailable" as Status, ...none, notice: session.message };
    if (!bound || bound.viewer !== session.viewer) return { status: "loading" as Status, ...none };
    if (!bound.result.ok) {
      // Accounts created by the school (no demo persona): the live (Convex) workspace for
      // their SERVER-derived role. Never mapped onto demo personas or demo data.
      if (liveUser) {
        const ids = liveUser.studentIds ?? [];
        const active = liveActiveStudentId && ids.includes(liveActiveStudentId) ? liveActiveStudentId : ids[0] ?? null;
        return { status: "authenticated" as Status, notice: null, user: liveUser, activeStudentId: active, viewer: session.viewer, dataSource: "live" as DataSource };
      }
      return { status: "unavailable" as Status, ...none, notice: UNAVAILABLE_PREVIEW, viewer: session.viewer };
    }
    const snap = services.auth.getSessionSnapshot();
    if (!snap.user) return { status: "loading" as Status, ...none };
    return { status: "authenticated" as Status, notice: null, user: snap.user, activeStudentId: snap.activeStudentId, viewer: session.viewer, dataSource: "demo" as DataSource };
  }, [authLoading, isAuthenticated, session, bound, tick, liveUser, liveActiveStudentId]);

  const finishPending = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (p) clearTimeout(p.timer);
    setVerifying(false);
    return p;
  }, []);

  // A sign-in is only complete once the SERVER-derived identity is known.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    if (base.status === "authenticated" && base.user) {
      finishPending()?.resolve(base.user);
    } else if (base.status === "unavailable" && base.viewer) {
      // Valid account without portal data yet: signed in, sent to /account.
      finishPending()?.resolve(null);
    } else if (base.status === "unavailable") {
      const notice = base.notice ?? UNAVAILABLE_PREVIEW;
      void signOut().finally(() => finishPending()?.reject(new Error(notice)));
    }
  }, [base, signOut, finishPending]);

  const login = useCallback(async ({ loginId, password }: LoginInput): Promise<CurrentUser | null> => {
    if (pending.current) throw new Error("A sign-in is already in progress.");
    setVerifying(true);
    try {
      const result = await signIn("password", { loginId: loginId.trim(), password, flow: "signIn" });
      if (!result.signingIn) throw new Error(SIGN_IN_FAILED);
    } catch (e) {
      setVerifying(false);
      throw new Error(signInErrorMessage(e));
    }
    return await new Promise<CurrentUser | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.current?.timer !== timer) return;
        void signOut().finally(() => finishPending()?.reject(new Error("Signing in is taking longer than expected. Please try again.")));
      }, 20_000);
      pending.current = { resolve, reject, timer };
    });
  }, [signIn, signOut, finishPending]);

  const logout = useCallback(async () => {
    await signOut();
    services.auth.clearIdentity();
    setBound(null);
    setLiveActiveStudentId(null);
  }, [signOut]);

  const setActiveStudent = useCallback(async (mockStudentId: string) => {
    if (base.dataSource === "live") {
      // Live portal: ids ARE Convex student ids; the server must confirm the link.
      if (!base.user?.studentIds?.includes(mockStudentId)) throw new Error("This student is not linked to your account.");
      await convex.query(api.users.studentContext, {
        studentId: mockStudentId as Id<"students">,
        ...(activeMembershipId ? { membershipId: activeMembershipId } : {}),
      });
      setLiveActiveStudentId(mockStudentId);
      return;
    }
    if (!bound?.result.ok) throw new Error("Your session has ended. Please sign in again.");
    const serverId = Object.entries(bound.result.studentMap).find(([, m]) => m === mockStudentId)?.[0];
    if (!serverId) throw new Error("This student is not linked to your account.");
    // The server decides: only the student themself or a linked guardian passes.
    await convex.query(api.users.studentContext, {
      studentId: serverId as Id<"students">,
      ...(activeMembershipId ? { membershipId: activeMembershipId } : {}),
    });
    services.auth.setActiveStudent(mockStudentId);
  }, [base.dataSource, base.user, bound, convex, activeMembershipId]);

  const value = useMemo<SessionContextValue>(() => {
    const status: Status = verifying ? "loading" : base.status;
    const user = verifying ? null : base.user;
    const perms = permissionsFor(user);
    return {
      status,
      user,
      viewer: verifying ? null : base.viewer,
      notice: verifying ? null : base.notice,
      mustChangePassword: !verifying && base.viewer?.mustChangePassword === true,
      activeStudentId: verifying ? null : base.activeStudentId,
      dataSource: verifying ? null : base.dataSource,
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

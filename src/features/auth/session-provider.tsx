"use client";

/**
 * The ONE session state of the app.
 *
 *  - Authentication: Convex Auth (Login ID + password). Tokens live in httpOnly
 *    cookies managed by the Next.js proxy — never in Web Storage.
 *  - Identity: `users.session` derives the user, school, membership, role and
 *    linked teacher/student on the SERVER. The browser never
 *    supplies a role; the portal opened after sign-in follows the server role.
 *  - Domain data, two sources (`dataSource`):
 *      "demo" → the demo school's persona accounts are bound (in memory) to
 *               their counterpart in the in-browser demo data — see
 *               src/lib/services/session-store.ts. Only the demo school
 *               (DEMO_SCHOOL_SLUG) can ever bind.
 *      "live" → every other account created by the school (admin, teacher
 *               or student). The portal reads ONLY Convex
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
import type { UserAccount as CurrentUser } from "@/types/core";
import { demoRuntime, type DemoRuntime } from "@/lib/demo/runtime";
import { SIGN_IN_FAILED, signInErrorMessage } from "./login-form";
import { permissionsFor, type Permission } from "@/lib/permissions";
import { isConvexConfigured } from "@/lib/convex/config";
import { useMembership } from "@/lib/convex/membership";
import { liveStudentPortalUser, liveWorkspaceUser } from "./live-user";
import type { ModuleKey } from "@convex/core/modules";
import { parseSessionModules, withServerAccess, type SessionModulesStatus } from "./session-modules";

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
  /**
   * Modules the user's school is entitled to (server session, reactive). UI
   * only: pages and panels of other modules are hidden and their queries are
   * skipped; the server refuses them anyway (MODULE_DISABLED).
   */
  modules: readonly ModuleKey[];
  /**
   * Whether `modules` is a list the server actually sent ("ok"), or the session
   * lacked it ("missing" — a backend older than module entitlements) or it was
   * malformed. Not "ok" → `modules` is empty (fail-closed). Null when signed out.
   */
  modulesStatus: SessionModulesStatus | null;
  hasModule: (module: ModuleKey) => boolean;
  /** Resolves to the portal user, or null when the account is valid but has no portal data yet (go to /account). */
  login: (input: LoginInput) => Promise<CurrentUser | null>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const UNAVAILABLE_PREVIEW =
  "You're signed in, but your school records aren't available in this preview yet. Please contact the school office.";


// ------------------------------------------------------------------ no backend configured
function UnconfiguredSessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => { demoRuntime()?.purgeLegacyStorage(); demoRuntime()?.auth.clearIdentity(); }, []);
  const value = useMemo<SessionContextValue>(() => ({
    status: "unauthenticated", user: null, viewer: null, notice: null, mustChangePassword: false, activeStudentId: null, dataSource: null,
    can: () => false, modules: [], modulesStatus: null, hasModule: () => false,
    login: async () => { throw new Error("Sign-in is not available: the school backend is not configured for this deployment."); },
    logout: async () => {},
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

  const [bound, setBound] = useState<{ viewer: Viewer; result: ReturnType<DemoRuntime["auth"]["bindIdentity"]> } | null>(null);
  const [tick, setTick] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const pending = useRef<PendingLogin | null>(null);

  useEffect(() => { demoRuntime()?.purgeLegacyStorage(); }, []);

  // Bind (or clear) the server identity for the mock domain services.
  const viewer = isAuthenticated && session?.status === "signedIn" ? session.viewer : null;
  useEffect(() => {
    if (viewer) {
      // Builds without the demo layer: every account is a live (Convex) account.
      const demo = demoRuntime();
      setBound({ viewer, result: demo ? demo.auth.bindIdentity(viewer) : { ok: false } });
    } else if (!authLoading && (!isAuthenticated || session !== undefined)) {
      demoRuntime()?.auth.clearIdentity();
      setBound(null);
    }
  }, [viewer, authLoading, isAuthenticated, session]);

  // Domain changes (active student, demo data) refresh the snapshot.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    return demoRuntime()?.subscribe(bump) ?? (() => {});
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
        // A student account sees exactly its own record (the only account roles are admin, teacher and student).
        const active = liveUser.studentIds?.[0] ?? null;
        return { status: "authenticated" as Status, notice: null, user: withServerAccess(liveUser, session.viewer), activeStudentId: active, viewer: session.viewer, dataSource: "live" as DataSource };
      }
      return { status: "unavailable" as Status, ...none, notice: UNAVAILABLE_PREVIEW, viewer: session.viewer };
    }
    const snap = demoRuntime()?.auth.getSessionSnapshot() ?? { user: null, activeStudentId: null };
    if (!snap.user) return { status: "loading" as Status, ...none };
    // Module entitlements always come from the server session, for demo personas too
    // (parsed fail-closed: a session without a valid list grants no module).
    return { status: "authenticated" as Status, notice: null, user: withServerAccess(snap.user, session.viewer), activeStudentId: snap.activeStudentId, viewer: session.viewer, dataSource: "demo" as DataSource };
  }, [authLoading, isAuthenticated, session, bound, tick, liveUser]);

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
    demoRuntime()?.auth.clearIdentity();
    setBound(null);
  }, [signOut]);

  const value = useMemo<SessionContextValue>(() => {
    const status: Status = verifying ? "loading" : base.status;
    const user = verifying ? null : base.user;
    const perms = permissionsFor(user);
    const modules: readonly ModuleKey[] = user?.modules ?? [];
    const modulesStatus = user ? parseSessionModules(base.viewer?.modules).status : null;
    return {
      status,
      user,
      viewer: verifying ? null : base.viewer,
      notice: verifying ? null : base.notice,
      mustChangePassword: !verifying && base.viewer?.mustChangePassword === true,
      activeStudentId: verifying ? null : base.activeStudentId,
      dataSource: verifying ? null : base.dataSource,
      can: (p) => perms.has(p),
      modules,
      modulesStatus,
      hasModule: (m) => modules.includes(m),
      login,
      logout,
    };
  }, [base, verifying, login, logout]);

  // Say once, for developers, why every module page is hidden.
  const warned = useRef<SessionModulesStatus | null>(null);
  useEffect(() => {
    const s = value.modulesStatus;
    if (s && s !== "ok" && warned.current !== s) {
      warned.current = s;
      console.warn(`[session] viewer.modules is ${s}; module pages are hidden. Is the Convex deployment older than this frontend (module entitlements)?`);
    }
  }, [value.modulesStatus]);

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

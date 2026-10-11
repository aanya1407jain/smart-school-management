"use client";

/**
 * Centralised session state: who the user is, which role they hold, and
 * (for guardian accounts) which linked student is being viewed.
 * Components read this via `useSession()` — never from storage directly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { services, type CurrentUser } from "@/lib/services";
import type { LoginInput } from "@/lib/services/auth.service";
import { subscribeDb } from "@/lib/store/db";
import { permissionsFor, type Permission } from "@/lib/permissions";

type Status = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  status: Status;
  user: CurrentUser | null;
  activeStudentId: string | null;
  can: (permission: Permission) => boolean;
  login: (input: LoginInput) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  setActiveStudent: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<{ status: Status; user: CurrentUser | null; activeStudentId: string | null }>({
    status: "loading", user: null, activeStudentId: null,
  });

  const refresh = useCallback(() => {
    const { session, user } = services.auth.getSessionSnapshot();
    setSnapshot({ status: user ? "authenticated" : "unauthenticated", user, activeStudentId: session?.activeStudentId ?? null });
  }, []);

  useEffect(() => {
    refresh();
    const a = services.auth.subscribe(refresh);
    const b = subscribeDb(refresh);
    return () => { a(); b(); };
  }, [refresh]);

  const value = useMemo<SessionContextValue>(() => {
    const perms = permissionsFor(snapshot.user);
    return {
      ...snapshot,
      can: (p) => perms.has(p),
      login: async (input) => {
        const u = await services.auth.login(input);
        refresh();
        return u;
      },
      logout: async () => {
        await services.auth.logout();
        refresh();
      },
      setActiveStudent: async (id) => {
        await services.auth.setActiveStudent(id);
        refresh();
      },
    };
  }, [snapshot, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

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

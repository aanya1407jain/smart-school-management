"use client";
/**
 * Which school membership the UI is acting as.
 *
 * The backend derives the school and role from the session; the client only
 * CHOOSES among the signed-in user's own memberships (e.g. a principal who
 * works at two schools). Every schoolQuery/schoolMutation accepts that choice as an
 * optional `membershipId`, which `useSchoolQuery` / `useSchoolMutation` add
 * automatically. The backend verifies it belongs to the caller.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType, PaginationOptions, PaginationResult } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { STORAGE_NAMESPACE } from "@/lib/constants/product";

type MembershipId = Id<"schoolMemberships">;
type Me = FunctionReturnType<typeof api.users.me>;

type Ctx = {
  /** undefined while loading, null when signed out */
  me: Me | undefined;
  activeMembershipId: MembershipId | null;
  setActiveMembershipId: (id: MembershipId | null) => void;
};

const MembershipContext = createContext<Ctx | null>(null);
const KEY = `${STORAGE_NAMESPACE}-active-membership`;

export function MembershipProvider({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me, {});
  const [selected, setSelected] = useState<MembershipId | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (stored) setSelected(stored as MembershipId);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setActiveMembershipId = useCallback((id: MembershipId | null) => {
    setSelected(id);
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Only ever send a membership that the server says is ours; with exactly one
  // membership no selector is needed at all.
  const activeMembershipId = useMemo(() => {
    const list = me?.memberships ?? [];
    if (selected && list.some((m) => m.membershipId === selected)) return selected;
    return list.length === 1 ? list[0].membershipId : null;
  }, [me, selected]);

  const value = useMemo(() => ({ me, activeMembershipId, setActiveMembershipId }), [me, activeMembershipId, setActiveMembershipId]);
  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

export function useMembership(): Ctx {
  const ctx = useContext(MembershipContext);
  if (!ctx) throw new Error("useMembership must be used inside ConvexClientProvider (NEXT_PUBLIC_CONVEX_URL not set?)");
  return ctx;
}

type WithMembership = { membershipId?: MembershipId };
type SchoolArgs<F extends FunctionReference<"query" | "mutation">> = Omit<FunctionArgs<F>, "membershipId">;

/**
 * `useQuery` for school-scoped functions. Pass "skip" to defer.
 *   const register = useSchoolQuery(api.attendance.getByDate, { sectionId, date });
 */
export function useSchoolQuery<F extends FunctionReference<"query", "public", WithMembership & Record<string, unknown>>>(
  fn: F,
  args: SchoolArgs<F> | "skip",
): FunctionReturnType<F> | undefined {
  const { activeMembershipId } = useMembership();
  const full = args === "skip" ? "skip" : { ...args, ...(activeMembershipId ? { membershipId: activeMembershipId } : {}) };
  return useQuery(fn, full as never) as FunctionReturnType<F> | undefined;
}

/**
 * `useMutation` for school-scoped functions.
 *   const mark = useSchoolMutation(api.attendance.mark);
 *   await mark({ sectionId, date, entries });
 */
export function useSchoolMutation<F extends FunctionReference<"mutation", "public", WithMembership & Record<string, unknown>>>(fn: F) {
  const { activeMembershipId } = useMembership();
  const mutate = useMutation(fn);
  return useCallback(
    (args: SchoolArgs<F>): Promise<FunctionReturnType<F>> =>
      mutate({ ...args, ...(activeMembershipId ? { membershipId: activeMembershipId } : {}) } as never),
    [mutate, activeMembershipId],
  );
}

/**
 * `useAction` for school-scoped actions (schoolAction): adds the active
 * membershipId; the server verifies it belongs to the caller.
 */
export function useSchoolAction<F extends FunctionReference<"action", "public", WithMembership & Record<string, unknown>>>(fn: F) {
  const { activeMembershipId } = useMembership();
  const run = useAction(fn);
  return useCallback(
    (args: Omit<FunctionArgs<F>, "membershipId">): Promise<FunctionReturnType<F>> =>
      run({ ...args, ...(activeMembershipId ? { membershipId: activeMembershipId } : {}) } as never),
    [run, activeMembershipId],
  );
}

/**
 * One-shot (non-reactive) run of a school-scoped query, e.g. validating an
 * import preview on demand:  const preview = useSchoolQueryRunner(api.imports.previewStudents);
 */
export function useSchoolQueryRunner<F extends FunctionReference<"query", "public", WithMembership & Record<string, unknown>>>(fn: F) {
  const { activeMembershipId } = useMembership();
  const client = useConvex();
  return useCallback(
    (args: SchoolArgs<F>): Promise<FunctionReturnType<F>> =>
      client.query(fn, { ...args, ...(activeMembershipId ? { membershipId: activeMembershipId } : {}) } as never),
    [client, fn, activeMembershipId],
  );
}

type PaginatedSchoolQuery = FunctionReference<"query", "public", WithMembership & { paginationOpts: PaginationOptions } & Record<string, unknown>, PaginationResult<unknown>>;

/** `usePaginatedQuery` for school-scoped paginated queries. */
export function useSchoolPaginatedQuery<F extends PaginatedSchoolQuery>(
  fn: F,
  args: Omit<FunctionArgs<F>, "membershipId" | "paginationOpts"> | "skip",
  options: { initialNumItems: number },
) {
  const { activeMembershipId } = useMembership();
  const full = args === "skip" ? "skip" : { ...args, ...(activeMembershipId ? { membershipId: activeMembershipId } : {}) };
  return usePaginatedQuery(fn, full as never, options);
}

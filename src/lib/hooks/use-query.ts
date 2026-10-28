"use client";

/**
 * Minimal reactive query hook (Convex-style `useQuery` semantics):
 *  - runs the service call, exposes { data, error, isLoading }
 *  - re-runs silently whenever the data store or session changes, so a
 *    mutation in one module is reflected everywhere without manual refetching
 *
 * Swapping to Convex later: replace with `useQuery(api.x.y, args)`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { demoRuntime } from "@/lib/demo/runtime";

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refetch: () => void;
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[], options: { enabled?: boolean } = {}): QueryState<T> {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; isLoading: boolean; isRefreshing: boolean }>({
    data: undefined, error: null, isLoading: enabled, isRefreshing: false,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const runId = useRef(0);

  const run = useCallback((silent: boolean) => {
    const id = ++runId.current;
    setState((s) => (silent ? { ...s, isRefreshing: true } : { data: s.data, error: null, isLoading: true, isRefreshing: false }));
    fetcherRef.current().then(
      (data) => { if (id === runId.current) setState({ data, error: null, isLoading: false, isRefreshing: false }); },
      (error: Error) => { if (id === runId.current) setState((s) => ({ data: silent ? s.data : undefined, error, isLoading: false, isRefreshing: false })); },
    );
  }, []);

  useEffect(() => {
    if (!enabled) { setState((s) => ({ ...s, isLoading: false })); return; }
    run(false);
    // Demo data (internal builds only) re-runs the query when it changes.
    const unsubscribe = demoRuntime()?.subscribe(() => run(true)) ?? (() => {});
    return () => { unsubscribe(); runId.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { ...state, refetch: () => run(false) };
}

"use client";

/**
 * Minimal reactive query hook (Convex-style `useQuery` semantics):
 *  - runs the service call, exposes { data, error, isLoading }
 *  - re-runs silently whenever the data store or session changes, so a
 *    mutation in one module is reflected everywhere without manual refetching
 *  - stale-while-revalidate: the last result for the same query (same fetcher
 *    and deps) is shown immediately when a page is revisited, then refreshed
 *    silently — switching between pages no longer starts from a blank loading state
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

/** Last results by query key. Cleared whenever the demo store or session changes, so it never shows stale or another persona's data. */
const cache = new Map<string, unknown>();
const MAX_ENTRIES = 150;
let watching = false;
function watchStore() {
  if (watching) return;
  const rt = demoRuntime();
  if (!rt) return;
  rt.subscribe(() => cache.clear());
  watching = true;
}
function remember(key: string, data: unknown) {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}
function keyOf(fetcher: () => unknown, deps: unknown[]): string | null {
  try { return `${fetcher.toString()}::${JSON.stringify(deps)}`; } catch { return null; }
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[], options: { enabled?: boolean } = {}): QueryState<T> {
  const enabled = options.enabled ?? true;
  const key = enabled ? keyOf(fetcher, deps) : null;
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; isLoading: boolean; isRefreshing: boolean }>(() => {
    const hit = key !== null && cache.has(key);
    return { data: hit ? (cache.get(key!) as T) : undefined, error: null, isLoading: enabled && !hit, isRefreshing: false };
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;
  const runId = useRef(0);

  const run = useCallback((silent: boolean) => {
    const id = ++runId.current;
    const k = keyRef.current;
    setState((s) => (silent ? { ...s, isRefreshing: true } : { data: s.data, error: null, isLoading: true, isRefreshing: false }));
    fetcherRef.current().then(
      (data) => {
        if (k !== null) remember(k, data);
        if (id === runId.current) setState({ data, error: null, isLoading: false, isRefreshing: false });
      },
      (error: Error) => { if (id === runId.current) setState((s) => ({ data: silent ? s.data : undefined, error, isLoading: false, isRefreshing: false })); },
    );
  }, []);

  useEffect(() => {
    if (!enabled) { setState((s) => ({ ...s, isLoading: false })); return; }
    watchStore();
    // A cached result is already on screen: refresh it silently instead of showing a loading state.
    const k = keyRef.current;
    if (k !== null && cache.has(k)) {
      setState((s) => ({ ...s, data: cache.get(k) as T, isLoading: false }));
      run(true);
    } else {
      run(false);
    }
    // Demo data (internal builds only) re-runs the query when it changes.
    const unsubscribe = demoRuntime()?.subscribe(() => run(true)) ?? (() => {});
    return () => { unsubscribe(); runId.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { ...state, refetch: () => run(false) };
}

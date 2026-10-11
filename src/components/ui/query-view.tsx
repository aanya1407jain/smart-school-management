"use client";
import type { ReactNode } from "react";
import type { QueryState } from "@/lib/hooks/use-query";
import { ErrorState, LoadingState } from "./states";

/** Renders loading / error / unauthorized states for a query, then the data. */
export function QueryView<T>({
  query, children, loading = "page", wrapError = true,
}: { query: QueryState<T>; children: (data: T) => ReactNode; loading?: "page" | "table" | "cards" | "inline"; wrapError?: boolean }) {
  if (query.isLoading && query.data === undefined) return <LoadingState variant={loading} />;
  if (query.error && query.data === undefined) {
    const e = <ErrorState error={query.error} onRetry={query.refetch} />;
    return wrapError ? <div className="solid-card">{e}</div> : e;
  }
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}

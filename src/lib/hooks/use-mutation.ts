"use client";

import { useCallback, useState } from "react";
import { ServiceError } from "@/lib/services";

export interface MutationState<A extends unknown[], R> {
  mutate: (...args: A) => Promise<R | undefined>;
  isPending: boolean;
  error: ServiceError | Error | null;
  fieldErrors: Record<string, string>;
  reset: () => void;
}

/**
 * Wraps a service mutation with pending/error state. Returns `undefined`
 * on failure (the error is exposed on the hook) so callers can simply
 * `if (result) { ...success }`.
 */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>): MutationState<A, R> {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutate = useCallback(async (...args: A) => {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn(...args);
    } catch (e) {
      const err = e as Error;
      setError(err);
      if (err instanceof ServiceError && err.fieldErrors) setFieldErrors(err.fieldErrors);
      return undefined;
    } finally {
      setPending(false);
    }
  }, [fn]);

  return { mutate, isPending, error, fieldErrors, reset: () => { setError(null); setFieldErrors({}); } };
}

"use client";

import { useCallback, useState } from "react";
import { fieldErrorsOf } from "@/lib/utils/errors";

export interface MutationState<A extends unknown[], R> {
  mutate: (...args: A) => Promise<R | undefined>;
  isPending: boolean;
  error: Error | null;
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
      const fields = fieldErrorsOf(err);
      if (fields) setFieldErrors(fields);
      return undefined;
    } finally {
      setPending(false);
    }
  }, [fn]);

  return { mutate, isPending, error, fieldErrors, reset: () => { setError(null); setFieldErrors({}); } };
}

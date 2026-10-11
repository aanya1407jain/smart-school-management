/**
 * Read the structured error thrown by Convex functions (convex/core/errors.ts).
 *
 *   try { await mark(args) } catch (e) {
 *     const err = getAppError(e);
 *     if (err?.code === "FORBIDDEN") toast(err.message);
 *   }
 */
import { ConvexError } from "convex/values";
import type { AppErrorData } from "@convex/core/errors";

export type { AppErrorCode, AppErrorData } from "@convex/core/errors";

export function getAppError(error: unknown): AppErrorData | null {
  if (error instanceof ConvexError && error.data && typeof error.data === "object" && "code" in error.data) {
    return error.data as AppErrorData;
  }
  return null;
}

/** A user-safe message for any error (never leaks internals of unexpected errors). */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return getAppError(error)?.message ?? fallback;
}

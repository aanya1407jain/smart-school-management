/** Field-level validation messages carried by an error, if any (demo service errors carry `fieldErrors`). */
export function fieldErrorsOf(e: unknown): Record<string, string> | undefined {
  const f = (e as { fieldErrors?: unknown } | null)?.fieldErrors;
  return f && typeof f === "object" ? (f as Record<string, string>) : undefined;
}

/** A user-facing error with optional per-field messages (shown by forms via useMutation). */
export class FieldError extends Error {
  constructor(public code: string, message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "FieldError";
  }
}

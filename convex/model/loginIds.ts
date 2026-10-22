/**
 * Login IDs — the identifier people type on the sign-in screen
 * ("ADMIN-001", "TCH-00124", "STU-2026-00451").
 *
 * Dependency-free on purpose: the server (validation, uniqueness) and the
 * browser (sign-in form, import preview) share exactly the same rules.
 *
 * Canonical form: trimmed, Unicode-normalised, UPPER CASE. Uniqueness is always
 * checked on the canonical form, so "stu-2026-00451 " and "STU-2026-00451"
 * are the same Login ID. Only letters, digits and . _ - are allowed; it must
 * start with a letter or digit and be 3–40 characters long.
 */
export const LOGIN_ID_RULES_TEXT = "3–40 characters: letters, digits, dot, dash or underscore; start with a letter or digit.";

const LOGIN_ID_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,39}$/;

/** Canonical Login ID, or null when the input can never be a valid Login ID. */
export function canonicalLoginId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.normalize("NFKC").trim().toUpperCase();
  return LOGIN_ID_PATTERN.test(value) ? value : null;
}

/** Kinds of generated Login IDs. */
export type LoginIdKind = "admin" | "teacher" | "student";

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * Format a generated Login ID. The deployment belongs to one school, so IDs
 * carry no school prefix: ADMIN-001, TCH-00124, STU-2026-00451.
 */
export function formatLoginId(kind: LoginIdKind, n: number, year?: string): string {
  switch (kind) {
    case "admin": return `ADMIN-${pad(n, 3)}`;
    case "teacher": return `TCH-${pad(n, 5)}`;
    case "student": return `STU-${year ?? "0000"}-${pad(n, 5)}`;
  }
}

/** Counter key used to allocate the next generated Login ID of a kind. */
export function loginIdCounterKey(kind: LoginIdKind, year?: string): string {
  return kind === "student" ? `login_student:${year ?? "0000"}` : `login_${kind}`;
}

/**
 * If a (canonical) Login ID has the generated shape, return its kind/number so
 * counters can be moved past it — e.g. after seeding or importing explicit IDs,
 * newly generated IDs never collide with them.
 */
export function parseGeneratedLoginId(id: string): { kind: LoginIdKind; n: number; year?: string } | null {
  let m = /^ADMIN-(\d{1,9})$/.exec(id);
  if (m) return { kind: "admin", n: Number(m[1]) };
  m = /^TCH-(\d{1,9})$/.exec(id);
  if (m) return { kind: "teacher", n: Number(m[1]) };
  m = /^STU-(\d{4})-(\d{1,9})$/.exec(id);
  if (m) return { kind: "student", n: Number(m[2]), year: m[1] };
  return null;
}

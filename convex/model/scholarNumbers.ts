/**
 * Scholar numbers — the school's own register number for a student, entered
 * by the office. Optional, but UNIQUE within a school.
 *
 * Uniqueness is checked inside the mutation that sets the number, against the
 * `by_school_scholar` index on the normalised key. A Convex mutation is one
 * serializable transaction: two admissions racing for the same number conflict
 * on that index range and one is retried, so it then sees the other's row and
 * is rejected — a duplicate can never be committed.
 *
 * Normalisation (the key): NFKC, upper case, all whitespace removed. "sr 104",
 * "SR104" and "Sr 104" are the same scholar number; the display value keeps the
 * office's spelling (trimmed, single spaces).
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { conflict, invalid } from "../core/errors";

export const MAX_SCHOLAR_NO_LENGTH = 30;

export function scholarNoKey(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

/** Validate an entered scholar number → display value + key. Empty → null (no scholar number). */
export function parseScholarNo(raw: string | undefined | null, field = "scholarNo"): { scholarNo: string; scholarNoKey: string } | null {
  const display = (raw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!display) return null;
  if (display.length > MAX_SCHOLAR_NO_LENGTH) throw invalid(`A scholar number has at most ${MAX_SCHOLAR_NO_LENGTH} characters.`, { [field]: "Too long" });
  if (!/^[\p{L}\p{N}][\p{L}\p{N} /._-]*$/u.test(display)) throw invalid("A scholar number may contain letters, digits, spaces and / . _ - only.", { [field]: "Invalid characters" });
  return { scholarNo: display, scholarNoKey: scholarNoKey(display) };
}

/** The student holding this scholar number in the school, if any. */
export async function studentByScholarNo(ctx: QueryCtx, schoolId: Id<"schools">, key: string): Promise<Doc<"students"> | null> {
  return await ctx.db.query("students").withIndex("by_school_scholar", (q) => q.eq("schoolId", schoolId).eq("scholarNoKey", key)).first();
}

/** Throws CONFLICT when another student of the school already has this scholar number. */
export async function assertScholarNoAvailable(ctx: QueryCtx, schoolId: Id<"schools">, key: string, exceptStudentId?: Id<"students">): Promise<void> {
  const rows = await ctx.db.query("students").withIndex("by_school_scholar", (q) => q.eq("schoolId", schoolId).eq("scholarNoKey", key)).take(2);
  const other = rows.find((s) => s._id !== exceptStudentId);
  if (other) throw conflict(`Scholar number ${other.scholarNo ?? key} is already used by ${other.firstName} ${other.lastName} (admission no. ${other.admissionNo}).`);
}

/** Name key for the duplicate-person check: accents removed, lower case, single spaces. */
export function personNameKey(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Existing students of the school with the same name and date of birth (any
 * status — a returning student must be re-enrolled, not admitted again).
 */
export async function possibleDuplicates(ctx: QueryCtx, schoolId: Id<"schools">, p: { firstName: string; lastName: string; dateOfBirth: string }, exceptStudentId?: Id<"students">) {
  const key = personNameKey(p.firstName, p.lastName);
  const out: Doc<"students">[] = [];
  for (const status of ["active", "inactive", "alumni", "transferred"] as const) {
    // The index is on the stored last name; also try its trimmed form.
    const rows = await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", schoolId).eq("status", status).eq("lastName", p.lastName.trim())).take(500);
    for (const s of rows) if (s._id !== exceptStudentId && s.dateOfBirth === p.dateOfBirth && personNameKey(s.firstName, s.lastName) === key) out.push(s);
  }
  return out;
}

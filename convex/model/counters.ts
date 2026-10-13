/**
 * Per-school document number allocation (admission numbers, employee ids,
 * receipt numbers).
 *
 * WHY THIS IS SAFE UNDER CONCURRENCY: Convex mutations run as serializable
 * transactions with optimistic concurrency control. `allocateNumber` reads the
 * counter row and writes the incremented value in the SAME transaction as the
 * document that uses the number. If two mutations allocate from the same key
 * at once, one of them is retried automatically with the new value, so no two
 * committed documents can receive the same number. Never cache or pre-compute
 * numbers outside the mutation that consumes them.
 *
 * Server-only helpers: there is deliberately no public function that hands out
 * numbers by itself.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { invalid } from "../core/errors";

const KEY_PATTERN = /^[a-z][a-z0-9_]*(:[A-Za-z0-9_-]+)?$/;

export const counterKeys = {
  /** Admission numbers restart each calendar year of admission: AA-2026-0001. */
  admission: (year: string) => `admission:${year}`,
  /** Employee ids are one running sequence per school: AA-EMP-001. */
  employee: () => "employee",
  /** Receipt numbers restart each academic year: AA/26-27/0001. */
  receipt: (academicYearId: Id<"academicYears">) => `receipt:${academicYearId}`,
};

function assertKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw invalid(`Invalid counter key "${key}"`);
}

async function counterRow(ctx: QueryCtx, schoolId: Id<"schools">, key: string) {
  return await ctx.db
    .query("counters")
    .withIndex("by_school_key", (q) => q.eq("schoolId", schoolId).eq("key", key))
    .unique();
}

/** Allocate the next number for `key` (1, 2, 3 …). Must be called inside the mutation that uses it. */
export async function allocateNumber(ctx: MutationCtx, schoolId: Id<"schools">, key: string): Promise<number> {
  assertKey(key);
  const row = await counterRow(ctx, schoolId, key);
  if (row) {
    const next = row.value + 1;
    await ctx.db.patch(row._id, { value: next });
    return next;
  }
  await ctx.db.insert("counters", { schoolId, key, value: 1 });
  return 1;
}

/**
 * Make sure the counter is at least `value` (used when importing or seeding
 * existing documents, so newly allocated numbers continue after them).
 * Never moves a counter backwards.
 */
export async function ensureCounterAtLeast(ctx: MutationCtx, schoolId: Id<"schools">, key: string, value: number): Promise<void> {
  assertKey(key);
  if (!Number.isSafeInteger(value) || value < 0) throw invalid("Counter value must be a non-negative whole number");
  const row = await counterRow(ctx, schoolId, key);
  if (!row) await ctx.db.insert("counters", { schoolId, key, value });
  else if (row.value < value) await ctx.db.patch(row._id, { value });
}

/** Read-only peek (for previews/admin screens); never use the result as an allocated number. */
export async function peekCounter(ctx: QueryCtx, schoolId: Id<"schools">, key: string): Promise<number> {
  return (await counterRow(ctx, schoolId, key))?.value ?? 0;
}

// ---------------------------------------------------------------- formatters
const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** "AA-2026-0001" */
export function formatAdmissionNumber(school: Pick<Doc<"schools">, "code">, year: string, n: number): string {
  return `${school.code}-${year}-${pad(n, 4)}`;
}

/** "AA-EMP-001" */
export function formatEmployeeId(school: Pick<Doc<"schools">, "code">, n: number): string {
  return `${school.code}-EMP-${pad(n, 3)}`;
}

/** "2026-27" → "26-27" (academic year label used inside receipt numbers). */
export function academicYearShortCode(yearName: string): string {
  const m = yearName.match(/^\d{2}(\d{2})\D+(\d{2})(\d{2})?$/);
  if (!m) return yearName;
  return `${m[1]}-${m[3] ?? m[2]}`;
}

/** "AA/26-27/0001" */
export function formatReceiptNumber(school: Pick<Doc<"schools">, "code">, year: Pick<Doc<"academicYears">, "name">, n: number): string {
  return `${school.code}/${academicYearShortCode(year.name)}/${pad(n, 4)}`;
}

/** Allocate + format in one step (inside the consuming mutation). */
export async function nextAdmissionNumber(ctx: MutationCtx, school: Doc<"schools">, year: string) {
  return formatAdmissionNumber(school, year, await allocateNumber(ctx, school._id, counterKeys.admission(year)));
}

export async function nextEmployeeId(ctx: MutationCtx, school: Doc<"schools">) {
  return formatEmployeeId(school, await allocateNumber(ctx, school._id, counterKeys.employee()));
}

export async function nextReceiptNumber(ctx: MutationCtx, school: Doc<"schools">, year: Doc<"academicYears">) {
  return formatReceiptNumber(school, year, await allocateNumber(ctx, school._id, counterKeys.receipt(year._id)));
}

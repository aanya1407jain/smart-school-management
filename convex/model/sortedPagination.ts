/**
 * Deterministic pagination over a BOUNDED list that is sorted in memory with
 * the roster comparator (model/rollNumbers.ts) — used where no index can
 * express the documented order (case-/accent-insensitive first name, then last
 * name, then ids).
 *
 * Cursors are sort keys, not offsets: a page is the key range (cursor, end].
 *  - `cursor`    : exclusive start (null = beginning).
 *  - `endCursor` : inclusive end pinned by the client (Convex usePaginatedQuery
 *                  sends it after a page split).
 * A page that is not the last one returns `splitCursor` + "SplitRecommended",
 * so the client immediately pins it as two key ranges with explicit ends.
 * Pinned ranges partition the key space: when students are added, removed or
 * renamed, every record still belongs to exactly one loaded page — no
 * duplicates and no gaps across pages. The last page ends at END and therefore
 * includes records added after it. Filtering (e.g. inactive students) happens
 * BEFORE pagination, so pages are never short or overlapping because of it.
 *
 * Unknown/legacy cursor strings fail with "InvalidCursor", which makes
 * usePaginatedQuery restart from the first page.
 */
import { nameSortKey } from "./rollNumbers";
import { AppError } from "../core/errors";

export type SortKey = [first: string, last: string, studentId: string, enrollmentId: string];

const END = "END";

export function sortKeyOf(p: { firstName: string; lastName: string; studentId: string; enrollmentId?: string }): SortKey {
  return [nameSortKey(p.firstName), nameSortKey(p.lastName), p.studentId, p.enrollmentId ?? ""];
}

/** Same order as compareRosterEntries (code-point comparison of normalised names, then ids). */
export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function encode(k: SortKey): string {
  return JSON.stringify(["k1", ...k]);
}

function decode(cursor: string): SortKey {
  try {
    const v = JSON.parse(cursor);
    if (Array.isArray(v) && v.length === 5 && v[0] === "k1" && v.slice(1).every((x) => typeof x === "string")) return v.slice(1) as SortKey;
  } catch {
    // fall through
  }
  // AppError is a ConvexError, so the text reaches the client even in production; usePaginatedQuery resets on "InvalidCursor".
  throw new AppError("INVALID_ARGUMENT", "InvalidCursor: this list's order changed; reloading from the first page.");
}

export type PageOpts = { numItems: number; cursor: string | null; endCursor?: string | null };

/**
 * Page `items` (any order; sorted here). `keyOf` must return a unique key per item.
 */
export function paginateSorted<T>(items: T[], keyOf: (t: T) => SortKey, opts: PageOpts) {
  const keyed = items.map((item) => ({ item, key: keyOf(item) })).sort((a, b) => compareKeys(a.key, b.key));
  const start = opts.cursor ? decode(opts.cursor) : null;
  const after = start ? keyed.filter((x) => compareKeys(x.key, start) > 0) : keyed;

  if (opts.endCursor) {
    // Pinned range (cursor, endCursor]: return all of it, never split again.
    if (opts.endCursor === END) return { page: after.map((x) => x.item), isDone: true, continueCursor: END };
    const end = decode(opts.endCursor);
    const inRange = after.filter((x) => compareKeys(x.key, end) <= 0);
    return { page: inRange.map((x) => x.item), isDone: false, continueCursor: opts.endCursor };
  }

  const n = Math.max(1, Math.floor(opts.numItems));
  if (after.length <= n) return { page: after.map((x) => x.item), isDone: true, continueCursor: END };
  const taken = after.slice(0, n);
  const continueCursor = encode(taken[taken.length - 1].key);
  return {
    page: taken.map((x) => x.item),
    isDone: false,
    continueCursor,
    // Ask the client to pin this page's end so reactive updates cannot shift records between pages.
    splitCursor: encode(taken[Math.floor((taken.length - 1) / 2)].key),
    pageStatus: "SplitRecommended" as const,
  };
}

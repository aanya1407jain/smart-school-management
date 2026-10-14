/**
 * Roll numbers — always system-assigned, per SECTION.
 *
 * A section belongs to exactly one school, academic year and class, so the
 * section is the roster scope. Roll numbers live on the year-specific
 * `enrollments` row (never on the student), so history in other years and
 * sections is untouched, and every academic record keeps pointing at stable
 * student / enrollment IDs.
 *
 * Policy (renumberSection):
 *   roster  = all ACTIVE enrollments of the section (the existing definition
 *             of "currently enrolled", see model/academics.ts activeRoster)
 *   order   = first name, then last name — case-insensitive, accent-folded,
 *             whitespace-normalised — then student _id, then enrollment _id
 *             (deterministic tie-breakers; database order is never relied on)
 *   numbers = 1..n, consecutive, no duplicates or gaps
 *
 * Call it in the SAME mutation that changes a roster (import, enrollment,
 * transfer, withdrawal). A Convex mutation is one serializable transaction:
 * the roster change and the renumbering commit together or not at all, and a
 * concurrent mutation that touches the same section is retried by Convex on
 * conflict — so a half-renumbered roster can never be observed.
 */
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AppError } from "../core/errors";

/**
 * Largest roster renumbered in one transaction. Each student costs two reads
 * and at most one write; this keeps a renumber (plus a 300-row import in the
 * same mutation) well inside Convex's per-transaction read/write limits.
 */
export const MAX_SECTION_ROSTER = 1000;

/** Sort key for a name part: NFKD, accents removed, lower case, single spaces. */
export function nameSortKey(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type RosterEntry = { enrollmentId: string; studentId: string; firstName: string; lastName: string };

/** Deterministic roster order (exported for tests). Plain code-point comparison — identical in every runtime. */
export function compareRosterEntries(a: RosterEntry, b: RosterEntry): number {
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return (
    cmp(nameSortKey(a.firstName), nameSortKey(b.firstName)) ||
    cmp(nameSortKey(a.lastName), nameSortKey(b.lastName)) ||
    cmp(a.studentId, b.studentId) ||
    cmp(a.enrollmentId, b.enrollmentId)
  );
}

/**
 * Renumber one section's active roster 1..n. Only rows whose number changes
 * are written. Returns the roster size and how many enrollments changed.
 */
export async function renumberSection(ctx: MutationCtx, sectionId: Id<"sections">): Promise<{ size: number; changed: number }> {
  const section = await ctx.db.get(sectionId);
  if (!section) return { size: 0, changed: 0 };
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active"))
    .take(MAX_SECTION_ROSTER + 1);
  if (enrollments.length > MAX_SECTION_ROSTER) {
    throw new AppError("CONFLICT", `${section.displayName} has more than ${MAX_SECTION_ROSTER} active students; roll numbers cannot be assigned automatically.`);
  }
  const rows: { enrollment: Doc<"enrollments">; entry: RosterEntry }[] = [];
  for (const enrollment of enrollments) {
    // Defence in depth: only this section's school/year counts.
    if (enrollment.schoolId !== section.schoolId || enrollment.academicYearId !== section.academicYearId) continue;
    const student = await ctx.db.get(enrollment.studentId);
    if (!student || student.schoolId !== section.schoolId) continue;
    rows.push({ enrollment, entry: { enrollmentId: enrollment._id, studentId: student._id, firstName: student.firstName, lastName: student.lastName } });
  }
  rows.sort((a, b) => compareRosterEntries(a.entry, b.entry));
  let changed = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].enrollment.rollNo !== i + 1) {
      await ctx.db.patch(rows[i].enrollment._id, { rollNo: i + 1 });
      changed++;
    }
  }
  return { size: rows.length, changed };
}

/** Renumber several sections (each independently), e.g. every section an import touched. */
export async function renumberSections(ctx: MutationCtx, sectionIds: Iterable<Id<"sections">>) {
  const done = new Set<string>();
  for (const id of sectionIds) {
    if (done.has(id)) continue;
    done.add(id);
    await renumberSection(ctx, id);
  }
}

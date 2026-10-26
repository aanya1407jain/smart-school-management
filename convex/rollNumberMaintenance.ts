/**
 * Roll-number RECONCILIATION for existing rosters — an explicit, operator-run,
 * dry-run-first maintenance operation. Nothing here runs on start-up, on page
 * load or on deploy, and none of it is callable from the app: every function is
 * internal (Convex CLI / dashboard with deployment credentials only).
 *
 * Why: alphabetical roll numbers (model/rollNumbers.ts) are assigned whenever a
 * section's roster changes. Rosters that have not changed since that policy was
 * introduced still carry legacy numbers (seed order, older imports, admissions
 * without a number). This brings them in line with the SAME policy and code
 * (`planSectionRoster`) — first name, last name (case-, accent- and
 * whitespace-insensitive), then student id, then enrollment id; 1..n.
 *
 * 1. Dry run (READ-ONLY — a Convex query cannot write):
 *      npx convex run rollNumberMaintenance:dryRun '{"schoolSlug":"aster-academy","academicYear":"2026-27"}'
 *    Reports every active enrollment of every section of that school + year:
 *    current vs proposed roll number, missing / duplicate numbers, a per-section
 *    fingerprint of the reviewed state, totals, and `applyArgs` (only sections
 *    that would change). Large schools are reported in chunks: pass the returned
 *    `nextStartAt` as `startAt` until it is null.
 *
 * 2. Apply (WRITES — only after the dry run was reviewed):
 *      npx convex run rollNumberMaintenance:apply '<applyArgs from step 1>'
 *    `confirm` must be exactly "APPLY_ROLL_NUMBER_RECONCILIATION". Each section
 *    is applied in its own transaction (atomic per section) and only if its
 *    current state still matches the reviewed fingerprint; otherwise it is
 *    reported as `stale` and NOT changed (re-run the dry run). School, year,
 *    section ↔ school/year and enrollment state are re-validated in that
 *    transaction. A section already in policy order reports
 *    `already_reconciled` and writes nothing, so re-running is idempotent.
 *    Each applied section writes one `enrollment.roll_numbers_reconciled` audit row.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { AppError } from "./core/errors";
import { applyRollNo, planSectionRoster, nameSortKey, type RosterPlanRow } from "./model/rollNumbers";
import { fullName } from "./model/academics";
import { writeAudit } from "./model/audit";
import { getSchoolSettings } from "./core/authorization";

export const APPLY_CONFIRMATION = "APPLY_ROLL_NUMBER_RECONCILIATION";

/** Enrollments examined per dry-run call before it returns a `nextStartAt` (keeps one query well inside Convex read limits). */
const DRY_RUN_ENROLLMENT_BUDGET = 3000;
/** Sections accepted by one `apply` call. */
const MAX_APPLY_SECTIONS = 500;

const targetArgs = { schoolSlug: v.string(), academicYear: v.string() };

async function resolveTarget(ctx: QueryCtx, schoolSlug: string, academicYear: string) {
  const school = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", schoolSlug)).unique();
  if (!school) throw new AppError("NOT_FOUND", `No school with slug "${schoolSlug}".`);
  const years = (await ctx.db.query("academicYears").withIndex("by_school_start", (q) => q.eq("schoolId", school._id)).collect())
    .filter((y) => y.name === academicYear);
  if (years.length === 0) throw new AppError("NOT_FOUND", `${school.name} has no academic year named "${academicYear}".`);
  if (years.length > 1) throw new AppError("CONFLICT", `${school.name} has ${years.length} academic years named "${academicYear}"; resolve the duplicate first.`);
  return { school, year: years[0] };
}

const byLabel = (a: Doc<"sections">, b: Doc<"sections">) =>
  a.displayName.localeCompare(b.displayName, undefined, { numeric: true }) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);

async function sectionsOf(ctx: QueryCtx, schoolId: Id<"schools">, yearId: Id<"academicYears">) {
  const rows = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId)).collect();
  return rows.sort(byLabel);
}

/**
 * Deterministic fingerprint of the state a reviewer saw: every active
 * enrollment with its stored number and normalised name, in policy order.
 * Any roster, name or number change in between produces a different value.
 * (FNV-1a — change detection only, not a security measure.)
 */
export function rosterFingerprint(rows: RosterPlanRow[]): string {
  const text = rows
    .map((r) => [r.enrollment._id, r.student._id, r.currentRollNo ?? "", nameSortKey(r.student.firstName), nameSortKey(r.student.lastName)].join("|"))
    .join("\n");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ rows.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${rows.length}-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function analyse(rows: RosterPlanRow[]) {
  const counts = new Map<number, number>();
  for (const r of rows) if (r.currentRollNo !== null) counts.set(r.currentRollNo, (counts.get(r.currentRollNo) ?? 0) + 1);
  return {
    missingRollNos: rows.filter((r) => r.currentRollNo === null).length,
    duplicateRollNos: [...counts.entries()].filter(([, n]) => n > 1).map(([rollNo]) => rollNo).sort((a, b) => a - b),
    changed: rows.filter((r) => r.currentRollNo !== r.proposedRollNo).length,
  };
}

/** READ-ONLY dry run for one school + academic year. See the module comment. */
export const dryRun = internalQuery({
  args: { ...targetArgs, startAt: v.optional(v.number()), changedOnly: v.optional(v.boolean()) },
  handler: async (ctx, { schoolSlug, academicYear, startAt, changedOnly }) => {
    const { school, year } = await resolveTarget(ctx, schoolSlug, academicYear);
    const sections = await sectionsOf(ctx, school._id, year._id);
    const from = Math.max(0, Math.floor(startAt ?? 0));
    const report = [];
    let examined = 0;
    let i = from;
    for (; i < sections.length; i++) {
      if (examined >= DRY_RUN_ENROLLMENT_BUDGET && report.length > 0) break;
      const section = sections[i];
      const { rows, excluded } = await planSectionRoster(ctx, section);
      examined += rows.length + excluded.length;
      const a = analyse(rows);
      report.push({
        sectionId: section._id,
        section: section.displayName,
        activeEnrollments: rows.length,
        missingRollNos: a.missingRollNos,
        duplicateRollNos: a.duplicateRollNos,
        wouldChange: a.changed,
        fingerprint: rosterFingerprint(rows),
        excluded,
        students: rows
          .filter((r) => !changedOnly || r.currentRollNo !== r.proposedRollNo)
          .map((r) => ({
            enrollmentId: r.enrollment._id,
            studentId: r.student._id,
            admissionNo: r.student.admissionNo,
            name: fullName(r.student),
            currentRollNo: r.currentRollNo,
            proposedRollNo: r.proposedRollNo,
            changed: r.currentRollNo !== r.proposedRollNo,
          })),
      });
    }
    const needing = report.filter((s) => s.wouldChange > 0);
    const settings = await getSchoolSettings(ctx, school._id);
    return {
      mode: "dry_run" as const,
      writes: 0,
      school: { slug: school.slug, name: school.name },
      academicYear: { id: year._id, name: year.name, status: year.status, isCurrent: settings.currentAcademicYearId === year._id },
      sectionsInYear: sections.length,
      range: { startAt: from, endBefore: i },
      nextStartAt: i < sections.length ? i : null,
      totals: {
        sections: report.length,
        sectionsNeedingChanges: needing.length,
        activeEnrollments: report.reduce((n, s) => n + s.activeEnrollments, 0),
        wouldChange: report.reduce((n, s) => n + s.wouldChange, 0),
        missingRollNos: report.reduce((n, s) => n + s.missingRollNos, 0),
        sectionsWithDuplicateRollNos: report.filter((s) => s.duplicateRollNos.length > 0).length,
        excludedEnrollments: report.reduce((n, s) => n + s.excluded.length, 0),
      },
      sections: report,
      applyArgs: needing.length
        ? { schoolSlug: school.slug, academicYear: year.name, confirm: APPLY_CONFIRMATION, sections: needing.map((s) => ({ sectionId: s.sectionId, fingerprint: s.fingerprint })) }
        : null,
    };
  },
});

/**
 * Apply ONE reviewed section atomically (one transaction). Re-validates the
 * school, year, the section's school/year and the active enrollments, then
 * renumbers only if the state still matches the reviewed fingerprint.
 */
export const applySection = internalMutation({
  args: { ...targetArgs, sectionId: v.id("sections"), fingerprint: v.string(), confirm: v.string() },
  handler: async (ctx, { schoolSlug, academicYear, sectionId, fingerprint, confirm }) => {
    if (confirm !== APPLY_CONFIRMATION) throw new AppError("INVALID_ARGUMENT", `confirm must be "${APPLY_CONFIRMATION}" (run the dry run first).`);
    const { school, year } = await resolveTarget(ctx, schoolSlug, academicYear);
    const section = await ctx.db.get(sectionId);
    if (!section || section.schoolId !== school._id) throw new AppError("NOT_FOUND", "Section not found in this school.");
    if (section.academicYearId !== year._id) throw new AppError("INVALID_RELATIONSHIP", `${section.displayName} does not belong to academic year ${year.name}.`);

    const { rows } = await planSectionRoster(ctx, section);
    const changes = rows.filter((r) => r.currentRollNo !== r.proposedRollNo);
    if (changes.length === 0) return { sectionId, section: section.displayName, status: "already_reconciled" as const, changed: 0 };
    if (rosterFingerprint(rows) !== fingerprint) {
      return { sectionId, section: section.displayName, status: "stale" as const, changed: 0, message: "The roster changed since the dry run. Nothing was written; run the dry run again and review it." };
    }
    for (const r of changes) await applyRollNo(ctx, r, "reconciliation");
    await writeAudit(ctx, {
      schoolId: school._id,
      action: "enrollment.roll_numbers_reconciled",
      entity: { table: "sections", id: section._id },
      summary: `Reconciled roll numbers of ${section.displayName} (${year.name}): ${changes.length} of ${rows.length} changed to alphabetical order`,
      metadata: { academicYear: year.name, size: rows.length, changed: changes.length, fingerprint },
    });
    return { sectionId, section: section.displayName, status: "applied" as const, changed: changes.length };
  },
});

/**
 * Apply the reviewed `applyArgs` of a dry run. Sections are applied one by one,
 * each in its own transaction; a failing or stale section does not affect the
 * others and is reported. Safe to re-run.
 */
export const apply = internalAction({
  args: { ...targetArgs, confirm: v.string(), sections: v.array(v.object({ sectionId: v.id("sections"), fingerprint: v.string() })) },
  handler: async (ctx, { schoolSlug, academicYear, confirm, sections }) => {
    if (confirm !== APPLY_CONFIRMATION) throw new AppError("INVALID_ARGUMENT", `confirm must be "${APPLY_CONFIRMATION}" (run the dry run first).`);
    if (sections.length === 0) throw new AppError("INVALID_ARGUMENT", "No sections given; copy `applyArgs` from the dry run.");
    if (sections.length > MAX_APPLY_SECTIONS) throw new AppError("INVALID_ARGUMENT", `At most ${MAX_APPLY_SECTIONS} sections per call.`);
    if (new Set(sections.map((s) => s.sectionId)).size !== sections.length) throw new AppError("INVALID_ARGUMENT", "A section is listed twice.");
    const results: { sectionId: string; section?: string; status: "applied" | "already_reconciled" | "stale" | "failed"; changed: number; message?: string }[] = [];
    for (const s of sections) {
      try {
        results.push(await ctx.runMutation(internal.rollNumberMaintenance.applySection, { schoolSlug, academicYear, confirm, sectionId: s.sectionId, fingerprint: s.fingerprint }));
      } catch (e) {
        const data = (e as { data?: { message?: string } }).data;
        results.push({ sectionId: s.sectionId, status: "failed", changed: 0, message: data?.message ?? (e instanceof Error ? e.message : String(e)) });
      }
    }
    return {
      mode: "apply" as const,
      changed: results.reduce((n, r) => n + r.changed, 0),
      applied: results.filter((r) => r.status === "applied").length,
      alreadyReconciled: results.filter((r) => r.status === "already_reconciled").length,
      stale: results.filter((r) => r.status === "stale").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };
  },
});

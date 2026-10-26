/**
 * Admission register (CSR / scholar register) — Student Management module.
 *
 * Standard columns are DERIVED from existing records, so the register never
 * holds a second copy of a student's data:
 *   admission no., scholar no., name, gender, date of birth, admission date,
 *   status, address                       ← students
 *   parent name / relation / phone        ← primary parent contact (guardianLinks)
 *   class & section admitted to           ← the student's earliest enrollment
 *   current class, section, roll no.      ← the active enrollment (current year)
 *   leaving date, TC no., reason          ← the latest ISSUED transfer certificate
 *
 * School-specific columns are PLUGGABLE: the Principal defines them
 * (`defineField`, settings:manage) and the office fills them per student
 * (`setStudentValues`, students:write). Which extra columns a school needs is
 * pending confirmation with each school, so none are created by default.
 *
 * Access: reading the register needs students:read:all; downloading it
 * (`exportPage`) additionally needs students:export (Students → Export grant).
 * Every function returns MODULE_DISABLED when Student Management is off; the
 * data is kept.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { moduleMutation, moduleQuery } from "./core/functions";
import { getInSchool, requireAnyPermission, requirePermission } from "./core/authorization";
import { conflict, invalid } from "./core/errors";
import { assertIsoDate, assertNonEmpty } from "./core/validators";
import type { Actor } from "./core/actor";
import { fullName } from "./model/academics";
import { writeAudit } from "./model/audit";

const studentsQuery = moduleQuery("students");
const studentsMutation = moduleMutation("students");

export const MAX_REGISTER_FIELDS = 40;
export const MAX_REGISTER_PAGE = 100;
const MAX_TEXT_VALUE = 500;
const FIELD_KEY = /^[a-z][a-z0-9_]{1,39}$/;

const vFieldType = v.union(v.literal("text"), v.literal("number"), v.literal("date"), v.literal("select"), v.literal("boolean"));
const vValue = v.union(v.string(), v.number(), v.boolean(), v.null());
type FieldDoc = Doc<"admissionRegisterFields">;
type Value = string | number | boolean;
type Ctx = QueryCtx & { actor: Actor };

async function schoolFields(ctx: Ctx): Promise<FieldDoc[]> {
  const rows = await ctx.db.query("admissionRegisterFields").withIndex("by_school_key", (q) => q.eq("schoolId", ctx.actor.schoolId)).take(MAX_REGISTER_FIELDS * 2);
  return rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** A stored or submitted value checked against its field definition. Throws INVALID_ARGUMENT. */
export function checkValue(field: Pick<FieldDoc, "key" | "label" | "type" | "options">, value: unknown): Value {
  const bad = (why: string) => invalid(`${field.label}: ${why}`, { [field.key]: why });
  switch (field.type) {
    case "text": {
      if (typeof value !== "string") throw bad("must be text");
      const t = value.trim();
      if (!t) throw bad("must not be empty (send null to clear it)");
      if (t.length > MAX_TEXT_VALUE) throw bad(`at most ${MAX_TEXT_VALUE} characters`);
      return t;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw bad("must be a number");
      return value;
    case "date":
      if (typeof value !== "string") throw bad("must be a date (YYYY-MM-DD)");
      assertIsoDate(value, field.key);
      return value;
    case "select":
      if (typeof value !== "string" || !(field.options ?? []).includes(value)) throw bad(`must be one of: ${(field.options ?? []).join(", ")}`);
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw bad("must be yes or no");
      return value;
  }
}

// ---------------------------------------------------------------- field definitions

/** The school's extra register columns, in order. Inactive ones only for the Principal (settings:manage). */
export const fields = studentsQuery({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    requireAnyPermission(ctx.actor, ["students:read:all", "settings:manage"]);
    if (includeInactive) requirePermission(ctx.actor, "settings:manage");
    return (await schoolFields(ctx))
      .filter((f) => includeInactive || f.active)
      .map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? null, required: f.required, order: f.order, active: f.active }));
  },
});

/**
 * Create or change one extra register column (Principal: settings:manage).
 * The key and type are fixed once created; deactivate a column instead of
 * deleting it (its values are kept and come back if it is reactivated).
 */
export const defineField = studentsMutation({
  args: {
    key: v.string(),
    label: v.string(),
    type: vFieldType,
    options: v.optional(v.array(v.string())),
    required: v.optional(v.boolean()),
    order: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    requirePermission(ctx.actor, "settings:manage");
    const key = a.key.trim();
    if (!FIELD_KEY.test(key)) throw invalid("A column key is 2–40 characters: a lower-case letter, then letters, digits or _.", { key: "Invalid key" });
    const label = assertNonEmpty(a.label, "label", 60);
    let options: string[] | undefined;
    if (a.type === "select") {
      options = [...new Set((a.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (options.length === 0 || options.length > 50 || options.some((o) => o.length > 60)) throw invalid("A choice column needs 1–50 choices of at most 60 characters.", { options: "Invalid choices" });
    } else if (a.options?.length) {
      throw invalid("Only choice (select) columns have choices.", { options: "Not allowed for this type" });
    }
    if (a.order !== undefined && (!Number.isInteger(a.order) || a.order < 0 || a.order > 1000)) throw invalid("Order must be a whole number from 0 to 1000.", { order: "Invalid" });

    const all = await schoolFields(ctx);
    const existing = all.find((f) => f.key === key);
    const next = {
      label, options, required: a.required ?? existing?.required ?? false,
      order: a.order ?? existing?.order ?? (all.at(-1)?.order ?? 0) + 10,
      active: a.active ?? existing?.active ?? true,
      updatedAt: Date.now(), updatedByUserId: ctx.actor.userId,
    };
    if (existing) {
      if (existing.type !== a.type) throw conflict(`Column "${existing.label}" is a ${existing.type} column; its type cannot change. Add a new column instead.`);
      await ctx.db.patch(existing._id, next);
    } else {
      if (all.filter((f) => f.active).length >= MAX_REGISTER_FIELDS && next.active) throw conflict(`A register can have at most ${MAX_REGISTER_FIELDS} active extra columns.`);
      await ctx.db.insert("admissionRegisterFields", { schoolId: ctx.actor.schoolId, key, type: a.type, ...next });
    }
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: existing ? "admission_register.field_updated" : "admission_register.field_created",
      entity: { table: "admissionRegisterFields", id: existing?._id ?? key },
      summary: `${existing ? "Changed" : "Added"} admission register column "${label}"`,
      metadata: {
        key, type: a.type,
        before: existing ? { label: existing.label, options: existing.options ?? null, required: existing.required, order: existing.order, active: existing.active } : null,
        after: { label, options: options ?? null, required: next.required, order: next.order, active: next.active },
      },
    });
    return { key, created: !existing };
  },
});

// ---------------------------------------------------------------- values

/**
 * Set a student's extra register values (students:write). `null` clears a
 * value. Unknown or inactive columns, wrong types and an empty required
 * column are refused; nothing is written then. Audited (column keys only).
 */
export const setStudentValues = studentsMutation({
  args: { studentId: v.id("students"), values: v.record(v.string(), vValue) },
  handler: async (ctx, { studentId, values }) => {
    requirePermission(ctx.actor, "students:write");
    const student = await getInSchool(ctx, "students", studentId, "Student");
    const defs = new Map((await schoolFields(ctx)).filter((f) => f.active).map((f) => [f.key, f]));
    const row = await ctx.db.query("admissionRegisterValues").withIndex("by_school_student", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("studentId", student._id)).first();
    const merged: Record<string, Value> = { ...(row?.values ?? {}) };
    const changed: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      const def = defs.get(key);
      if (!def) throw invalid(`"${key}" is not an active admission register column.`, { [key]: "Unknown column" });
      if (value === null) {
        if (key in merged) { delete merged[key]; changed.push(key); }
        continue;
      }
      const checked = checkValue(def, value);
      if (merged[key] !== checked) { merged[key] = checked; changed.push(key); }
    }
    const missing = [...defs.values()].filter((d) => d.required && !(d.key in merged));
    if (missing.length) throw invalid(`Required register columns are empty: ${missing.map((d) => d.label).join(", ")}.`, Object.fromEntries(missing.map((d) => [d.key, "Required"])));
    if (changed.length === 0) return { changed };
    const doc = { values: merged, updatedAt: Date.now(), updatedByUserId: ctx.actor.userId };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("admissionRegisterValues", { schoolId: ctx.actor.schoolId, studentId: student._id, ...doc });
    await writeAudit(ctx, {
      schoolId: ctx.actor.schoolId, actor: ctx.actor, action: "admission_register.values_updated", entity: { table: "students", id: student._id },
      summary: `Updated admission register entries of ${fullName(student)} (${student.admissionNo})`,
      metadata: { columns: changed },
    });
    return { changed };
  },
});

// ---------------------------------------------------------------- register rows

type Names = Map<string, string>;

async function nameOf(ctx: QueryCtx, cache: Names, id: Id<"classes"> | Id<"sections"> | Id<"academicYears">): Promise<string> {
  if (!cache.has(id)) {
    const doc = await ctx.db.get(id);
    cache.set(id, doc ? ("displayName" in doc ? doc.displayName : doc.name) : "");
  }
  return cache.get(id)!;
}

/** One register row for a student: the derived standard columns + the school's extra columns. */
async function registerRow(ctx: Ctx, s: Doc<"students">, defs: FieldDoc[], cache: Names) {
  const schoolId = ctx.actor.schoolId;
  const links = (await ctx.db.query("guardianLinks").withIndex("by_student", (q) => q.eq("studentId", s._id)).take(10)).filter((l) => l.schoolId === schoolId);
  const link = links.find((l) => l.isPrimary) ?? links[0];
  const parent = link ? await ctx.db.get(link.guardianId) : null;

  const enrollments = (await ctx.db.query("enrollments").withIndex("by_student_year", (q) => q.eq("studentId", s._id)).take(50)).filter((e) => e.schoolId === schoolId);
  const first = [...enrollments].sort((a, b) => a.startDate.localeCompare(b.startDate) || a._creationTime - b._creationTime)[0];
  const current = enrollments.find((e) => e.status === "active");

  const tcs = await ctx.db.query("transferCertificates").withIndex("by_school_student", (q) => q.eq("schoolId", schoolId).eq("studentId", s._id)).take(20);
  const tc = tcs.filter((t) => t.status === "issued").sort((a, b) => b.issueDate.localeCompare(a.issueDate))[0];

  const valuesRow = await ctx.db.query("admissionRegisterValues").withIndex("by_school_student", (q) => q.eq("schoolId", schoolId).eq("studentId", s._id)).first();
  const custom: Record<string, Value | null> = {};
  for (const d of defs) custom[d.key] = valuesRow?.values[d.key] ?? null;

  return {
    studentId: s._id,
    admissionNo: s.admissionNo,
    scholarNo: s.scholarNo ?? null,
    name: fullName(s),
    gender: s.gender ?? null,
    dateOfBirth: s.dateOfBirth ?? null,
    admissionDate: s.admissionDate ?? null,
    status: s.status,
    address: s.address ?? null,
    parent: parent ? { name: parent.name, relation: link!.relationship, phone: parent.phone } : null,
    admittedTo: first ? { academicYear: await nameOf(ctx, cache, first.academicYearId), className: await nameOf(ctx, cache, first.classId), section: await nameOf(ctx, cache, first.sectionId) } : null,
    current: current ? { academicYear: await nameOf(ctx, cache, current.academicYearId), className: await nameOf(ctx, cache, current.classId), section: await nameOf(ctx, cache, current.sectionId), rollNo: current.rollNo ?? null } : null,
    leaving: tc ? { tcNo: tc.tcNo, leavingDate: tc.leavingDate, reason: tc.reason } : null,
    custom,
    missingRequired: defs.filter((d) => d.required && custom[d.key] === null).map((d) => d.key),
  };
}

async function registerPage(ctx: Ctx, paginationOpts: { numItems: number; cursor: string | null }) {
  if (!Number.isInteger(paginationOpts.numItems) || paginationOpts.numItems < 1 || paginationOpts.numItems > MAX_REGISTER_PAGE) {
    throw invalid(`Ask for 1–${MAX_REGISTER_PAGE} register rows at a time.`);
  }
  const defs = (await schoolFields(ctx)).filter((f) => f.active);
  // Register order: admission number (the index order), all statuses — leavers stay in the register.
  const page = await ctx.db.query("students").withIndex("by_school_admission", (q) => q.eq("schoolId", ctx.actor.schoolId)).paginate(paginationOpts);
  const cache: Names = new Map();
  const rows = [];
  for (const s of page.page) rows.push(await registerRow(ctx, s, defs, cache));
  return {
    ...page,
    page: rows,
    columns: defs.map((d) => ({ key: d.key, label: d.label, type: d.type, options: d.options ?? null, required: d.required })),
  };
}

/** One page of the register, in admission-number order (students:read:all). */
export const page = studentsQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    requirePermission(ctx.actor, "students:read:all");
    return await registerPage(ctx, paginationOpts);
  },
});

/** The same rows for downloading the register: also needs students:export (Students → Export). */
export const exportPage = studentsQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    requirePermission(ctx.actor, "students:read:all");
    requirePermission(ctx.actor, "students:export");
    return await registerPage(ctx, paginationOpts);
  },
});

/** One student's register entry (students:read:all). */
export const studentEntry = studentsQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    requirePermission(ctx.actor, "students:read:all");
    const student = await getInSchool(ctx, "students", studentId, "Student");
    const defs = (await schoolFields(ctx)).filter((f) => f.active);
    return await registerRow(ctx, student, defs, new Map());
  },
});

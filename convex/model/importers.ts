/**
 * Server-side import analyzers + committers (students, teachers).
 *
 * `analyze*` is the single authority on whether a row is valid. It runs for
 * the preview (query) AND again inside the commit (mutation), so a forged or
 * stale client preview can never insert bad data. A commit with ANY invalid
 * row writes nothing (the mutation throws before the first insert, and Convex
 * mutations are atomic). Manual "Add student / Add teacher" uses the same
 * path with a single row.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Actor } from "../core/actor";
import { getCurrentAcademicYearId } from "../core/authorization";
import { AppError } from "../core/errors";
import { canonicalLoginId } from "./loginIds";
import { isLoginIdTaken, reserveAccount } from "./accounts";
import { counterKeys, ensureCounterAtLeast, nextAdmissionNumber, nextEmployeeId } from "./counters";
import { IMPORT_SPECS, MAX_IMPORT_ROWS, academicYearMatches, parseDateInput, parseGender, type ImportSpec, type ImportTarget } from "./importSpecs";
import { writeAudit } from "./audit";
import { MAX_SECTION_ROSTER, renumberSections } from "./rollNumbers";

export type ImportRowInput = { rowNumber: number; values: Record<string, string> };
export type RowIssue = { field: string; message: string };
export type RowResult = { rowNumber: number; label: string; status: "valid" | "warning" | "invalid"; errors: RowIssue[]; warnings: RowIssue[] };

type Ctx = QueryCtx & { actor: Actor };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------- shared row helpers
class RowReader {
  errors: RowIssue[] = [];
  warnings: RowIssue[] = [];
  constructor(private spec: ImportSpec, private values: Record<string, string>) {}

  private field(key: string) {
    const f = this.spec.fields.find((x) => x.key === key);
    if (!f) throw new Error(`Unknown import field ${key}`);
    return f;
  }
  raw(key: string): string {
    const v = this.values[key];
    return typeof v === "string" ? v.trim() : "";
  }
  text(key: string, required = false): string | undefined {
    const f = this.field(key);
    const v = this.raw(key);
    if (!v) {
      if (required || f.required) this.errors.push({ field: key, message: `${f.label} is required` });
      return undefined;
    }
    if (f.max && v.length > f.max) this.errors.push({ field: key, message: `${f.label} is too long (max ${f.max})` });
    return v;
  }
  date(key: string, opts: { notAfter?: string } = {}): string | undefined {
    const v = this.raw(key);
    if (!v) return undefined;
    const iso = parseDateInput(v);
    if (!iso) { this.errors.push({ field: key, message: `${this.field(key).label} "${v}" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY)` }); return undefined; }
    if (opts.notAfter && iso > opts.notAfter) this.errors.push({ field: key, message: `${this.field(key).label} cannot be in the future` });
    return iso;
  }
  email(key: string): string | undefined {
    const v = this.raw(key);
    if (!v) return undefined;
    const e = v.normalize("NFKC").toLowerCase();
    if (!EMAIL.test(e) || e.length > 120) { this.errors.push({ field: key, message: `"${v}" is not a valid email address` }); return undefined; }
    return e;
  }
  phone(key: string): string | undefined {
    const v = this.raw(key);
    if (!v) return undefined;
    const digits = v.replace(/\D/g, "");
    if (!/^\+?[\d\s()-]+$/.test(v) || digits.length < 7 || digits.length > 15) { this.errors.push({ field: key, message: `"${v}" is not a valid phone number` }); return undefined; }
    return v.replace(/\s+/g, " ");
  }
  gender(key: string) {
    const v = this.raw(key);
    if (!v) return undefined;
    const g = parseGender(v);
    if (!g) this.errors.push({ field: key, message: `Gender "${v}" must be Male, Female or Other` });
    return g ?? undefined;
  }
  integer(key: string): number | undefined {
    const v = this.raw(key);
    if (!v) return undefined;
    if (!/^\d{1,4}$/.test(v) || Number(v) < 1) { this.errors.push({ field: key, message: `${this.field(key).label} must be a whole number` }); return undefined; }
    return Number(v);
  }
  /** Full name OR first + last name. */
  names(): { firstName: string; lastName: string } | undefined {
    const first = this.text("firstName");
    const last = this.text("lastName");
    if (first && last) return { firstName: first, lastName: last };
    const full = this.text("fullName");
    if (full) {
      const parts = full.split(/\s+/);
      if (parts.length < 2) { this.errors.push({ field: "fullName", message: "Full name needs a first and a last name" }); return undefined; }
      return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
    }
    this.errors.push({ field: first ? "lastName" : "firstName", message: "Name is required (Full name, or First name + Last name)" });
    return undefined;
  }
  loginId(createAccounts: boolean): string | undefined {
    const v = this.raw("loginId");
    if (!v) return undefined;
    if (!createAccounts) { this.warnings.push({ field: "loginId", message: "Login ID ignored — accounts are not being created in this import" }); return undefined; }
    const id = canonicalLoginId(v);
    if (!id) { this.errors.push({ field: "loginId", message: `Login ID "${v}" is invalid (3–40 letters, digits, . _ -)` }); return undefined; }
    return id;
  }
}

function finish(rowNumber: number, label: string, r: RowReader): RowResult {
  return { rowNumber, label, errors: r.errors, warnings: r.warnings, status: r.errors.length ? "invalid" : r.warnings.length ? "warning" : "valid" };
}

function assertRowsShape(rows: ImportRowInput[]) {
  if (rows.length === 0) throw new AppError("INVALID_ARGUMENT", "The file has no data rows.");
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError("INVALID_ARGUMENT", `Import at most ${MAX_IMPORT_ROWS} rows at a time. Split the file and import it in parts.`);
  const seen = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.rowNumber) || r.rowNumber < 1 || seen.has(r.rowNumber)) throw new AppError("INVALID_ARGUMENT", "Each row needs a unique positive row number.");
    seen.add(r.rowNumber);
  }
}

/** Duplicate tracker within one file: key → first row number. */
function dupTracker() {
  const seen = new Map<string, number>();
  return (key: string | undefined, onDup: (firstRow: number) => void, rowNumber: number) => {
    if (!key) return;
    const first = seen.get(key);
    if (first !== undefined) onDup(first);
    else seen.set(key, rowNumber);
  };
}

async function loginIdChecks(ctx: QueryCtx, r: RowReader, loginId: string | undefined, rowNumber: number, track: ReturnType<typeof dupTracker>) {
  if (!loginId) return;
  track(loginId, (first) => r.errors.push({ field: "loginId", message: `Login ID ${loginId} is repeated (first used on row ${first})` }), rowNumber);
  if (await isLoginIdTaken(ctx, loginId)) r.errors.push({ field: "loginId", message: `Login ID ${loginId} is already in use` });
}

// ================================================================ students
export type StudentPlan = {
  rowNumber: number; firstName: string; lastName: string; gender?: "male" | "female" | "other"; dateOfBirth?: string;
  admissionNo?: string; admissionDate: string; classId: Id<"classes">; sectionId: Id<"sections">;
  email?: string; phone?: string; address?: string; loginId?: string;
  /** Parent contact (contact data only; stored in the `guardians` / `guardianLinks` tables). */
  parentContact?: { name: string; phone: string; email?: string; relation: string; existingContactId?: Id<"guardians"> };
};

async function sectionIndex(ctx: Ctx) {
  const yearId = await getCurrentAcademicYearId(ctx, ctx.actor.schoolId);
  const classes = (await ctx.db.query("classes").withIndex("by_school_level", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect()).filter((c) => c.active);
  const sections = await ctx.db.query("sections").withIndex("by_school_year", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("academicYearId", yearId)).collect();
  return { yearId, classes, sections };
}

/** "Class 10", "10", "grade 10", "X"? → class. Matches the class name, or its level number. */
function findClass(classes: Doc<"classes">[], raw: string): Doc<"classes"> | undefined {
  const v = lower(raw);
  const byName = classes.find((c) => lower(c.name) === v);
  if (byName) return byName;
  const num = v.replace(/^(class|grade|std\.?|standard)\s*/, "");
  return /^\d+$/.test(num) ? classes.find((c) => c.level === Number(num)) : undefined;
}

export async function analyzeStudents(ctx: Ctx, rows: ImportRowInput[], opts: { createAccounts: boolean; today: string }) {
  assertRowsShape(rows);
  const spec = IMPORT_SPECS.students;
  const { yearId, classes, sections } = await sectionIndex(ctx);
  const currentYear = (await ctx.db.get(yearId))!;
  const results: RowResult[] = [];
  const plans: StudentPlan[] = [];
  const trackAdmission = dupTracker();
  const trackLogin = dupTracker();
  const newPerSection = new Map<Id<"sections">, number>();
  const rosterSize = new Map<Id<"sections">, number>();

  // Current active roster size (roll numbers themselves are system-assigned after the commit).
  const sectionRosterSize = async (sectionId: Id<"sections">) => {
    let n = rosterSize.get(sectionId);
    if (n === undefined) {
      n = (await ctx.db.query("enrollments").withIndex("by_section_status", (q) => q.eq("sectionId", sectionId).eq("status", "active")).take(MAX_SECTION_ROSTER + 1)).length;
      rosterSize.set(sectionId, n);
    }
    return n;
  };

  for (const row of rows) {
    const r = new RowReader(spec, row.values);
    const names = r.names();
    const label = names ? `${names.firstName} ${names.lastName}` : `Row ${row.rowNumber}`;
    const className = r.text("className", true);
    const sectionName = r.text("section", true);
    const admissionNo = r.text("admissionNo");
    const admissionDate = r.date("admissionDate", { notAfter: opts.today }) ?? opts.today;
    const dateOfBirth = r.date("dateOfBirth", { notAfter: opts.today });
    const gender = r.gender("gender");
    const email = r.email("email");
    const phone = r.phone("phone");
    const address = r.text("address");
    const loginId = r.loginId(opts.createAccounts);

    // Class / section must already exist for the current academic year.
    let cls: Doc<"classes"> | undefined;
    let section: Doc<"sections"> | undefined;
    if (className) {
      cls = findClass(classes, className);
      if (!cls) r.errors.push({ field: "className", message: `Class "${className}" does not exist (set it up in Academics first)` });
    }
    if (cls && sectionName) {
      const s = lower(sectionName);
      section = sections.find((x) => x.classId === cls!._id && (lower(x.name) === s || lower(x.displayName) === s));
      if (!section) r.errors.push({ field: "section", message: `Section "${sectionName}" does not exist in ${cls.name} this academic year` });
    }

    // Academic year (optional column): rows are always enrolled into the CURRENT year, so a
    // different year in the file is an error rather than a silent re-assignment.
    const yearLabel = r.text("academicYear");
    if (yearLabel && !academicYearMatches(yearLabel, currentYear)) {
      r.errors.push({ field: "academicYear", message: `Academic year "${yearLabel}" is not the current academic year (${currentYear.name}); students are enrolled into the current year` });
    }

    // Admission number: unique in file and in the school.
    trackAdmission(admissionNo && lower(admissionNo), (first) => r.errors.push({ field: "admissionNo", message: `Admission number ${admissionNo} is repeated (first used on row ${first})` }), row.rowNumber);
    if (admissionNo) {
      const existing = await ctx.db.query("students").withIndex("by_school_admission", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("admissionNo", admissionNo)).first();
      if (existing) r.errors.push({ field: "admissionNo", message: `Admission number ${admissionNo} already belongs to ${existing.firstName} ${existing.lastName}` });
    }
    await loginIdChecks(ctx, r, loginId, row.rowNumber, trackLogin);

    // Parent contact: optional, but name + phone go together.
    const pName = r.text("parentName");
    const pPhone = r.phone("parentPhone");
    const pEmail = r.email("parentEmail");
    const pRelation = r.text("parentRelation");
    let parentContact: StudentPlan["parentContact"];
    if (pName || r.raw("parentPhone") || pEmail || pRelation) {
      if (!pName) r.errors.push({ field: "parentName", message: "Parent name is required when parent contact details are given" });
      if (!r.raw("parentPhone")) r.errors.push({ field: "parentPhone", message: "Parent phone is required when parent contact details are given" });
      if (pName && pPhone) {
        const existing = await ctx.db.query("guardians").withIndex("by_school_phone", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("phone", pPhone)).first();
        if (existing && lower(existing.name) !== lower(pName)) {
          r.warnings.push({ field: "parentPhone", message: `Phone ${pPhone} belongs to existing parent contact ${existing.name}; the student will be linked to them` });
        }
        parentContact = { name: pName, phone: pPhone, email: pEmail, relation: pRelation ?? "Parent", existingContactId: existing?._id };
      }
    }

    // Possible duplicate person (same name + date of birth).
    if (names && dateOfBirth) {
      const sameName = await ctx.db.query("students").withIndex("by_school_status_name", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("status", "active").eq("lastName", names.lastName)).collect();
      if (sameName.some((s) => lower(s.firstName) === lower(names.firstName) && s.dateOfBirth === dateOfBirth)) {
        r.warnings.push({ field: "fullName", message: `A student named ${label} with the same date of birth already exists` });
      }
    }

    // Roster size / capacity. Roll numbers are NOT read from the file: after the commit the whole
    // section is renumbered alphabetically (model/rollNumbers.ts).
    if (section) {
      const existing = await sectionRosterSize(section._id);
      const count = (newPerSection.get(section._id) ?? 0) + 1;
      newPerSection.set(section._id, count);
      if (existing + count > MAX_SECTION_ROSTER) {
        r.errors.push({ field: "section", message: `${section.displayName} would have more than ${MAX_SECTION_ROSTER} students` });
      } else if (section.capacity && existing + count > section.capacity) {
        r.warnings.push({ field: "section", message: `${section.displayName} will exceed its capacity of ${section.capacity}` });
      }
    }

    const result = finish(row.rowNumber, label, r);
    results.push(result);
    if (result.status !== "invalid" && names && cls && section) {
      plans.push({
        rowNumber: row.rowNumber, ...names, gender, dateOfBirth, admissionNo, admissionDate, classId: cls._id, sectionId: section._id,
        email, phone, address, loginId, parentContact,
      });
    }
  }
  return { results, plans, yearId };
}

export async function commitStudents(ctx: MutationCtx & { actor: Actor }, rows: ImportRowInput[], opts: { createAccounts: boolean; today: string }) {
  const { results, plans, yearId } = await analyzeStudents(ctx, rows, opts);
  const invalid = results.filter((r) => r.status === "invalid");
  if (invalid.length) {
    throw new AppError("INVALID_ARGUMENT", `${invalid.length} row(s) have errors (first: row ${invalid[0].rowNumber}). Nothing was imported.`);
  }
  const school = (await ctx.db.get(ctx.actor.schoolId))!;
  const created: { rowNumber: number; studentId: Id<"students">; name: string; admissionNo: string; membershipId?: Id<"schoolMemberships">; loginId?: string }[] = [];
  const contactIdsByPhone = new Map<string, Id<"guardians">>();
  for (const p of plans) {
    let admissionNo = p.admissionNo;
    if (admissionNo) {
      const m = new RegExp(`^${school.code}-(\\d{4})-(\\d+)$`).exec(admissionNo);
      if (m) await ensureCounterAtLeast(ctx, school._id, counterKeys.admission(m[1]), Number(m[2]));
    } else {
      admissionNo = await nextAdmissionNumber(ctx, school, p.admissionDate.slice(0, 4));
    }
    const studentId = await ctx.db.insert("students", {
      schoolId: school._id, admissionNo, firstName: p.firstName, lastName: p.lastName, status: "active", admissionDate: p.admissionDate,
      ...(p.gender ? { gender: p.gender } : {}), ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}),
      ...(p.email ? { email: p.email } : {}), ...(p.phone ? { phone: p.phone } : {}), ...(p.address ? { address: p.address } : {}),
    });
    await ctx.db.insert("enrollments", {
      schoolId: school._id, studentId, academicYearId: yearId, classId: p.classId, sectionId: p.sectionId, status: "active", startDate: p.admissionDate,
    });
    if (p.parentContact) {
      let contactId = p.parentContact.existingContactId ?? contactIdsByPhone.get(p.parentContact.phone);
      if (!contactId) {
        contactId = await ctx.db.insert("guardians", { schoolId: school._id, name: p.parentContact.name, phone: p.parentContact.phone, ...(p.parentContact.email ? { email: p.parentContact.email } : {}) });
      }
      contactIdsByPhone.set(p.parentContact.phone, contactId);
      await ctx.db.insert("guardianLinks", { schoolId: school._id, guardianId: contactId, studentId, relationship: p.parentContact.relation, isPrimary: true });
    }
    const name = `${p.firstName} ${p.lastName}`;
    let account: { membershipId: Id<"schoolMemberships">; loginId: string } | undefined;
    if (opts.createAccounts) {
      account = await reserveAccount(ctx, {
        schoolId: school._id, role: "student", kind: "student", year: p.admissionDate.slice(0, 4), displayName: name,
        loginId: p.loginId, email: p.email, studentId, createdByUserId: ctx.actor.userId,
      });
    }
    created.push({ rowNumber: p.rowNumber, studentId, name, admissionNo, ...(account ?? {}) });
  }
  // Same transaction: the whole roster of every affected section (existing + imported students)
  // is renumbered alphabetically; if anything above failed nothing — including numbers — changed.
  await renumberSections(ctx, plans.map((p) => p.sectionId));
  await writeAudit(ctx, {
    schoolId: school._id, actor: ctx.actor, action: "import.students",
    entity: { table: "schools", id: school._id },
    summary: `Imported ${created.length} student(s)${opts.createAccounts ? " with accounts" : ""}`,
    metadata: { rows: created.length, createAccounts: opts.createAccounts },
  });
  return { created, warnings: results.filter((r) => r.status === "warning").length };
}

// ================================================================ teachers
export type TeacherPlan = {
  rowNumber: number; firstName: string; lastName: string; title?: string; employeeId?: string; gender?: "male" | "female" | "other";
  email?: string; phone?: string; designation?: string; qualification?: string; subjectIds: Id<"subjects">[]; joiningDate?: string;
  address?: string; loginId?: string;
};

export async function analyzeTeachers(ctx: Ctx, rows: ImportRowInput[], opts: { createAccounts: boolean; today: string }) {
  assertRowsShape(rows);
  const spec = IMPORT_SPECS.teachers;
  const subjects = (await ctx.db.query("subjects").withIndex("by_school_code", (q) => q.eq("schoolId", ctx.actor.schoolId)).collect()).filter((s) => s.active);
  const results: RowResult[] = [];
  const plans: TeacherPlan[] = [];
  const trackEmp = dupTracker();
  const trackLogin = dupTracker();
  const trackEmail = dupTracker();

  for (const row of rows) {
    const r = new RowReader(spec, row.values);
    const names = r.names();
    const label = names ? `${names.firstName} ${names.lastName}` : `Row ${row.rowNumber}`;
    const employeeId = r.text("employeeId");
    const email = r.email("email");
    const loginId = r.loginId(opts.createAccounts);
    const subjectIds: Id<"subjects">[] = [];
    for (const token of r.raw("subjects").split(/[,;|]/).map((t) => t.trim()).filter(Boolean)) {
      const s = subjects.find((x) => lower(x.code) === lower(token) || lower(x.name) === lower(token));
      if (!s) r.errors.push({ field: "subjects", message: `Subject "${token}" does not exist (set it up in Academics first)` });
      else if (!subjectIds.includes(s._id)) subjectIds.push(s._id);
    }
    trackEmp(employeeId && lower(employeeId), (first) => r.errors.push({ field: "employeeId", message: `Employee ID ${employeeId} is repeated (first used on row ${first})` }), row.rowNumber);
    if (employeeId) {
      const existing = await ctx.db.query("teachers").withIndex("by_school_employee", (q) => q.eq("schoolId", ctx.actor.schoolId).eq("employeeId", employeeId)).first();
      if (existing) r.errors.push({ field: "employeeId", message: `Employee ID ${employeeId} already belongs to ${existing.firstName} ${existing.lastName}` });
    }
    trackEmail(email, (first) => r.warnings.push({ field: "email", message: `Email ${email} is also used on row ${first}` }), row.rowNumber);
    await loginIdChecks(ctx, r, loginId, row.rowNumber, trackLogin);
    const plan: Omit<TeacherPlan, "rowNumber" | "firstName" | "lastName"> = {
      title: r.text("title"), employeeId, gender: r.gender("gender"), email, phone: r.phone("phone"),
      designation: r.text("designation"), qualification: r.text("qualification"), subjectIds,
      joiningDate: r.date("joiningDate"), address: r.text("address"), loginId,
    };
    const result = finish(row.rowNumber, label, r);
    results.push(result);
    if (result.status !== "invalid" && names) plans.push({ rowNumber: row.rowNumber, ...names, ...plan });
  }
  return { results, plans };
}

export async function commitTeachers(ctx: MutationCtx & { actor: Actor }, rows: ImportRowInput[], opts: { createAccounts: boolean; today: string }) {
  const { results, plans } = await analyzeTeachers(ctx, rows, opts);
  const invalid = results.filter((r) => r.status === "invalid");
  if (invalid.length) {
    throw new AppError("INVALID_ARGUMENT", `${invalid.length} row(s) have errors (first: row ${invalid[0].rowNumber}). Nothing was imported.`);
  }
  const school = (await ctx.db.get(ctx.actor.schoolId))!;
  const created: { rowNumber: number; teacherId: Id<"teachers">; name: string; employeeId: string; membershipId?: Id<"schoolMemberships">; loginId?: string }[] = [];
  for (const p of plans) {
    let employeeId = p.employeeId;
    if (employeeId) {
      const m = new RegExp(`^${school.code}-EMP-(\\d+)$`).exec(employeeId);
      if (m) await ensureCounterAtLeast(ctx, school._id, counterKeys.employee(), Number(m[1]));
    } else {
      employeeId = await nextEmployeeId(ctx, school);
    }
    const teacherId = await ctx.db.insert("teachers", {
      schoolId: school._id, employeeId, firstName: p.firstName, lastName: p.lastName, status: "active", specializationSubjectIds: p.subjectIds,
      ...(p.title ? { title: p.title } : {}), ...(p.gender ? { gender: p.gender } : {}), ...(p.email ? { email: p.email } : {}),
      ...(p.phone ? { phone: p.phone } : {}), ...(p.designation ? { designation: p.designation } : {}),
      ...(p.qualification ? { qualification: p.qualification } : {}), ...(p.joiningDate ? { joiningDate: p.joiningDate } : {}),
      ...(p.address ? { address: p.address } : {}),
    });
    const name = `${p.firstName} ${p.lastName}`;
    let account: { membershipId: Id<"schoolMemberships">; loginId: string } | undefined;
    if (opts.createAccounts) {
      account = await reserveAccount(ctx, {
        schoolId: school._id, role: "teacher", kind: "teacher", displayName: name, loginId: p.loginId, email: p.email, teacherId, createdByUserId: ctx.actor.userId,
      });
    }
    created.push({ rowNumber: p.rowNumber, teacherId, name, employeeId, ...(account ?? {}) });
  }
  await writeAudit(ctx, {
    schoolId: school._id, actor: ctx.actor, action: "import.teachers",
    entity: { table: "schools", id: school._id },
    summary: `Imported ${created.length} teacher(s)${opts.createAccounts ? " with accounts" : ""}`,
    metadata: { rows: created.length, createAccounts: opts.createAccounts },
  });
  return { created, warnings: results.filter((r) => r.status === "warning").length };
}

export function summarize(results: RowResult[]) {
  return {
    total: results.length,
    valid: results.filter((r) => r.status === "valid").length,
    warnings: results.filter((r) => r.status === "warning").length,
    invalid: results.filter((r) => r.status === "invalid").length,
    duplicates: results.filter((r) => r.errors.some((e) => /repeated|already (belongs|in use|used)/.test(e.message))).length,
  };
}

export type { ImportTarget };

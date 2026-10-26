/**
 * Data import specifications — shared by the browser (templates, column
 * mapping, preview) and the server (authoritative validation + commit).
 * Dependency-free on purpose.
 *
 * Adding an import target = add a spec here + an analyzer/committer in
 * convex/model/importers.ts + two functions in convex/imports.ts. The upload,
 * mapping, preview and report UI is generic over these specs.
 */

export type ImportTarget = "students" | "teachers";

export type ImportFieldKind = "text" | "name" | "date" | "email" | "phone" | "gender" | "integer" | "list" | "loginId";

export interface ImportFieldSpec {
  key: string;
  label: string;
  kind: ImportFieldKind;
  /** Always required. (Name fields use a "full name OR first + last name" rule instead.) */
  required?: boolean;
  /** Spreadsheet headings that map to this field automatically (compared normalised). */
  aliases: string[];
  example: string;
  help?: string;
  max?: number;
}

export interface ImportSpec {
  target: ImportTarget;
  label: string;
  /** Singular noun for messages ("student"). */
  noun: string;
  fields: ImportFieldSpec[];
  /** Headings that are recognised but deliberately not imported (shown to the user with the reason). */
  notImported?: { aliases: string[]; reason: string }[];
}

/** Rows per import (one transaction). Larger files: split them. */
export const MAX_IMPORT_ROWS = 300;

const nameFields: ImportFieldSpec[] = [
  { key: "fullName", label: "Full name", kind: "name", aliases: ["name", "full name", "student name", "student full name", "teacher name", "staff name"], example: "Ishita Menon", help: "Use either Full name, or First name + Last name.", max: 120 },
  { key: "firstName", label: "First name", kind: "name", aliases: ["first name", "given name", "fname", "student first name"], example: "Ishita", max: 60 },
  { key: "lastName", label: "Last name", kind: "name", aliases: ["last name", "surname", "family name", "lname", "student last name"], example: "Menon", max: 60 },
];

export const STUDENT_IMPORT: ImportSpec = {
  target: "students",
  label: "Students",
  noun: "student",
  fields: [
    ...nameFields,
    { key: "className", label: "Class", kind: "text", required: true, aliases: ["class", "grade", "standard", "std", "class name", "class label"], example: "Class 10", help: "Class name or number as set up in Academics (e.g. Class 10 or 10).", max: 40 },
    { key: "section", label: "Section", kind: "text", required: true, aliases: ["section", "sec", "division", "div", "section name", "section label"], example: "A", max: 20 },
    { key: "academicYear", label: "Academic year", kind: "text", aliases: ["academic year", "session", "academic session"], example: "", help: "Optional. If given it must be the current academic year — students are always enrolled into the current year.", max: 20 },
    { key: "admissionNo", label: "Admission number", kind: "text", aliases: ["admission no", "admission number", "adm no", "admn no", "admission id"], example: "", help: "Leave empty to generate one.", max: 40 },
    { key: "admissionDate", label: "Admission date", kind: "date", aliases: ["admission date", "date of admission", "doa"], example: "2026-06-01" },
    { key: "gender", label: "Gender", kind: "gender", aliases: ["gender", "sex"], example: "Female", help: "Male, Female or Other (M/F accepted)." },
    { key: "dateOfBirth", label: "Date of birth", kind: "date", aliases: ["date of birth", "dob", "birth date"], example: "2011-05-14", help: "YYYY-MM-DD or DD/MM/YYYY." },
    { key: "email", label: "Email", kind: "email", aliases: ["email", "email address", "student email"], example: "", max: 120 },
    { key: "phone", label: "Phone", kind: "phone", aliases: ["phone", "mobile", "student phone", "student mobile"], example: "" },
    { key: "address", label: "Address", kind: "text", aliases: ["address", "home address", "residential address"], example: "12, 4th Main, Jayanagar, Bengaluru", max: 300 },
    // Parent contact (contact data only — never an account). Older spreadsheets that still use
    // "guardian …" headings are matched by the aliases so existing files keep importing.
    { key: "parentName", label: "Parent name", kind: "name", aliases: ["parent name", "parent", "father name", "mother name", "guardian name", "guardian"], example: "Kavita Menon", max: 120 },
    { key: "parentPhone", label: "Parent phone", kind: "phone", aliases: ["parent phone", "parent mobile", "contact number", "guardian phone", "guardian mobile"], example: "98450 77777" },
    { key: "parentRelation", label: "Parent relation", kind: "text", aliases: ["relation", "relationship", "relationship to student", "parent relation", "guardian relation", "guardian relationship"], example: "Mother", max: 40 },
    { key: "parentEmail", label: "Parent email", kind: "email", aliases: ["parent email", "guardian email"], example: "", max: 120 },
    { key: "loginId", label: "Login ID", kind: "loginId", aliases: ["login id", "username", "user id"], example: "", help: "Only used when creating accounts. Leave empty to generate one." },
  ],
  notImported: [
    { aliases: ["roll no", "roll number", "roll", "roll num"], reason: "System-assigned: roll numbers are assigned automatically based on the complete class roster, so this column is ignored." },
    { aliases: ["status", "student status"], reason: "Not imported: imported students are always created as active." },
    { aliases: ["blood group"], reason: "Not imported: blood group is not part of the student import yet." },
    { aliases: ["parent occupation", "guardian occupation", "occupation"], reason: "Not imported: parent occupation is not part of the student import yet." },
    { aliases: ["parent address", "guardian address"], reason: "Not imported: parent address is not part of the student import yet." },
  ],
};

export const TEACHER_IMPORT: ImportSpec = {
  target: "teachers",
  label: "Teachers & staff",
  noun: "teacher",
  fields: [
    ...nameFields,
    { key: "title", label: "Title", kind: "text", aliases: ["title", "salutation", "prefix"], example: "Ms.", max: 10 },
    { key: "employeeId", label: "Employee ID", kind: "text", aliases: ["employee id", "emp id", "staff id", "employee no", "employee number"], example: "", help: "Leave empty to generate one.", max: 40 },
    { key: "gender", label: "Gender", kind: "gender", aliases: ["gender", "sex"], example: "Female" },
    { key: "email", label: "Email", kind: "email", aliases: ["email", "email address", "official email"], example: "", max: 120 },
    { key: "phone", label: "Phone", kind: "phone", aliases: ["phone", "mobile", "contact number"], example: "98450 11111" },
    { key: "designation", label: "Designation", kind: "text", aliases: ["designation", "role", "position", "post"], example: "Teacher (TGT)", max: 80 },
    { key: "qualification", label: "Qualification", kind: "text", aliases: ["qualification", "qualifications", "degree"], example: "M.Sc., B.Ed.", max: 120 },
    { key: "subjects", label: "Subjects", kind: "list", aliases: ["subjects", "subject", "subject codes", "specialization", "specialisation"], example: "MATH, SCI", help: "Subject codes or names separated by commas, as set up in Academics." },
    { key: "joiningDate", label: "Joining date", kind: "date", aliases: ["joining date", "date of joining", "doj", "join date"], example: "2026-06-01" },
    { key: "address", label: "Address", kind: "text", aliases: ["address"], example: "", max: 300 },
    { key: "loginId", label: "Login ID", kind: "loginId", aliases: ["login id", "loginid", "username", "user id", "userid"], example: "", help: "Only used when creating accounts. Leave empty to generate one." },
  ],
};

export const IMPORT_SPECS: Record<ImportTarget, ImportSpec> = { students: STUDENT_IMPORT, teachers: TEACHER_IMPORT };

/**
 * Canonical spelling of a column heading: camelCase split into words,
 * underscores/punctuation as spaces, lower case, single spaces.
 *   "admissionNo" | "admission_no" | "Admission No." → "admission no"
 *   "dateOfBirth" | "Date of Birth"                   → "date of birth"
 */
export function normalizeHeading(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // "DOBDate" → "DOB Date"
    .toLowerCase()
    .replace(/[._#:()\-/\\\s]+/g, " ")
    .trim();
}

/** Comparison key: the normalised heading without spaces ("admission no" → "admissionno"). Exact match only — no fuzzy matching. */
export function headingKey(value: string): string {
  return normalizeHeading(value).replace(/ /g, "");
}

export type ColumnMatch = {
  index: number;
  heading: string;
  field: string | null;
  status: "mapped" | "ambiguous" | "duplicate" | "not_imported" | "unrecognized" | "empty";
  note?: string;
};

/**
 * Suggested mapping (field key → column index or null) plus an explanation for
 * every column. Only exact matches of the normalised heading against a field's
 * label, key or aliases are used. Anything ambiguous is left unmapped:
 *  - a heading that matches two fields, or
 *  - two columns that both match the same field.
 */
export function matchColumns(headings: string[], spec: ImportSpec): { mapping: Record<string, number | null>; columns: ColumnMatch[] } {
  const fieldsByKey = new Map<string, string[]>();
  for (const f of spec.fields) {
    for (const c of new Set([f.label, f.key, ...f.aliases].map(headingKey))) {
      fieldsByKey.set(c, [...(fieldsByKey.get(c) ?? []), f.key]);
    }
  }
  const notImported = new Map<string, string>();
  for (const n of spec.notImported ?? []) for (const a of n.aliases) notImported.set(headingKey(a), n.reason);

  const columns: ColumnMatch[] = headings.map((heading, index) => {
    const k = headingKey(heading ?? "");
    if (!k) return { index, heading, field: null, status: "empty" as const };
    const fields = fieldsByKey.get(k) ?? [];
    if (fields.length > 1) {
      return { index, heading, field: null, status: "ambiguous" as const, note: `Could be ${fields.map((f) => labelOf(spec, f)).join(" or ")} — choose manually.` };
    }
    if (fields.length === 1) return { index, heading, field: fields[0], status: "mapped" as const };
    const reason = notImported.get(k);
    if (reason) return { index, heading, field: null, status: "not_imported" as const, note: reason };
    return { index, heading, field: null, status: "unrecognized" as const, note: "Not a known column — map it manually if it holds one of the fields." };
  });

  const mapping: Record<string, number | null> = {};
  for (const f of spec.fields) {
    const hits = columns.filter((c) => c.status === "mapped" && c.field === f.key);
    if (hits.length === 1) mapping[f.key] = hits[0].index;
    else {
      mapping[f.key] = null;
      if (hits.length > 1) {
        for (const h of hits) {
          h.status = "duplicate";
          h.note = `${hits.length} columns look like ${f.label} (${hits.map((x) => `"${x.heading}"`).join(", ")}) — choose one manually.`;
          h.field = null;
        }
      }
    }
  }
  return { mapping, columns };
}

/** Field key → column index (or null). See matchColumns for the rules and explanations. */
export function autoMapColumns(headings: string[], spec: ImportSpec): Record<string, number | null> {
  return matchColumns(headings, spec).mapping;
}

/**
 * Which worksheet to import: the one whose heading row matches the most fields
 * (workbooks often begin with a "Read Me" sheet). Sheets without data rows
 * lose; ties keep the earlier sheet.
 */
export function bestSheetIndex(sheets: { headings: string[]; rowCount: number }[], spec: ImportSpec): number {
  let best = 0, bestScore = -1;
  sheets.forEach((sh, i) => {
    const score = sh.rowCount === 0 ? -1 : Object.values(matchColumns(sh.headings, spec).mapping).filter((v) => v !== null).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

/** Labels of required fields that are not mapped (incl. the "full name OR first + last name" rule). */
export function missingRequiredFields(mapping: Record<string, number | null>, spec: ImportSpec): string[] {
  const has = (k: string) => mapping[k] !== null && mapping[k] !== undefined;
  const missing = spec.fields.filter((f) => f.required && !has(f.key)).map((f) => f.label);
  if (spec.fields.some((f) => f.key === "fullName") && !has("fullName") && !(has("firstName") && has("lastName"))) {
    missing.unshift("Full name (or First name + Last name)");
  }
  return missing;
}

function labelOf(spec: ImportSpec, key: string) {
  return spec.fields.find((f) => f.key === key)?.label ?? key;
}

/**
 * Parse a date typed in a spreadsheet: YYYY-MM-DD, or day-first DD/MM/YYYY,
 * DD-MM-YYYY, DD.MM.YYYY. Returns ISO YYYY-MM-DD or null if not a real date.
 */
export function parseDateInput(raw: string): string | null {
  const value = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) { y = +match[1]; m = +match[2]; d = +match[3]; }
  else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
    if (!match) return null;
    d = +match[1]; m = +match[2]; y = +match[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Does a spreadsheet's academic-year label ("2026-27", "2026–2027", "2026")
 * refer to the given academic year? Compares the start year (and the end year
 * when one is written). Exact, no guessing.
 */
export function academicYearMatches(raw: string, year: { name: string; startDate: string; endDate: string }): boolean {
  const norm = (x: string) => x.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, "").toLowerCase();
  if (norm(raw) === norm(year.name)) return true;
  const m = /^(\d{4})(?:[-/](\d{2}|\d{4}))?$/.exec(norm(raw));
  if (!m) return false;
  const start = year.startDate.slice(0, 4), end = year.endDate.slice(0, 4);
  if (m[1] !== start) return false;
  return !m[2] || m[2] === end || m[2] === end.slice(2);
}

/** "M", "male", "Boy" → "male" etc. */
export function parseGender(raw: string): "male" | "female" | "other" | null {
  const v = raw.trim().toLowerCase();
  if (["m", "male", "boy"].includes(v)) return "male";
  if (["f", "female", "girl"].includes(v)) return "female";
  if (["o", "other", "others"].includes(v)) return "other";
  return null;
}

/** Template CSV (header row + one example row) for a spec. */
export function templateRows(spec: ImportSpec): string[][] {
  const fields = spec.fields.filter((f) => f.key !== "fullName");
  return [fields.map((f) => f.label), fields.map((f) => f.example)];
}

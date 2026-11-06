/**
 * Audit viewer helpers (pure): filters, labels, colours, relative time and the
 * before/after diff shown in the details drawer. Shared by the live viewer
 * (Convex audit.getAuditLogs) and the internal demo.
 */
import type { AuditRow } from "@convex/audit";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABELS, type AuditCategory, type AuditOutcome } from "@convex/core/auditCategories";
import type { Tone } from "@/components/ui/badge";

/** A row as the viewer shows it (ids are plain strings so demo rows fit too). */
export type AuditEntry = Omit<AuditRow, "_id"> & { _id: string };

export type AuditActorRoleFilter = "" | "admin" | "teacher" | "student" | "system";
export type AuditFilterState = { search: string; category: AuditCategory | ""; actorRole: AuditActorRoleFilter; from: string; to: string };
export const EMPTY_AUDIT_FILTERS: AuditFilterState = { search: "", category: "", actorRole: "", from: "", to: "" };

export const hasActiveFilters = (f: AuditFilterState) => Object.values(f).some((x) => x !== "");

export const CATEGORY_OPTIONS = AUDIT_CATEGORIES.map((c) => ({ value: c, label: AUDIT_CATEGORY_LABELS[c] }));
export const ROLE_OPTIONS: { value: Exclude<AuditActorRoleFilter, "">; label: string }[] = [
  { value: "admin", label: "Administrators & office" },
  { value: "teacher", label: "Teachers" },
  { value: "student", label: "Students" },
  { value: "system", label: "System" },
];

export const CATEGORY_TONE: Record<AuditCategory, Tone> = {
  AUTHENTICATION: "plum",
  ACADEMICS: "sapphire",
  FEES: "teal",
  STUDENTS: "lavender",
  STAFF: "blush",
  SETTINGS: "neutral",
};

export const OUTCOME: Record<AuditOutcome, { label: string; tone: Tone }> = {
  success: { label: "Success", tone: "teal" },
  failed: { label: "Failed", tone: "blush" },
  blocked: { label: "Blocked", tone: "plum" },
};

/** Local calendar dates (YYYY-MM-DD) → the inclusive epoch-ms range the server filters on. */
export function dateRangeMs(from: string, to: string): { startDate?: number; endDate?: number } {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : undefined;
  return { ...(start !== undefined && !Number.isNaN(start) ? { startDate: start } : {}), ...(end !== undefined && !Number.isNaN(end) ? { endDate: end } : {}) };
}

/** The server filter arguments for the UI state (empty values omitted). */
export function serverFilters(f: AuditFilterState) {
  const search = f.search.trim();
  return {
    ...(f.category ? { category: f.category } : {}),
    ...(f.actorRole ? { actorRole: f.actorRole } : {}),
    ...(search ? { search } : {}),
    ...dateRangeMs(f.from, f.to),
  };
}

/**
 * "fees.payment_recorded" → "Payment recorded"; "student.updated" → "Student updated"
 * (a one-word verb keeps its subject); "PASSWORD_OVERWRITE" → "Password overwrite".
 */
export function actionLabel(action: string): string {
  const dot = action.indexOf(".");
  const verb = dot >= 0 ? action.slice(dot + 1) : action;
  const phrase = dot >= 0 && !/[._]/.test(verb) ? `${action.slice(0, dot)} ${verb}` : verb;
  const words = phrase.replace(/[._]+/g, " ").trim().toLowerCase().replace(/\b(otp|tc|csv|id)\b/g, (w) => w.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "schoolMemberships" → "School membership". */
export function entityLabel(table: string): string {
  const s = table.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  const one = s.endsWith("ies") ? `${s.slice(0, -3)}y` : s.endsWith("s") ? s.slice(0, -1) : s;
  return one.charAt(0).toUpperCase() + one.slice(1);
}

/** "3 min ago", "2 h ago", "4 d ago", then a short date. */
export function relativeFrom(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86_400 * 7) return `${Math.round(s / 86_400)} d ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(at);
}

export const utcStamp = (at: number) => `${new Date(at).toISOString().replace("T", " ").slice(0, 19)} UTC`;
export const localStamp = (at: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(at);

export type DiffLine = { field: string; before: unknown; after: unknown; changed: boolean };

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Before/after pairs recorded in metadata, as `{ before, after }` or
 * `{ from, to }` (both are used by writers). Null when the entry has none.
 */
export function diffOf(metadata: Record<string, unknown> | null): DiffLine[] | null {
  if (!metadata) return null;
  const pair = isPlainObject(metadata.before) || isPlainObject(metadata.after)
    ? [metadata.before, metadata.after]
    : isPlainObject(metadata.from) || isPlainObject(metadata.to) ? [metadata.from, metadata.to] : null;
  if (!pair) return null;
  const before = isPlainObject(pair[0]) ? pair[0] : {};
  const after = isPlainObject(pair[1]) ? pair[1] : {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields.map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null, changed: JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null) }));
}

/** Metadata without the before/after pair (shown as "Other details"). */
export function otherDetails(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  const rest = Object.fromEntries(Object.entries(metadata).filter(([k]) => !["before", "after", "from", "to"].includes(k)));
  return Object.keys(rest).length ? rest : null;
}

export const showValue = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));

/** Save CSV text (already UTF-8 with BOM from the server) as a file. */
export function saveCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  // Revoke later: an immediate revoke can produce an empty download in some browsers.
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

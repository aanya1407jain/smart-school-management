/**
 * Per-member ACCESS GRANTS — the Principal's module × action controls.
 *
 * Pure TypeScript shared by the Convex backend (enforcement) and the frontend
 * (the Staff & Permissions page). No database access here.
 *
 * How grants are enforced: every grantable cell (module × action) maps onto
 * the EXISTING permission strings that the server functions already check
 * (core/permissions.ts). A grant therefore never bypasses a function's own
 * checks — it only adds permissions to the member's effective set, which
 * `requirePermission` / `requireStudentAccess` / … then test as before. The
 * module entitlement (core/modules.ts) is still checked by `moduleQuery` /
 * `moduleMutation`: a grant in a module the school does not have does nothing.
 *
 * Cells that share one server control are LINKED (granted together or not at
 * all), and cells with no server control yet are UNAVAILABLE — shown in the UI
 * with the reason, never silently granted. Things only the Principal (a full
 * administrator) may do are never grantable: accounts & permissions, school
 * settings, the audit log, staff records & leave decisions, and marking
 * attendance (class teacher only).
 *
 * Roles stay admin | teacher | student. Grants apply to:
 *   - admin memberships → a RESTRICTED office login: OFFICE_BASE + its grants
 *     (a full administrator is an admin membership with NO grants);
 *   - teacher memberships → normal teacher access + its grants (e.g. an exam
 *     coordinator). Optional section limits apply to Students/Attendance view;
 *   - student memberships → never.
 */
import { MODULE_KEYS, type ModuleKey } from "./modules";
import type { Permission } from "./permissions";

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", export: "Export",
};

export type Grant = { module: ModuleKey; actions: Action[] };

export type Cell =
  | {
      kind: "grantable";
      /** Permissions this cell adds (school-wide). */
      permissions: readonly Permission[];
      /** Permissions it adds instead when the member has section limits (teachers only). Absent = cannot be section-limited. */
      sectionScoped?: readonly Permission[];
      /** Cells with the same `link` in a module share one server control and are granted together. */
      link?: string;
      /** What the cell lets the person do, in plain words. */
      description: string;
    }
  | { kind: "unavailable"; reason: string };

const NO_EXPORT = "No separate export control yet: anyone who can view a list can download it.";

export const CAPABILITIES: Record<ModuleKey, Record<Action, Cell>> = {
  students: {
    view: { kind: "grantable", permissions: ["students:read:all"], sectionScoped: ["students:read:assigned"], description: "See student records and profiles" },
    create: { kind: "grantable", permissions: ["students:write", "files:upload"], link: "write", description: "Admit and enrol students, import student lists" },
    edit: { kind: "grantable", permissions: ["students:write", "files:upload"], link: "write", description: "Edit student details, scholar numbers and enrolments" },
    delete: { kind: "unavailable", reason: "Student records are never deleted. Use a transfer certificate or pass-out instead." },
    approve: { kind: "grantable", permissions: ["students:lifecycle"], description: "Promote classes, issue transfer certificates, pass students out" },
    export: { kind: "unavailable", reason: NO_EXPORT },
  },
  academics: {
    view: { kind: "grantable", permissions: ["homework:read:all"], description: "See homework across the school" },
    create: { kind: "grantable", permissions: ["academics:manage", "exams:manage", "timetable:manage", "marks:enter:any", "files:upload"], link: "manage", description: "Set up classes, subjects, exams and the timetable; enter any marks" },
    edit: { kind: "grantable", permissions: ["academics:manage", "exams:manage", "timetable:manage", "marks:enter:any", "files:upload"], link: "manage", description: "Change classes, subjects, exams, the timetable and marks" },
    delete: { kind: "grantable", permissions: ["academics:manage", "exams:manage", "timetable:manage", "marks:enter:any", "files:upload"], link: "manage", description: "Remove exam papers, periods and timetable entries" },
    approve: { kind: "grantable", permissions: ["exams:publish"], description: "Publish exam results" },
    export: { kind: "unavailable", reason: NO_EXPORT },
  },
  attendance: {
    view: { kind: "grantable", permissions: ["attendance:read:all"], sectionScoped: ["attendance:read:assigned"], description: "See attendance registers and histories" },
    create: { kind: "unavailable", reason: "Only the class teacher marks a section's attendance — no one else can be given this." },
    edit: { kind: "unavailable", reason: "Only the class teacher corrects a section's attendance — no one else can be given this." },
    delete: { kind: "unavailable", reason: "Attendance is never deleted." },
    approve: { kind: "unavailable", reason: "Staff leave is decided by the Principal (Teachers & Staff)." },
    export: { kind: "unavailable", reason: NO_EXPORT },
  },
  finance: {
    view: { kind: "grantable", permissions: ["fees:manage", "reports:finance", "files:upload"], link: "fees", description: "See fee structures, ledgers, payments and finance reports" },
    create: { kind: "grantable", permissions: ["fees:manage", "reports:finance", "files:upload"], link: "fees", description: "Assign fees, add concessions, record payments" },
    edit: { kind: "grantable", permissions: ["fees:manage", "reports:finance", "files:upload"], link: "fees", description: "Change fee structures" },
    delete: { kind: "grantable", permissions: ["fees:manage", "reports:finance", "files:upload"], link: "fees", description: "Reverse payments, cancel fee assignments, revoke concessions" },
    approve: { kind: "unavailable", reason: "There is no finance approval step yet." },
    export: { kind: "unavailable", reason: NO_EXPORT },
  },
  administration: {
    view: { kind: "grantable", permissions: ["reports:read"], description: "See the school reports" },
    create: { kind: "grantable", permissions: ["notices:manage", "files:upload"], link: "notices", description: "Write notices and events" },
    edit: { kind: "grantable", permissions: ["notices:manage", "files:upload"], link: "notices", description: "Edit, publish and archive notices and events" },
    delete: { kind: "grantable", permissions: ["notices:manage", "files:upload"], link: "notices", description: "Remove events and archive notices" },
    approve: { kind: "unavailable", reason: "Publishing a notice is part of Create & edit." },
    export: { kind: "unavailable", reason: NO_EXPORT },
  },
};

/** Text shown for a link group (cells that are one server control). */
export const LINK_NOTES: Record<string, string> = {
  write: "Create and Edit are one server control for student records: they are granted together.",
  manage: "Create, Edit and Delete are one server control for academics: they are granted together.",
  fees: "Finance has one server control today: viewing, collecting and correcting fees are granted together.",
  notices: "Create, Edit and Delete are one server control for notices and events: they are granted together.",
};

/** What only a full administrator (the Principal) can do; never grantable. */
export const PRINCIPAL_ONLY: readonly { label: string; permissions: readonly Permission[] }[] = [
  { label: "Accounts, staff access and permissions", permissions: ["users:manage"] },
  { label: "School profile and settings", permissions: ["settings:manage"] },
  { label: "Audit log", permissions: ["audit:read"] },
  { label: "Teacher records and staff leave", permissions: ["staff:manage"] },
];

/** A restricted office login (admin membership with grants) always has these, and nothing else beyond its grants. */
export const OFFICE_BASE: readonly Permission[] = ["area:admin", "notifications:read", "profile:read:own", "notices:read"];

/** Ready-made starting points for the Principal (they only pre-fill the matrix). */
export const GRANT_PRESETS: { key: string; label: string; grants: Grant[] }[] = [
  { key: "accountant", label: "Accountant", grants: [{ module: "finance", actions: ["view", "create", "edit", "delete"] }, { module: "students", actions: ["view"] }] },
  { key: "admission_officer", label: "Admission officer", grants: [{ module: "students", actions: ["view", "create", "edit"] }] },
  { key: "exam_coordinator", label: "Exam coordinator", grants: [{ module: "academics", actions: ["view", "create", "edit", "delete", "approve"] }, { module: "students", actions: ["view"] }] },
  { key: "office_viewer", label: "Office (view only)", grants: [{ module: "students", actions: ["view"] }, { module: "attendance", actions: ["view"] }, { module: "administration", actions: ["view"] }] },
];

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/** Sort and de-duplicate; drop empty modules. Does not validate. */
export function normalizeGrants(grants: readonly { module: string; actions: readonly string[] }[]): Grant[] {
  const out: Grant[] = [];
  for (const key of MODULE_KEYS) {
    const actions = new Set<Action>();
    for (const g of grants) if (g.module === key) for (const a of g.actions) if (isAction(a)) actions.add(a);
    if (actions.size) out.push({ module: key, actions: ACTIONS.filter((a) => actions.has(a)) });
  }
  return out;
}

/**
 * Problems with a requested grant set (empty = valid). Fail-closed checks:
 * unknown module/action, unavailable cell, partially granted link group,
 * grants on a student, section limits on a non-teacher or without a
 * section-limitable view.
 */
export function grantProblems(role: string, grants: readonly { module: string; actions: readonly string[] }[], hasSectionLimits: boolean): string[] {
  const problems: string[] = [];
  if (role === "student") {
    if (grants.length || hasSectionLimits) problems.push("Student accounts cannot be given staff permissions.");
    return problems;
  }
  for (const g of grants) {
    if (!(MODULE_KEYS as readonly string[]).includes(g.module)) { problems.push(`Unknown module "${g.module}".`); continue; }
    for (const a of g.actions) if (!isAction(a)) problems.push(`Unknown action "${a}".`);
  }
  const normalized = normalizeGrants(grants);
  for (const g of normalized) {
    const caps = CAPABILITIES[g.module];
    for (const a of g.actions) {
      const cell = caps[a];
      if (cell.kind === "unavailable") problems.push(`${ACTION_LABELS[a]} in ${labelOf(g.module)} cannot be granted: ${cell.reason}`);
    }
    const links = new Set(g.actions.map((a) => caps[a]).flatMap((c) => (c.kind === "grantable" && c.link ? [c.link] : [])));
    for (const link of links) {
      const members = ACTIONS.filter((a) => { const c = caps[a]; return c.kind === "grantable" && c.link === link; });
      if (!members.every((a) => g.actions.includes(a))) problems.push(`${labelOf(g.module)}: ${members.map((a) => ACTION_LABELS[a]).join(", ")} must be granted together. ${LINK_NOTES[link] ?? ""}`.trim());
    }
  }
  if (hasSectionLimits) {
    if (role !== "teacher") problems.push("Section limits apply to teacher logins only; office logins are school-wide within their granted modules.");
    const scopable = normalized.some((g) => g.actions.some((a) => { const c = CAPABILITIES[g.module][a]; return c.kind === "grantable" && !!c.sectionScoped; }));
    if (!scopable) problems.push("Section limits need Students or Attendance view to be granted.");
  }
  return problems;
}

/**
 * The permissions a grant set adds. With `sectionLimited`, section-limitable
 * cells add their section-scoped permissions instead of the school-wide ones.
 * Unknown or unavailable cells add nothing (fail-closed on malformed data).
 */
export function permissionsFromGrants(grants: readonly { module: string; actions: readonly string[] }[], sectionLimited: boolean): Set<Permission> {
  const out = new Set<Permission>();
  for (const g of normalizeGrants(grants)) {
    // A partially granted link group grants nothing from that group (malformed data).
    const caps = CAPABILITIES[g.module];
    for (const a of g.actions) {
      const cell = caps[a];
      if (cell.kind !== "grantable") continue;
      if (cell.link) {
        const members = ACTIONS.filter((x) => { const c = caps[x]; return c.kind === "grantable" && c.link === cell.link; });
        if (!members.every((x) => g.actions.includes(x))) continue;
      }
      for (const p of sectionLimited && cell.sectionScoped ? cell.sectionScoped : cell.permissions) out.add(p);
    }
  }
  return out;
}

const MODULE_TITLES: Record<ModuleKey, string> = {
  students: "Student Management", academics: "Academics & Examinations", attendance: "Attendance & Operations",
  finance: "Accounts & Finance", administration: "Administration & Insights",
};
function labelOf(key: string): string {
  return (MODULE_TITLES as Record<string, string>)[key] ?? key;
}

/** Human summary of a member's access (for lists and audit summaries). */
export function describeAccess(role: string, grants: readonly Grant[] | undefined, permissionSets: readonly string[] = []): string {
  if (role === "student") return "Student";
  if (role === "admin" && grants === undefined) return permissionSets.includes("accountant") ? "Accountant only (legacy)" : "Full administrator";
  const parts = (grants ?? []).map((g) => `${labelOf(g.module)}: ${g.actions.map((a) => ACTION_LABELS[a]).join("/")}`);
  if (role === "teacher") return parts.length ? `Teacher + ${parts.join("; ")}` : "Teacher";
  return parts.length ? `Office: ${parts.join("; ")}` : "Office: no modules";
}

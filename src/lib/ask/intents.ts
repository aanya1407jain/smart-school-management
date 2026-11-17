/**
 * "Ask Atrium": turns a short request ("mark attendance", "overdue fees",
 * "find Aarav") into the page that does it.
 *
 * Deterministic and local: no model call, no data leaves the browser. Every
 * result is checked against the user's own navigation (role + permissions +
 * school modules), so Ask can only offer pages the user may already open. The
 * server still enforces access on every page and function; this is routing,
 * not access control.
 */
import type { NavIcon, NavItem } from "@/lib/permissions";

export type AskResult = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: NavIcon | "spark" | "search" | "plus" | "key";
  kind: "action" | "page" | "search" | "recent";
  score: number;
};

type Rule = {
  id: string;
  /** Matches the request. */
  test: RegExp;
  /** Phrase shown for this action. */
  title: string;
  subtitle?: string;
  icon: AskResult["icon"];
  /** Candidate destinations in order; the first whose base page the user can open wins. */
  targets: { base: string; href?: string }[];
};

/** Common things people come to do. Ordered by how often a school does them. */
const RULES: Rule[] = [
  { id: "attendance-take", test: /\b(mark|take|record|fill)\b.*\battend|\battendance\b|\bregister\b|\babsent|\bpresent\b|\broll ?call/i, title: "Take today's attendance", subtitle: "Open the attendance register", icon: "attendance",
    targets: [{ base: "/teacher/attendance" }, { base: "/admin/attendance" }, { base: "/student/attendance" }] },
  { id: "fees-collect", test: /\b(collect|receive|record|take)\b.*\b(fee|payment|money)|\breceipt\b|\bpay(ment)?\b/i, title: "Collect a fee payment", subtitle: "Pick a student and issue a receipt", icon: "fees",
    targets: [{ base: "/admin/fees", href: "/admin/fees?action=collect" }, { base: "/student/fees" }] },
  { id: "fees-overdue", test: /\b(overdue|defaulter|dues?|pending fee|unpaid|outstanding|owe)/i, title: "See overdue fees", subtitle: "Defaulters list, by class", icon: "fees",
    targets: [{ base: "/admin/fees", href: "/admin/fees?tab=defaulters" }, { base: "/student/fees" }] },
  { id: "notice-new", test: /\b(post|send|write|publish|announce|new)\b.*\b(notice|announcement|circular|event|holiday)|\bannounce/i, title: "Post a notice", subtitle: "To the school, a class or staff", icon: "notices",
    targets: [{ base: "/admin/notices", href: "/admin/notices?action=new" }] },
  { id: "student-new", test: /\b(add|admit|enrol|enroll|new|register)\b.*\b(student|admission|child|pupil)|\badmission/i, title: "Admit a new student", subtitle: "Start an admission form", icon: "students",
    targets: [{ base: "/admin/students", href: "/admin/students/new" }] },
  { id: "teacher-new", test: /\b(add|hire|new|onboard)\b.*\b(teacher|staff|employee)/i, title: "Add a teacher", subtitle: "Create a staff record", icon: "teachers",
    targets: [{ base: "/admin/teachers", href: "/admin/teachers/new" }] },
  { id: "leave", test: /\bleave\b|\bsubstitut|\bon duty/i, title: "Review leave requests", subtitle: "Teachers & staff", icon: "teachers",
    targets: [{ base: "/admin/teachers", href: "/admin/teachers?tab=leave" }] },
  { id: "exam-new", test: /\b(create|schedule|plan|new|set up)\b.*\b(exam|test|assessment)/i, title: "Schedule an exam", subtitle: "Dates, classes and papers", icon: "exams",
    targets: [{ base: "/admin/examinations", href: "/admin/examinations?action=new" }] },
  { id: "marks", test: /\bmarks\b|\bgrades?\b|\bscores?\b|\bresults?\b|report ?card/i, title: "Enter or view marks", subtitle: "Exams and results", icon: "results",
    targets: [{ base: "/teacher/examinations" }, { base: "/admin/examinations" }, { base: "/student/results" }] },
  { id: "homework-new", test: /\b(set|give|assign|create|new)\b.*\b(homework|assignment|worksheet)/i, title: "Set homework", subtitle: "For one of your classes", icon: "homework",
    targets: [{ base: "/teacher/homework", href: "/teacher/homework?action=new" }] },
  { id: "homework", test: /\bhomework|\bassignment/i, title: "Homework", subtitle: "Due and submitted work", icon: "homework",
    targets: [{ base: "/teacher/homework" }, { base: "/student/homework" }, { base: "/admin/academics" }] },
  { id: "timetable", test: /\b(timetable|schedule|period|class today|next class|time ?table)/i, title: "Open the timetable", subtitle: "Periods for the week", icon: "timetable",
    targets: [{ base: "/teacher/timetable" }, { base: "/student/timetable" }, { base: "/admin/timetable" }] },
  { id: "class-add", test: /\b(add|create|new)\b.*\b(class|section)\b/i, title: "Add a class or section", subtitle: "Academic structure", icon: "academics",
    targets: [{ base: "/admin/academics", href: "/admin/academics?tab=classes&action=add-class" }] },
  { id: "import", test: /\b(import|upload|bulk|excel|csv|spreadsheet)/i, title: "Import students or staff", subtitle: "From CSV or Excel", icon: "accounts",
    targets: [{ base: "/admin/accounts" }] },
  { id: "logins", test: /\b(login|password|credential|reset|account|sign.?in)/i, title: "Manage logins and passwords", subtitle: "Issue or reset sign-in details", icon: "key",
    targets: [{ base: "/admin/credentials" }, { base: "/admin/accounts" }] },
  { id: "promote", test: /\b(promot|transfer certificate|\btc\b|leaving|graduat)/i, title: "Promotions & transfer certificates", subtitle: "Move students to the next year", icon: "results",
    targets: [{ base: "/admin/promotions" }, { base: "/student/certificates" }] },
  { id: "reports", test: /\b(report|analytics|insight|trend|summary|chart)/i, title: "Open reports", subtitle: "Attendance, fees and results by class", icon: "reports",
    targets: [{ base: "/admin/reports" }] },
  { id: "audit", test: /\b(audit|who changed|history|log)\b/i, title: "Audit log", subtitle: "Every sign-in and change", icon: "audit",
    targets: [{ base: "/admin/audit" }] },
  { id: "remarks", test: /\b(remark|incident|behaviou?r|discipline)/i, title: "Log a remark or incident", icon: "remarks",
    targets: [{ base: "/teacher/remarks" }] },
  { id: "password", test: /\b(my password|change password|change my password)/i, title: "Change my password", icon: "key",
    targets: [{ base: "*", href: "/account" }] },
];

/** Words that introduce a person search: "find Aarav", "student Meera Iyer", "who is …". */
const PERSON = /^(?:find|search|look ?up|show|open|who is|student|pupil)\s+(?:student\s+)?(.{2,40})$/i;
const STOP = new Set(["attendance", "fees", "fee", "notice", "notices", "exam", "exams", "timetable", "homework", "reports", "report", "marks", "results", "dashboard", "settings", "profile"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

function canOpen(base: string, allowed: Set<string>) {
  return base === "*" || allowed.has(base);
}

/** Fuzzy score of a page label against the query (0 = no match). */
function labelScore(label: string, q: string) {
  const l = norm(label);
  if (!q) return 0;
  if (l === q) return 100;
  if (l.startsWith(q)) return 80;
  if (new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(l)) return 60;
  const words = q.split(" ").filter(Boolean);
  // Words must match at a word start ("mark" finds "Marks entry", not "Remarks").
  const hits = words.filter((w) => w.length > 1 && new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(l)).length;
  if (hits) return 30 + hits * 10;
  // Initials: "nf" → "Notices & Events"? keep to subsequence for short queries.
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 20 : 0;
}

/**
 * Ranked results for a request. `items` is the user's own flattened navigation.
 * An empty query returns the suggested actions for the user.
 */
export function ask(query: string, items: NavItem[], opts: { canSearchStudents?: boolean } = {}): AskResult[] {
  const allowed = new Set(items.map((i) => i.href));
  const q = norm(query);
  const out: AskResult[] = [];
  const seen = new Set<string>();
  const push = (r: AskResult) => { if (!seen.has(r.href)) { seen.add(r.href); out.push(r); } };

  for (const rule of RULES) {
    if (q && !rule.test.test(query)) continue;
    const target = rule.targets.find((t) => canOpen(t.base, allowed));
    if (!target) continue;
    push({ id: rule.id, title: rule.title, subtitle: rule.subtitle, href: target.href ?? target.base, icon: rule.icon, kind: "action", score: q ? 90 : 10 });
  }

  // Person search: "find Aarav Sharma" → the student list filtered by that name.
  const m = query.trim().match(PERSON);
  if (opts.canSearchStudents && m && !STOP.has(norm(m[1]))) {
    const who = m[1].trim();
    push({ id: "search-students", title: `Find “${who}”`, subtitle: "Search students by name or ID", href: `/admin/students?q=${encodeURIComponent(who)}`, icon: "search", kind: "search", score: 95 });
  }

  for (const item of items) {
    const s = q ? labelScore(item.label, q) : 0;
    if (q && !s) continue;
    push({ id: `page-${item.href}`, title: item.label, subtitle: "Go to page", href: item.href, icon: item.icon, kind: "page", score: s || 1 });
  }

  // Anything that looks like a name or ID, with no better match: offer a student search.
  if (opts.canSearchStudents && q.length >= 2 && !out.some((r) => r.score >= 60)) {
    push({ id: "search-fallback", title: `Search students for “${query.trim()}”`, subtitle: "Name, scholar number or class", href: `/admin/students?q=${encodeURIComponent(query.trim())}`, icon: "search", kind: "search", score: 5 });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** A few starter prompts per role for the Ask surfaces. Filtered to what the user can open. */
export function suggestions(role: "admin" | "teacher" | "student", items: NavItem[]): string[] {
  const byRole = {
    admin: ["Overdue fees", "Post a notice", "Admit a new student", "Attendance today", "Find Aarav Sharma"],
    teacher: ["Mark attendance", "Set homework", "Enter marks", "My timetable", "Log a remark"],
    student: ["My timetable", "Homework due", "My results", "Fee dues", "Attendance"],
  }[role];
  return byRole.filter((s) => ask(s, items, { canSearchStudents: role === "admin" }).some((r) => r.kind !== "search" || role === "admin"));
}

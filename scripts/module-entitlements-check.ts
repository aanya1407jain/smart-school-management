/**
 * Direct-backend module entitlement check against a REAL deployment seeded
 * with the demo school (`npx convex run seed:demo`). READ-ONLY: it signs in
 * through Convex Auth and calls queries only; nothing is written.
 *
 *   CONVEX_URL=<deployment url> npx tsx --tsconfig tsconfig.json scripts/module-entitlements-check.ts
 *
 * It reads the school's enabled modules from the server session and then, per
 * module, expects every representative call to SUCCEED when the module is
 * enabled and to fail with MODULE_DISABLED when it is not — i.e. it proves the
 * server enforces entitlements without any UI. It also checks that enabled
 * modules still refuse callers without permission (teacher → fees).
 *
 * Run it once per configuration (all modules on; Finance off; Finance back on)
 * as listed in docs/VERIFICATION_REPORT.md.
 */
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { MODULE_KEYS, type ModuleKey } from "../convex/core/modules";

const URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
if (!URL) throw new Error("Set CONVEX_URL to the deployment URL.");
const LOGIN = {
  admin: { id: process.env.ADMIN_LOGIN ?? "ADMIN-001", pw: process.env.ADMIN_PASSWORD ?? "Admin@123" },
  teacher: { id: process.env.TEACHER_LOGIN ?? "TCH-00001", pw: process.env.TEACHER_PASSWORD ?? "Teacher@123" },
  student: { id: process.env.STUDENT_LOGIN ?? "STU-2026-00001", pw: process.env.STUDENT_PASSWORD ?? "Student@123" },
};

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const codeOf = (e: unknown) => (e instanceof ConvexError ? ((e.data as { code?: string })?.code ?? "CONVEX_ERROR") : e instanceof Error ? `ERROR: ${e.message.slice(0, 100)}` : "UNKNOWN");
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "OK"; } catch (e) { return codeOf(e); }
}
async function signIn(id: string, pw: string) {
  const client = new ConvexHttpClient(URL!);
  const res = await client.action(api.auth.signIn, { provider: "password", params: { loginId: id, password: pw, flow: "signIn" } });
  if (!res.tokens?.token) throw new Error(`No token for ${id}`);
  client.setAuth(res.tokens.token);
  return client;
}

async function main() {
  const admin = await signIn(LOGIN.admin.id, LOGIN.admin.pw);
  const teacher = await signIn(LOGIN.teacher.id, LOGIN.teacher.pw);
  const student = await signIn(LOGIN.student.id, LOGIN.student.pw);
  const s = await admin.query(api.users.session, {});
  if (s.status !== "signedIn") throw new Error("Admin has no school session");
  const enabled = new Set<ModuleKey>(s.viewer.modules);
  console.log(`School: ${s.viewer.school.name} · enabled modules: ${[...enabled].join(", ") || "(none)"}`);
  const st = await student.query(api.users.session, {});
  const studentId = st.status === "signedIn" ? st.viewer.student?.studentId : undefined;
  const today = new Date().toISOString().slice(0, 10);

  const calls: Record<ModuleKey, [string, () => Promise<unknown>][]> = {
    students: [["academics.studentCounts (admin)", () => admin.query(api.students.studentCounts, {})]],
    academics: [
      ["exams.list (admin)", () => admin.query(api.exams.list, {})],
      ["homework.listMine (teacher)", () => teacher.query(api.homework.listMine, {})],
      ["studentPortal.myTimetable (student)", () => student.query(api.timetable.myStudentTimetable, {})],
    ],
    attendance: [
      ["staff.myLeave (teacher)", () => teacher.query(api.staff.myLeave, {})],
      ...(studentId ? [["attendance.studentHistory (student, own)", () => student.query(api.attendance.studentHistory, { studentId })] as [string, () => Promise<unknown>]] : []),
    ],
    finance: [
      ["fees.listStructures (admin)", () => admin.query(api.fees.listStructures, {})],
      ["studentPortal.myFees (student)", () => student.query(api.fees.myFees, {})],
    ],
    administration: [
      ["notices.feed (teacher)", () => teacher.query(api.notices.feed, {})],
      ["studentPortal.myNotices (student)", () => student.query(api.studentPortal.myNotices, { today })],
    ],
  };
  for (const key of MODULE_KEYS) {
    const want = enabled.has(key) ? "OK" : "MODULE_DISABLED";
    for (const [name, fn] of calls[key]) {
      const got = await outcome(fn);
      check(`[${key} ${enabled.has(key) ? "on" : "off"}] ${name}`, got === want, `expected ${want}, got ${got}`);
    }
  }
  // Core keeps working whatever the modules.
  check("core: users.viewer (admin)", (await outcome(() => admin.query(api.users.viewer, {}))) === "OK");
  check("core: academics.listSections (admin)", (await outcome(() => admin.query(api.academics.listSections, {}))) === "OK");
  check("core: reports.adminDashboard (admin)", (await outcome(() => admin.query(api.reports.adminDashboard, {}))) === "OK");
  // Permissions are unchanged: a teacher never reads fee structures (FORBIDDEN, or MODULE_DISABLED when finance is off).
  const t = await outcome(() => teacher.query(api.fees.listStructures, {}));
  check("teacher cannot read fee structures", t === (enabled.has("finance") ? "FORBIDDEN" : "MODULE_DISABLED"), `got ${t}`);

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

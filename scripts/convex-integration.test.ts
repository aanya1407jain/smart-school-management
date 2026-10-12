/**
 * End-to-end backend checks against a REAL Convex deployment (local or dev)
 * that has been seeded with `npx convex run seed:demo`.
 *
 *   CONVEX_URL=http://127.0.0.1:3210 npm run test:convex:integration
 *
 * Signs in through Convex Auth (Password provider) exactly as the browser
 * does, then exercises identity, tenancy and the attendance ownership rules.
 * Mutating checks use a past school day that has no register yet, so the
 * script can be re-run until it runs out of free dates (then reseed).
 */
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
if (!URL) throw new Error("Set CONVEX_URL to the deployment URL.");

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function codeOf(e: unknown): string {
  if (e instanceof ConvexError) return (e.data as { code?: string })?.code ?? "CONVEX_ERROR";
  return e instanceof Error ? `ERROR: ${e.message.slice(0, 120)}` : "UNKNOWN";
}
async function expectCode(name: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    check(name, false, "expected an error, call succeeded");
  } catch (e) {
    const got = codeOf(e);
    check(name, got === code || got.includes(code), `got ${got}`);
  }
}

async function signIn(email: string, password: string): Promise<ConvexHttpClient> {
  const client = new ConvexHttpClient(URL!);
  const res = await client.action(api.auth.signIn, { provider: "password", params: { email, password, flow: "signIn" } });
  const token = res.tokens?.token;
  if (!token) throw new Error(`No token for ${email}`);
  client.setAuth(token);
  return client;
}

const PW = { admin: "Admin@123", teacher: "Teacher@123", student: "Student@123", guardian: "Guardian@123", welcome: "Welcome@123" };
const D = "asteracademy.edu";

async function main() {
  // ---------------------------------------------------------------- authentication
  const anon = new ConvexHttpClient(URL!);
  check("Signed-out users.me returns null", (await anon.query(api.users.me, {})) === null);
  await expectCode("Signed-out school query is UNAUTHENTICATED", () => anon.query(api.users.viewer, {}), "UNAUTHENTICATED");
  try {
    await signIn(`admin@${D}`, "wrong-password1");
    check("Wrong password is rejected", false);
  } catch {
    check("Wrong password is rejected", true);
  }
  try {
    await anon.action(api.auth.signIn, { provider: "password", params: { email: "intruder@example.com", password: "Passw0rd!!", flow: "signUp" } });
    check("Self-registration without an invitation is rejected", false);
  } catch (e) {
    check("Self-registration without an invitation is rejected", true, codeOf(e));
  }
  try {
    await anon.action(api.auth.signIn, { provider: "password", params: { email: "intruder@example.com", password: "Passw0rd!!", flow: "signUp", inviteCode: "AAAA-BBBB-CCCC" } });
    check("Sign-up with a forged invitation code is rejected", false);
  } catch (e) {
    check("Sign-up with a forged invitation code is rejected", true, codeOf(e));
  }

  const admin = await signIn(`admin@${D}`, PW.admin);
  const rahul = await signIn(`teacher@${D}`, PW.teacher);
  const meera = await signIn(`meera.iyer@${D}`, PW.welcome);
  const sunita = await signIn(`sunita.rao@${D}`, PW.welcome);
  const joshi = await signIn(`sameer.joshi@${D}`, PW.welcome);
  const aarav = await signIn(`student@${D}`, PW.student);
  const guardian = await signIn(`guardian@${D}`, PW.guardian);
  check("All demo personas sign in through Convex Auth", true);

  // ---------------------------------------------------------------- identity
  const meAdmin = await admin.query(api.users.me, {});
  check("users.me lists the admin membership", meAdmin?.memberships.length === 1 && meAdmin.memberships[0].role === "admin");
  const vAdmin = await admin.query(api.users.viewer, {});
  // Queries never read the clock: the client passes "today" in the school's timezone.
  const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: vAdmin.school.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  check("Admin viewer: role admin, school derived server-side", vAdmin.role === "admin" && vAdmin.school.slug === "aster-academy");
  check("Admin has attendance:read:all but no mark/edit", vAdmin.permissions.includes("attendance:read:all") && !vAdmin.permissions.includes("attendance:mark:class_teacher") && !vAdmin.permissions.includes("attendance:edit:class_teacher"));
  const vRahul = await rahul.query(api.users.viewer, {});
  check("Teacher viewer is linked to a teacher record", vRahul.role === "teacher" && !!vRahul.teacher);
  const vGuardian = await guardian.query(api.users.viewer, {});
  check("Guardian uses the student portal with 2 linked students", vGuardian.role === "student" && vGuardian.isGuardian && vGuardian.students.length === 2);
  const vAarav = await aarav.query(api.users.viewer, {});
  check("Student viewer sees only themself", vAarav.students.length === 1 && vAarav.students[0].name === "Aarav Sharma");
  await expectCode("A membershipId that is not yours is rejected", () => aarav.query(api.users.viewer, { membershipId: vAdmin.membershipId }), "NO_SCHOOL_ACCESS");

  // ---------------------------------------------------------------- session (the frontend's single identity source)
  check("Signed-out users.session reports signedOut", (await anon.query(api.users.session, {})).status === "signedOut");
  const sessions = { admin: await admin.query(api.users.session, {}), rahul: await rahul.query(api.users.session, {}), aarav: await aarav.query(api.users.session, {}), guardian: await guardian.query(api.users.session, {}) };
  const roleOf = (x: (typeof sessions)[keyof typeof sessions]) => (x.status === "signedIn" ? x.viewer.role : x.status);
  check("users.session derives each role server-side", roleOf(sessions.admin) === "admin" && roleOf(sessions.rahul) === "teacher" && roleOf(sessions.aarav) === "student" && roleOf(sessions.guardian) === "student",
    Object.values(sessions).map(roleOf).join(","));
  check("Session links: teacher record / own student / guardian with 2 children",
    sessions.rahul.status === "signedIn" && !!sessions.rahul.viewer.teacher &&
    sessions.aarav.status === "signedIn" && sessions.aarav.viewer.student?.name === "Aarav Sharma" && !sessions.aarav.viewer.isGuardian &&
    sessions.guardian.status === "signedIn" && !!sessions.guardian.viewer.guardian && sessions.guardian.viewer.students.length === 2 && sessions.guardian.viewer.student === null);
  const forgedSession = await aarav.query(api.users.session, { membershipId: vAdmin.membershipId });
  check("Session with someone else's membershipId gets no identity (noSchool)", forgedSession.status === "noSchool");
  try {
    await aarav.query(api.users.session, { role: "admin" } as never);
    check("A role passed by the client is rejected", false);
  } catch (e) {
    check("A role passed by the client is rejected", /ArgumentValidationError|extra field/i.test(codeOf(e)), codeOf(e).replace(/\s+/g, " ").slice(0, 80));
  }

  // ---------------------------------------------------------------- sections
  const sections = await admin.query(api.academics.listSections, {});
  const sec = (label: string) => sections.find((s) => s.displayName === label)!._id;
  const s10A = sec("10-A"), s10B = sec("10-B"), s10C = sec("10-C"), s8A = sec("8-A");
  const rahulSections = await rahul.query(api.academics.listSections, {});
  check("Teacher sees only sections in scope", rahulSections.map((s) => s.displayName).sort().join(",") === "10-A,10-B,9-A", rahulSections.map((s) => s.displayName).join(","));
  await expectCode("Student cannot read a section roster", () => aarav.query(api.academics.sectionRoster, { sectionId: s10A }), "FORBIDDEN");

  // Find a past school day with no register for 10-A, 10-B and 10-C.
  const freeDay = async (): Promise<string> => {
    for (let back = 12; back < 160; back++) {
      const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
      const reg = await admin.query(api.attendance.getByDate, { sectionId: s10A, date: d, today: TODAY });
      const regB = await admin.query(api.attendance.getByDate, { sectionId: s10B, date: d, today: TODAY });
      const regC = await admin.query(api.attendance.getByDate, { sectionId: s10C, date: d, today: TODAY });
      if (reg.isSchoolDay && !reg.session && !regB.session && !regC.session) return d;
    }
    throw new Error("No free school day left — reseed the deployment.");
  };
  const day = await freeDay();

  // ---------------------------------------------------------------- attendance ownership
  const reg = await rahul.query(api.attendance.getByDate, { sectionId: s10A, date: day, today: TODAY });
  check("Class teacher (10-A) can mark", reg.isClassTeacher && reg.canMark && !reg.canEdit);
  const entriesFor = (r: typeof reg, absent?: Id<"students">) =>
    r.students.map((s) => ({ studentId: s.studentId, status: (s.studentId === absent ? "absent" : "present") as "absent" | "present" }));
  const aaravId = vAarav.students[0].studentId as Id<"students">;

  const regB = await rahul.query(api.attendance.getByDate, { sectionId: s10B, date: day, today: TODAY });
  check("Subject teacher (Rahul on 10-B) sees read-only register", !regB.canMark && !regB.canEdit && /Meera Iyer/.test(regB.readOnlyReason ?? ""), regB.readOnlyReason ?? "");
  await expectCode("Subject teacher cannot mark 10-B", () => rahul.mutation(api.attendance.mark, { sectionId: s10B, date: day, entries: entriesFor(regB) }), "FORBIDDEN");
  await expectCode("Teacher cannot read a section outside scope (8-A)", () => rahul.query(api.attendance.getByDate, { sectionId: s8A, date: day, today: TODAY }), "FORBIDDEN");
  await expectCode("Sunita (subject teacher of 10-A) cannot mark 10-A", () => sunita.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Admin cannot mark attendance", () => admin.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Student cannot mark attendance", () => aarav.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Guardian cannot mark attendance", () => guardian.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Incomplete register is rejected", () => rahul.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg).slice(1) }), "INVALID_ARGUMENT");
  await expectCode("Future date is rejected", () => rahul.mutation(api.attendance.mark, { sectionId: s10A, date: "2099-01-05", entries: entriesFor(reg) }), "INVALID_ARGUMENT");

  await rahul.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg, aaravId) });
  check("Class teacher marks 10-A (Aarav absent)", true);
  await expectCode("Marking the same date twice is a CONFLICT", () => rahul.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "CONFLICT");
  const after = await rahul.query(api.attendance.getByDate, { sectionId: s10A, date: day, today: TODAY });
  check("Register now editable by the class teacher only", after.canEdit && !after.canMark);
  const aaravNotes = await aarav.query(api.notifications.list, { unreadOnly: true });
  check("Absent student receives an attendance notification", aaravNotes.some((n) => n.type === "attendance" && n.message.includes(day)));
  const guardianNotes = await guardian.query(api.notifications.list, { unreadOnly: true });
  check("Linked guardian receives the notification too", guardianNotes.some((n) => n.type === "attendance" && n.message.includes(day)));

  const adminView = await admin.query(api.attendance.getByDate, { sectionId: s10A, date: day, today: TODAY });
  check("Admin views the register read-only", !!adminView.session && !adminView.canEdit && /Administrators/.test(adminView.readOnlyReason ?? ""));
  await expectCode("Admin cannot edit attendance", () => admin.mutation(api.attendance.update, { sectionId: s10A, date: day, changes: [{ studentId: aaravId, status: "present" }] }), "FORBIDDEN");
  await expectCode("Subject teacher cannot edit 10-A", () => sunita.mutation(api.attendance.update, { sectionId: s10A, date: day, changes: [{ studentId: aaravId, status: "present" }] }), "FORBIDDEN");
  const upd = await rahul.mutation(api.attendance.update, { sectionId: s10A, date: day, changes: [{ studentId: aaravId, status: "present", remark: "Arrived after assembly" }] });
  check("Class teacher corrects Aarav absent → present", upd.changed === 1);
  const audit = await admin.query(api.audit.list, { action: "attendance.corrected", limit: 5 });
  check("Correction is written to the audit log", audit.some((a) => a.summary.includes("10-A") && a.summary.includes(day)));
  await expectCode("Teacher cannot read the audit log", () => rahul.query(api.audit.list, {}), "FORBIDDEN");

  // ---------------------------------------------------------------- student / guardian scope
  const own = await aarav.query(api.attendance.studentHistory, { studentId: aaravId });
  check("Student reads own attendance", own.records.some((r) => r.date === day && r.status === "present"));
  const linked = vGuardian.students.map((s) => s.studentId as Id<"students">);
  for (const id of linked) {
    const h = await guardian.query(api.attendance.studentHistory, { studentId: id });
    check(`Guardian reads linked child ${h.name}`, h.records.length > 0);
  }
  const roster10B = await admin.query(api.academics.sectionRoster, { sectionId: s10B });
  const amairaId = roster10B.students.find((s) => s.name === "Amaira Desai")!.studentId;
  await expectCode("Student cannot read another student", () => aarav.query(api.attendance.studentHistory, { studentId: amairaId }), "NOT_FOUND");
  await expectCode("Guardian cannot read an unlinked student", () => guardian.query(api.attendance.studentHistory, { studentId: amairaId }), "NOT_FOUND");
  for (const s of vGuardian.students) {
    const c = await guardian.query(api.users.studentContext, { studentId: s.studentId });
    check(`Guardian can switch to linked child ${c.name}`, c.relation === "guardian" && c.studentId === s.studentId);
  }
  await expectCode("Guardian cannot switch to an unlinked student", () => guardian.query(api.users.studentContext, { studentId: amairaId }), "NOT_FOUND");
  await expectCode("Teacher has no student-portal context", () => rahul.query(api.users.studentContext, { studentId: amairaId }), "NOT_FOUND");
  const rahulReadsAmaira = await rahul.query(api.attendance.studentHistory, { studentId: amairaId });
  check("Subject teacher can VIEW a student in a section they teach", rahulReadsAmaira.name === "Amaira Desai");

  // ---------------------------------------------------------------- ownership moves with classTeacherId
  const vJoshi = await joshi.query(api.users.viewer, {});
  await expectCode("A teacher can own only one section per year", () => admin.mutation(api.academics.setClassTeacher, { sectionId: s10B, teacherId: vRahul.teacher!.teacherId as Id<"teachers"> }), "CONFLICT");
  await admin.mutation(api.academics.setClassTeacher, { sectionId: s10B, teacherId: vJoshi.teacher!.teacherId as Id<"teachers"> });
  const regB2 = await joshi.query(api.attendance.getByDate, { sectionId: s10B, date: day, today: TODAY });
  await expectCode("Former class teacher (Meera) loses mark rights on 10-B", () => meera.mutation(api.attendance.mark, { sectionId: s10B, date: day, entries: entriesFor(regB2) }), "FORBIDDEN");
  await joshi.mutation(api.attendance.mark, { sectionId: s10B, date: day, entries: entriesFor(regB2) });
  check("New class teacher (Joshi) can mark 10-B", true);
  const meeraId = (await meera.query(api.users.viewer, {})).teacher!.teacherId as Id<"teachers">;
  await admin.mutation(api.academics.setClassTeacher, { sectionId: s10B, teacherId: meeraId });
  check("Ownership restored to Meera", (await meera.query(api.attendance.getByDate, { sectionId: s10B, date: day, today: TODAY })).canEdit);

  // ---------------------------------------------------------------- contract checks
  await expectCode("getByDate rejects a malformed today", () => rahul.query(api.attendance.getByDate, { sectionId: s10A, date: day, today: "2026-13-40" }), "INVALID_ARGUMENT");
  const pastAsToday = await rahul.query(api.attendance.getByDate, { sectionId: s10A, date: day, today: "2000-01-01" });
  check("A client-supplied 'today' only affects hints, never permissions (no canMark for a 'future' date)", !pastAsToday.canMark);
  const history = await aarav.query(api.attendance.studentHistory, { studentId: aaravId });
  check("studentHistory defaults to the current academic year", history.range.from === "2026-04-01" && history.range.to === "2027-03-31");
  await expectCode("studentHistory rejects ranges over 366 days", () => aarav.query(api.attendance.studentHistory, { studentId: aaravId, from: "2025-01-01", to: "2026-12-31" }), "INVALID_ARGUMENT");
  await expectCode("listBySection rejects ranges over 366 days", () => admin.query(api.attendance.listBySection, { sectionId: s10A, from: "2025-01-01", to: "2026-12-31" }), "INVALID_ARGUMENT");
  const classes = await admin.query(api.academics.listClasses, {});
  const grade10 = classes.find((c) => c.level === 10)!;
  const curriculum10 = await rahul.query(api.academics.listClassSubjects, { classId: grade10._id });
  check("Grade 10 curriculum is seeded (6 subjects incl. CS)", curriculum10.length === 6 && curriculum10.some((s) => s.code === "CS"));
  const grade8 = classes.find((c) => c.level === 8)!;
  const subjects = await admin.query(api.academics.listSubjects, {});
  const cs = subjects.find((s) => s.code === "CS")!;
  await expectCode("Subject teacher cannot be assigned a subject outside the class curriculum", () => admin.mutation(api.academics.assignSubjectTeacher, { sectionId: s8A, subjectId: cs._id, teacherId: vJoshi.teacher!.teacherId as Id<"teachers"> }), "INVALID_RELATIONSHIP");
  const currentYear = (await admin.query(api.academics.listAcademicYears, {})).find((y) => y.isCurrent)!;
  await expectCode("Teacher cannot change a curriculum", () => rahul.mutation(api.academics.setClassSubjects, { classId: grade8._id, academicYearId: currentYear._id, subjectIds: [] }), "FORBIDDEN");
  await expectCode("Curriculum subject with assigned teachers cannot be removed", () => admin.mutation(api.academics.setClassSubjects, { classId: grade8._id, academicYearId: currentYear._id, subjectIds: [] }), "INVALID_RELATIONSHIP");

  // ---------------------------------------------------------------- daily overview scope
  const overviewAdmin = await admin.query(api.attendance.dailyOverview, { date: day });
  const overviewRahul = await rahul.query(api.attendance.dailyOverview, { date: day });
  check("Admin overview covers every section", overviewAdmin.length === sections.length);
  check("Teacher overview covers only their sections", overviewRahul.length === 3 && overviewRahul.filter((r) => r.isClassTeacher).length === 1);

  // ---------------------------------------------------------------- invitations
  await expectCode("Teacher cannot invite users", () => rahul.action(api.memberships.invite, { email: "x@example.com", displayName: "X", role: "admin" }), "FORBIDDEN");
  const newEmail = `office.${Date.now()}@example.com`;
  const inv = await admin.action(api.memberships.invite, { email: newEmail, displayName: "Office Accountant", role: "admin", permissionSets: ["accountant"] });
  check("Admin invite returns a one-time code", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(inv.inviteCode));
  const listed = await admin.query(api.memberships.list, { role: "admin", paginationOpts: { numItems: 20, cursor: null } });
  check("Invitation appears as an 'invited' membership (paginated list)", listed.page.some((m) => m._id === inv.membershipId && m.status === "invited"));
  const firstPage = await admin.query(api.memberships.list, { paginationOpts: { numItems: 5, cursor: null } });
  const secondPage = await admin.query(api.memberships.list, { paginationOpts: { numItems: 5, cursor: firstPage.continueCursor } });
  check("memberships.list paginates without overlap", firstPage.page.length === 5 && !firstPage.isDone && secondPage.page.every((m) => !firstPage.page.some((x) => x._id === m._id)));
  try {
    await anon.action(api.auth.signIn, { provider: "password", params: { email: newEmail, password: "Passw0rd!!", flow: "signUp", inviteCode: "WRNG-CODE-2222" } });
    check("Invited email with the wrong code is rejected", false);
  } catch {
    check("Invited email with the wrong code is rejected", true);
  }
  const signUp = await anon.action(api.auth.signIn, { provider: "password", params: { email: newEmail.toUpperCase(), password: "Passw0rd!!", flow: "signUp", inviteCode: inv.inviteCode.toLowerCase() } });
  check("Invitation code activates the account (email/code normalised)", !!signUp.tokens?.token);
  const office = await signIn(newEmail, "Passw0rd!!");
  const vOffice = await office.query(api.users.viewer, {});
  check("Activated member gets role + permission set from the membership", vOffice.role === "admin" && vOffice.permissionSets.includes("accountant"));
  try {
    await anon.action(api.auth.signIn, { provider: "password", params: { email: `other.${newEmail}`, password: "Passw0rd!!", flow: "signUp", inviteCode: inv.inviteCode } });
    check("An invitation code cannot be reused", false);
  } catch {
    check("An invitation code cannot be reused", true);
  }

  await admin.mutation(api.memberships.updateAccess, { targetMembershipId: inv.membershipId, status: "suspended" });
  await expectCode("Suspended member's existing session loses school access", () => office.query(api.users.viewer, {}), "NO_SCHOOL_ACCESS");
  try {
    await signIn(newEmail, "Passw0rd!!");
    check("Suspended member cannot start a new session", false);
  } catch {
    check("Suspended member cannot start a new session", true);
  }
  await expectCode("Admin cannot change their own access", () => admin.mutation(api.memberships.updateAccess, { targetMembershipId: vAdmin.membershipId, status: "suspended" }), "FORBIDDEN");

  // ---------------------------------------------------------------- change password (Convex Auth credentials)
  {
    const email = `meera.iyer@${D}`;
    const NEW = "Changed@456";
    const me = await signIn(email, PW.welcome);
    await expectCode("Change password: wrong current password rejected", () => me.action(api.account.changePassword, { currentPassword: "not-it-1", newPassword: NEW }), "INVALID_ARGUMENT");
    await expectCode("Change password: weak new password rejected", () => me.action(api.account.changePassword, { currentPassword: PW.welcome, newPassword: "short" }), "INVALID_ARGUMENT");
    await expectCode("Change password: signed out rejected", () => anon.action(api.account.changePassword, { currentPassword: PW.welcome, newPassword: NEW }), "UNAUTHENTICATED");
    await me.action(api.account.changePassword, { currentPassword: PW.welcome, newPassword: NEW });
    let oldWorks = true;
    try { await signIn(email, PW.welcome); } catch { oldWorks = false; }
    const again = await signIn(email, NEW);
    check("Change password: old password stops working, new one signs in", !oldWorks && (await again.query(api.users.viewer, {})).email === email);
    await again.action(api.account.changePassword, { currentPassword: NEW, newPassword: PW.welcome }); // restore the demo password
    check("Change password: restored demo password signs in", !!(await signIn(email, PW.welcome)));
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

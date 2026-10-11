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
  check("Admin viewer: role admin, school derived server-side", vAdmin.role === "admin" && vAdmin.school.slug === "aster-academy");
  check("Admin has attendance:read:all but no mark/edit", vAdmin.permissions.includes("attendance:read:all") && !vAdmin.permissions.includes("attendance:mark:class_teacher") && !vAdmin.permissions.includes("attendance:edit:class_teacher"));
  const vRahul = await rahul.query(api.users.viewer, {});
  check("Teacher viewer is linked to a teacher record", vRahul.role === "teacher" && !!vRahul.teacher);
  const vGuardian = await guardian.query(api.users.viewer, {});
  check("Guardian uses the student portal with 2 linked students", vGuardian.role === "student" && vGuardian.isGuardian && vGuardian.students.length === 2);
  const vAarav = await aarav.query(api.users.viewer, {});
  check("Student viewer sees only themself", vAarav.students.length === 1 && vAarav.students[0].name === "Aarav Sharma");
  await expectCode("A membershipId that is not yours is rejected", () => aarav.query(api.users.viewer, { membershipId: vAdmin.membershipId }), "NO_SCHOOL_ACCESS");

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
      const reg = await admin.query(api.attendance.getByDate, { sectionId: s10A, date: d });
      const regB = await admin.query(api.attendance.getByDate, { sectionId: s10B, date: d });
      const regC = await admin.query(api.attendance.getByDate, { sectionId: s10C, date: d });
      if (reg.isSchoolDay && !reg.session && !regB.session && !regC.session) return d;
    }
    throw new Error("No free school day left — reseed the deployment.");
  };
  const day = await freeDay();

  // ---------------------------------------------------------------- attendance ownership
  const reg = await rahul.query(api.attendance.getByDate, { sectionId: s10A, date: day });
  check("Class teacher (10-A) can mark", reg.isClassTeacher && reg.canMark && !reg.canEdit);
  const entriesFor = (r: typeof reg, absent?: Id<"students">) =>
    r.students.map((s) => ({ studentId: s.studentId, status: (s.studentId === absent ? "absent" : "present") as "absent" | "present" }));
  const aaravId = vAarav.students[0].studentId as Id<"students">;

  const regB = await rahul.query(api.attendance.getByDate, { sectionId: s10B, date: day });
  check("Subject teacher (Rahul on 10-B) sees read-only register", !regB.canMark && !regB.canEdit && /Meera Iyer/.test(regB.readOnlyReason ?? ""), regB.readOnlyReason ?? "");
  await expectCode("Subject teacher cannot mark 10-B", () => rahul.mutation(api.attendance.mark, { sectionId: s10B, date: day, entries: entriesFor(regB) }), "FORBIDDEN");
  await expectCode("Teacher cannot read a section outside scope (8-A)", () => rahul.query(api.attendance.getByDate, { sectionId: s8A, date: day }), "FORBIDDEN");
  await expectCode("Sunita (subject teacher of 10-A) cannot mark 10-A", () => sunita.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Admin cannot mark attendance", () => admin.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Student cannot mark attendance", () => aarav.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Guardian cannot mark attendance", () => guardian.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "FORBIDDEN");
  await expectCode("Incomplete register is rejected", () => rahul.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg).slice(1) }), "INVALID_ARGUMENT");
  await expectCode("Future date is rejected", () => rahul.mutation(api.attendance.mark, { sectionId: s10A, date: "2099-01-05", entries: entriesFor(reg) }), "INVALID_ARGUMENT");

  await rahul.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg, aaravId) });
  check("Class teacher marks 10-A (Aarav absent)", true);
  await expectCode("Marking the same date twice is a CONFLICT", () => rahul.mutation(api.attendance.mark, { sectionId: s10A, date: day, entries: entriesFor(reg) }), "CONFLICT");
  const after = await rahul.query(api.attendance.getByDate, { sectionId: s10A, date: day });
  check("Register now editable by the class teacher only", after.canEdit && !after.canMark);
  const aaravNotes = await aarav.query(api.notifications.list, { unreadOnly: true });
  check("Absent student receives an attendance notification", aaravNotes.some((n) => n.type === "attendance" && n.message.includes(day)));
  const guardianNotes = await guardian.query(api.notifications.list, { unreadOnly: true });
  check("Linked guardian receives the notification too", guardianNotes.some((n) => n.type === "attendance" && n.message.includes(day)));

  const adminView = await admin.query(api.attendance.getByDate, { sectionId: s10A, date: day });
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
  const rahulReadsAmaira = await rahul.query(api.attendance.studentHistory, { studentId: amairaId });
  check("Subject teacher can VIEW a student in a section they teach", rahulReadsAmaira.name === "Amaira Desai");

  // ---------------------------------------------------------------- ownership moves with classTeacherId
  const vJoshi = await joshi.query(api.users.viewer, {});
  await expectCode("A teacher can own only one section per year", () => admin.mutation(api.academics.setClassTeacher, { sectionId: s10B, teacherId: vRahul.teacher!.teacherId as Id<"teachers"> }), "CONFLICT");
  await admin.mutation(api.academics.setClassTeacher, { sectionId: s10B, teacherId: vJoshi.teacher!.teacherId as Id<"teachers"> });
  const regB2 = await joshi.query(api.attendance.getByDate, { sectionId: s10B, date: day });
  await expectCode("Former class teacher (Meera) loses mark rights on 10-B", () => meera.mutation(api.attendance.mark, { sectionId: s10B, date: day, entries: entriesFor(regB2) }), "FORBIDDEN");
  await joshi.mutation(api.attendance.mark, { sectionId: s10B, date: day, entries: entriesFor(regB2) });
  check("New class teacher (Joshi) can mark 10-B", true);
  const meeraId = (await meera.query(api.users.viewer, {})).teacher!.teacherId as Id<"teachers">;
  await admin.mutation(api.academics.setClassTeacher, { sectionId: s10B, teacherId: meeraId });
  check("Ownership restored to Meera", (await meera.query(api.attendance.getByDate, { sectionId: s10B, date: day })).canEdit);

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
  const listed = await admin.query(api.memberships.list, {});
  check("Invitation appears as an 'invited' membership", listed.some((m) => m._id === inv.membershipId && m.status === "invited"));
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

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

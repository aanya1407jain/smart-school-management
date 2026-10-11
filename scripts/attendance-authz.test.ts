/**
 * Service-level authorization tests for attendance ownership.
 *
 * Calls the mock service layer DIRECTLY (no UI), signed in as different users,
 * to prove unauthorized attendance mutations are rejected at the service /
 * permission layer — not just hidden in the UI.
 *
 * Run: npm run test:authz
 */

// ---- minimal browser shim (the mock store/session use Web Storage) ----------
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as Record<string, unknown>;
g.window = { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage(), addEventListener: () => {} };

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const { services } = await import("../src/lib/services");
  const { previousSchoolDay, todayISO, addDays, isSchoolDay } = await import("../src/lib/utils/dates");
  /** A past (or today's) school day with no register yet for the section — i.e. a "mark" rather than an "edit". */
  const unmarkedDay = (sectionId: string) => {
    for (let n = 0; n < 120; n++) {
      const d = addDays(todayISO(), -n);
      if (isSchoolDay(d) && !readDb().attendance.some((a) => a.sectionId === sectionId && a.date === d)) return d;
    }
    throw new Error("no unmarked school day found");
  };
  const { readDb } = await import("../src/lib/store/db");

  const DAY = previousSchoolDay(addDays(todayISO(), -1)); // last school day — registers exist
  const login = (email: string, password: string, role: "admin" | "teacher" | "student") =>
    services.auth.login({ email, password, role, remember: false });
  const rejects = async (fn: () => Promise<unknown>) => {
    try { await fn(); return { rejected: false, code: "" }; } catch (e) { return { rejected: true, code: (e as { code?: string }).code ?? (e as Error).message }; }
  };
  const allPresent = (sectionId: string) =>
    Object.fromEntries(readDb().enrollments.filter((e) => e.sectionId === sectionId).map((e) => [e.studentId, "present" as const]));

  const db = readDb();
  const sec = (id: string) => db.sections.find((s) => s.id === id)!;
  check("Data: Rahul Verma is class teacher of 10-A", sec("sec_10a").classTeacherId === "t_verma");
  check("Data: Rahul teaches Maths in 10-B but is NOT its class teacher", db.teacherAssignments.some((a) => a.teacherId === "t_verma" && a.sectionId === "sec_10b") && sec("sec_10b").classTeacherId !== "t_verma");
  check("Data: Sunita Rao teaches English in 10-A and is class teacher of 10-C", db.teacherAssignments.some((a) => a.teacherId === "t_rao" && a.sectionId === "sec_10a" && a.subjectId === "sub_eng") && sec("sec_10c").classTeacherId === "t_rao");

  // ---------------- Rahul (class teacher of 10-A)
  await login("teacher@asteracademy.edu", "Teacher@123", "teacher");
  const markDate = unmarkedDay("sec_10a");
  const r1 = await rejects(() => services.attendance.saveRegister("sec_10a", markDate, allPresent("sec_10a")));
  check("1. Rahul can MARK 10-A (new register)", !r1.rejected, `${markDate} ${r1.code}`);
  const reg10a = await services.attendance.getRegister("sec_10a", DAY);
  check("2a. Register reports canEdit=true for Rahul on 10-A", reg10a.canEdit === true && reg10a.readOnlyReason === null);
  const before = { ...reg10a.entries! };
  const r2 = await rejects(() => services.attendance.saveRegister("sec_10a", DAY, { ...before, stu_aarav: "absent" }));
  const r2b = await rejects(() => services.attendance.saveRegister("sec_10a", DAY, { ...before, stu_aarav: "present" }));
  check("2b. Rahul can EDIT/correct 10-A (Aarav absent → present)", !r2.rejected && !r2b.rejected && readDb().attendance.find((a) => a.sectionId === "sec_10a" && a.date === DAY)!.entries.stu_aarav === "present");
  const reg10b = await services.attendance.getRegister("sec_10b", DAY);
  check("3a. Rahul can VIEW 10-B (he teaches there) but read-only", reg10b.canMark === false && reg10b.canEdit === false && !!reg10b.readOnlyReason);
  const free10b = unmarkedDay("sec_10b");
  const r3 = await rejects(() => services.attendance.saveRegister("sec_10b", free10b, allPresent("sec_10b")));
  check("3. Rahul cannot MARK 10-B (service rejects)", r3.rejected && r3.code === "FORBIDDEN", r3.code);
  const r4 = await rejects(() => services.attendance.saveRegister("sec_10b", DAY, allPresent("sec_10b")));
  check("4. Rahul cannot EDIT 10-B (service rejects)", r4.rejected && r4.code === "FORBIDDEN", r4.code);
  const r4b = await rejects(() => services.attendance.saveRegister("sec_12a", DAY, allPresent("sec_12a")));
  check("4b. Rahul cannot write a class he doesn't teach at all (12-A)", r4b.rejected && r4b.code === "FORBIDDEN", r4b.code);
  await services.auth.logout();

  // ---------------- Sunita Rao (English in 10-A, class teacher of 10-C)
  await login("sunita.rao@asteracademy.edu", "Welcome@123", "teacher");
  const free10a = unmarkedDay("sec_10a");
  const r5 = await rejects(() => services.attendance.saveRegister("sec_10a", free10a, allPresent("sec_10a")));
  check("5. Subject teacher of 10-A (Sunita) cannot MARK 10-A", r5.rejected && r5.code === "FORBIDDEN", r5.code);
  const r6 = await rejects(() => services.attendance.saveRegister("sec_10a", DAY, allPresent("sec_10a")));
  check("6. Subject teacher of 10-A (Sunita) cannot EDIT 10-A", r6.rejected && r6.code === "FORBIDDEN", r6.code);
  const reg10c = await services.attendance.getRegister("sec_10c", DAY);
  const r6b = await rejects(() => services.attendance.saveRegister("sec_10c", DAY, { ...reg10c.entries! }));
  check("6b. Sunita CAN edit her own class 10-C", reg10c.canEdit && !r6b.rejected, r6b.code);
  await services.auth.logout();

  // ---------------- Admin
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const adminReg = await services.attendance.getRegister("sec_10a", DAY);
  const overview = await services.attendance.getDailyOverview(DAY);
  check("7. Admin can VIEW 10-A attendance + school overview", !!adminReg.entries && overview.rows.length === 15);
  check("7b. Admin register is read-only (canMark/canEdit false)", !adminReg.canMark && !adminReg.canEdit && !!adminReg.readOnlyReason);
  const r8 = await rejects(() => services.attendance.saveRegister("sec_10a", free10a, allPresent("sec_10a")));
  check("8. Admin cannot MARK 10-A", r8.rejected && r8.code === "FORBIDDEN", r8.code);
  const r9 = await rejects(() => services.attendance.saveRegister("sec_10a", DAY, allPresent("sec_10a")));
  check("9. Admin cannot EDIT 10-A", r9.rejected && r9.code === "FORBIDDEN", r9.code);
  await services.auth.logout();

  // ---------------- Student & guardian
  await login("student@asteracademy.edu", "Student@123", "student");
  const mine = await services.attendance.getStudentAttendance("stu_aarav");
  check("10. Student can view own attendance", mine.stats.total > 0);
  const r11 = await rejects(() => services.attendance.saveRegister("sec_10a", DAY, allPresent("sec_10a")));
  const r11b = await rejects(() => services.attendance.getRegister("sec_10a", DAY));
  check("11. Student cannot modify (or open the register)", r11.rejected && r11b.rejected, `${r11.code}/${r11b.code}`);
  await services.auth.logout();

  await login("guardian@asteracademy.edu", "Guardian@123", "student");
  const g1 = await services.attendance.getStudentAttendance("stu_aarav");
  const g2 = await services.attendance.getStudentAttendance("stu_ananya");
  check("12. Guardian can view both linked students", g1.stats.total > 0 && g2.stats.total > 0);
  const g3 = await rejects(() => services.attendance.getStudentAttendance("stu_045"));
  check("12b. Guardian cannot view an unlinked student", g3.rejected);
  const r13 = await rejects(() => services.attendance.saveRegister("sec_8b", DAY, allPresent("sec_8b")));
  check("13. Guardian cannot modify attendance", r13.rejected && r13.code === "FORBIDDEN", r13.code);
  await services.auth.logout();

  // ---------------- Ownership follows the class-teacher assignment
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const s10b = sec("sec_10b");
  await services.academics.updateSection("sec_10b", { room: s10b.room, capacity: s10b.capacity, classTeacherId: "t_kapoor" });
  await services.auth.logout();
  await login("meera.iyer@asteracademy.edu", "Welcome@123", "teacher");
  const r16 = await rejects(() => services.attendance.saveRegister("sec_10b", DAY, allPresent("sec_10b")));
  check("15b. After admin reassigns 10-B's class teacher, Meera loses edit rights", r16.rejected && r16.code === "FORBIDDEN", r16.code);
  await services.auth.logout();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

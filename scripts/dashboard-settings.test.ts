export {};

/**
 * Service and integration tests for Dashboard and Settings features.
 * Run with: npx tsx scripts/dashboard-settings.test.ts
 */

// ---- minimal browser storage shim ----
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

async function run() {
  const { services } = await import("../src/lib/services");
  const { readDb, writeDb, resetDb } = await import("../src/lib/store/db");

  // Reset DB to clean state before test run
  resetDb();

  const SERVER_STUDENTS: Record<string, { studentId: string; name: string }[]> = {
    "student@asteracademy.edu": [{ studentId: "cvx_aarav", name: "Aarav Sharma" }],
  };
  const login = (email: string, roleOrPassword: "admin" | "teacher" | "student" | string, roleArg?: "admin" | "teacher" | "student") => {
    const role = (roleArg ?? roleOrPassword) as "admin" | "teacher" | "student";
    const bound = services.auth.bindIdentity({
      // The bridge binds demo personas by Login ID within the demo school (users.session supplies both).
      loginId: readDb().users.find((u) => u.email.toLowerCase() === email.toLowerCase())?.loginId ?? null,
      school: { slug: "aster-academy" },
      email, role, displayName: email, permissionSets: [], students: SERVER_STUDENTS[email] ?? [],
    });
    if (!bound.ok) throw new Error(`could not bind ${email}`);
    return bound.user;
  };

  const rejects = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return { rejected: false, code: "" };
    } catch (e) {
      return { rejected: true, code: (e as { code?: string }).code ?? (e as Error).message };
    }
  };

  console.log("\n--- 1. Admin Dashboard Tests ---");

  // Admin login
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const adminDash = await services.dashboard.getAdminDashboard();

  check("Admin dashboard returns school information", adminDash.school.name === "Aster Academy");
  check("Admin dashboard returns student count > 0", adminDash.stats.students > 0, `${adminDash.stats.students} students`);
  check("Admin dashboard returns teaching staff count > 0", adminDash.stats.teachers > 0, `${adminDash.stats.teachers} teachers`);
  check("Admin dashboard returns pending fees metric", adminDash.stats.fees.outstanding >= 0);
  check("Admin dashboard returns fee collection rate", typeof adminDash.stats.fees.collectionRate === "number");
  check("Admin dashboard feeByClass contains grade breakdown", adminDash.feeByClass.length > 0);
  check("Admin dashboard contains published notices with audience labels", adminDash.notices.every((n) => typeof n.audienceLabel === "string"));

  // Unauthorized access check
  await login("student@asteracademy.edu", "Student@123", "student");
  const studentAdminDash = await rejects(() => services.dashboard.getAdminDashboard());
  check("Student cannot access Admin Dashboard — FORBIDDEN", studentAdminDash.rejected && studentAdminDash.code === "FORBIDDEN");

  console.log("\n--- 2. Teacher Dashboard Tests ---");

  await login("teacher@asteracademy.edu", "Teacher@123", "teacher");
  const teacherDash = await services.dashboard.getTeacherDashboard();

  check("Teacher dashboard returns designated teacher name", teacherDash.teacher.name.length > 0);
  check("Teacher dashboard returns classes schedule", Array.isArray(teacherDash.classes));
  check("Teacher dashboard identifies attendance tasks", Array.isArray(teacherDash.attendanceTasks));
  check("Teacher dashboard returns student count for assigned classes", teacherDash.studentCount > 0);

  // Student trying to access teacher dashboard
  await login("student@asteracademy.edu", "Student@123", "student");
  const studentTeacherDash = await rejects(() => services.dashboard.getTeacherDashboard());
  check("Student cannot access Teacher Dashboard — FORBIDDEN", studentTeacherDash.rejected && studentTeacherDash.code === "FORBIDDEN");

  console.log("\n--- 3. Student Dashboard Tests ---");

  // Student login
  const studentUser = await login("student@asteracademy.edu", "Student@123", "student");
  const studentId = studentUser.studentIds?.[0];
  check("Student user has linked student ID", !!studentId);

  if (studentId) {
    const studentDash = await services.dashboard.getStudentDashboard(studentId);
    check("Student dashboard returns student profile info", studentDash.student.name.length > 0);
    check("Student dashboard returns attendance percentage", typeof studentDash.attendance.percentage === "number");
    check("Student dashboard returns fee summary with standing", typeof studentDash.fees.outstanding === "number" && !!studentDash.fees.standing);
    check("Student dashboard notices do NOT contain teacher-only notices", studentDash.notices.every((n) => n.audience.scope !== "teachers"));

    // Student cannot access unlinked student's dashboard
    const unauthorizedStudentDash = await rejects(() => services.dashboard.getStudentDashboard("stu_unlinked_999"));
    check("Student cannot access unlinked student's dashboard — FORBIDDEN", unauthorizedStudentDash.rejected && unauthorizedStudentDash.code === "FORBIDDEN");
  }

  console.log("\n--- 4. School Settings & Profile Tests ---");

  // Public profile check (no authentication required)
  const publicProfile = await services.school.getPublicProfile();
  check("Public school profile is accessible unauthenticated", publicProfile.name === "Aster Academy");

  // Admin updates school information
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const schoolUpdate = await services.school.updateInfo({
    name: "Aster Academy International",
    tagline: "Inspiring Excellence & Integrity",
    address: "742 Evergreen Terrace, Sector 5",
    phone: "+91 98765 43210",
    email: "info@asteracademy.edu",
    website: "https://asteracademy.edu",
    affiliation: "CBSE Affiliated No. 1030456",
    principalName: "Dr. Eleanor Vance",
  });
  check("Admin can update school info", schoolUpdate.ok === true);

  const updatedSchool = await services.lookup.getSchool();
  check("Updated school name persists", updatedSchool.school.name === "Aster Academy International");

  // Validation on school email
  const badEmailUpdate = await rejects(() =>
    services.school.updateInfo({
      name: "Aster Academy",
      tagline: "",
      address: "",
      phone: "",
      email: "not-an-email",
      website: "",
      affiliation: "",
      principalName: "",
    })
  );
  check("Invalid email in school info is rejected", badEmailUpdate.rejected);

  // Non-admin cannot update settings
  await login("teacher@asteracademy.edu", "Teacher@123", "teacher");
  const teacherSettingsUpdate = await rejects(() =>
    services.school.updateSettings({
      ...updatedSchool.school.settings,
      lowAttendanceThreshold: 65,
    })
  );
  check("Teacher cannot update school settings — FORBIDDEN", teacherSettingsUpdate.rejected && teacherSettingsUpdate.code === "FORBIDDEN");

  // Admin updates settings: low attendance threshold validation
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const invalidThreshold = await rejects(() =>
    services.school.updateSettings({
      ...updatedSchool.school.settings,
      lowAttendanceThreshold: 30, // must be between 50 and 100
    })
  );
  check("Out-of-range low attendance threshold (<50) is rejected", invalidThreshold.rejected);

  // Admin successfully updates settings
  const validSettingsUpdate = await services.school.updateSettings({
    ...updatedSchool.school.settings,
    lowAttendanceThreshold: 80,
    attendanceLateCountsAsPresent: false,
    notifications: {
      ...updatedSchool.school.settings.notifications,
      feeReminders: true,
      attendanceAlerts: true,
    },
  });
  check("Admin can update school settings and notification preferences", validSettingsUpdate.ok === true);

  console.log("\n--- 5. Settings Integration with Dashboard Tests ---");

  // When lowAttendanceThreshold is updated to 80, student dashboard reflects this threshold
  if (studentId) {
    await login("student@asteracademy.edu", "Student@123", "student");
    const updatedStudentDash = await services.dashboard.getStudentDashboard(studentId);
    check("Student dashboard immediately reflects updated lowAttendanceThreshold (80%)", updatedStudentDash.attendance.threshold === 80);
  }

  // Profile retrieval
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const adminProfile = await services.school.getMyProfile();
  check("Admin can retrieve own profile", adminProfile.role === "admin" && adminProfile.kind === "admin");

  await login("teacher@asteracademy.edu", "Teacher@123", "teacher");
  const teacherProfile = await services.school.getMyProfile();
  check("Teacher profile includes teacher details and name", teacherProfile.kind === "teacher" && teacherProfile.teacherId.startsWith("t_"));

  // Reset database back to default clean demo state
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  await services.school.resetDemoData();
  const resetSchool = await services.lookup.getSchool();
  check("resetDemoData restores original school name", resetSchool.school.name === "Aster Academy");

  console.log(`\nResults: ${results.filter((r) => r.ok).length}/${results.length} passed\n`);
  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});

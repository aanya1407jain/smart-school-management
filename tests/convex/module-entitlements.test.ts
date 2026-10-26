/**
 * P1 — school module entitlements (convex/core/modules.ts, convex/model/modules.ts,
 * convex/schoolModules.ts). Every check here calls the backend directly: no UI is
 * involved, so hiding a page is never what makes these pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODULE_KEYS, MODULES, selectionProblems, type ModuleKey } from "../../convex/core/modules";
import { moduleStateOf, resolveModuleState } from "../../convex/model/modules";
import { canAccessRoute, getNavigationForUser } from "../../src/lib/permissions";
import { as, createSchool, errorCode, makeTest, pastMonday, type T } from "./fixtures";

type School = Awaited<ReturnType<typeof createSchool>>;
const ALL = [...MODULE_KEYS];
const without = (...off: ModuleKey[]) => ALL.filter((k) => !off.includes(k));

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  return { t, A, B };
}

const setModules = (t: T, school: string, enabled: ModuleKey[], extra: { dryRun?: boolean } = {}) =>
  t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: school, enabled, updatedBy: "test-operator", reason: "P1 test", ...extra });

const plan = {
  name: "Tuition 2026-27",
  components: [{ label: "Tuition", amountMinor: 30000 }],
  installments: [
    { label: "Term 1", dueDate: "2026-05-01", amountMinor: 10000 },
    { label: "Term 2", dueDate: "2026-09-01", amountMinor: 10000 },
    { label: "Term 3", dueDate: "2027-01-01", amountMinor: 10000 },
  ],
};
const admit = (A: School, firstName: string) => ({
  firstName, lastName: "Menon", gender: "female" as const, dateOfBirth: "2012-05-14", admissionDate: "2026-06-01", address: "12, 4th Main, Bengaluru",
  classId: A.classId, sectionId: A.sectionA, parentContact: { name: "Kavita Menon", relation: "Mother", phone: "98450 77777" },
});

/** Representative reads and writes per module, by the role that would normally be allowed. */
function moduleCalls(t: T, A: School) {
  const date = pastMonday();
  const admin = () => as(t, A.users.admin);
  const ct = () => as(t, A.users.classTeacher);
  const st = () => as(t, A.users.student);
  return {
    finance: [
      ["fees.listStructures (admin read)", async () => (await admin()).query(api.fees.listStructures, {})],
      ["fees.createStructure (admin write)", async () => (await admin()).mutation(api.fees.createStructure, { ...plan, name: `Plan ${Math.random()}`, classIds: [A.classId] })],
      ["reports.feeSummary (admin report)", async () => (await admin()).query(api.reports.feeSummary, {})],
      ["studentPortal.myFees (student read)", async () => (await st()).query(api.studentPortal.myFees, {})],
    ],
    academics: [
      ["exams.list (admin read)", async () => (await admin()).query(api.exams.list, {})],
      ["exams.create (admin write)", async () => (await admin()).mutation(api.exams.create, { name: `Term ${Math.random()}`, classIds: [A.classId], startDate: "2026-09-01", endDate: "2026-09-10" })],
      ["timetable.listPeriods (admin read)", async () => (await admin()).query(api.timetable.listPeriods, {})],
      ["homework.listMine (teacher read)", async () => (await ct()).query(api.homework.listMine, {})],
      ["studentPortal.myTimetable (student read)", async () => (await st()).query(api.studentPortal.myTimetable, {})],
      ["studentPortal.myResults (student read)", async () => (await st()).query(api.studentPortal.myResults, {})],
    ],
    attendance: [
      ["attendance.getByDate (class teacher read)", async () => (await ct()).query(api.attendance.getByDate, { sectionId: A.sectionA, date, today: date })],
      ["attendance.mark (class teacher write)", async () => (await ct()).mutation(api.attendance.mark, { sectionId: A.sectionA, date, entries: [{ studentId: A.studentA, status: "present" as const }] })],
      ["staff.staffAttendanceByDate (admin read)", async () => (await admin()).query(api.staff.staffAttendanceByDate, { date })],
      ["staff.myLeave (teacher read)", async () => (await ct()).query(api.staff.myLeave, {})],
      ["attendance.studentHistory (student read)", async () => (await st()).query(api.attendance.studentHistory, { studentId: A.studentA })],
    ],
    administration: [
      ["notices.listManaged (admin read)", async () => (await admin()).query(api.notices.listManaged, {})],
      ["notices.createDraft (admin write)", async () => (await admin()).mutation(api.notices.createDraft, { title: "Trip", body: "Details", type: "notice", priority: "normal", publishDate: "2026-04-01", audience: { kind: "all" } })],
      ["notices.feed (teacher read)", async () => (await ct()).query(api.notices.feed, {})],
      ["events.list (admin read)", async () => (await admin()).query(api.events.list, { from: "2026-04-01", to: "2026-05-01" })],
      ["reports.studentStatistics (admin report)", async () => (await admin()).query(api.reports.studentStatistics, {})],
      ["studentPortal.myNotices (student read)", async () => (await st()).query(api.studentPortal.myNotices, { today: "2026-10-12" })],
    ],
    students: [
      ["academics.studentCounts (admin read)", async () => (await admin()).query(api.academics.studentCounts, {})],
      ["academics.createStudentWithEnrollment (admin write)", async () => (await admin()).mutation(api.academics.createStudentWithEnrollment, admit(A, `S${Math.floor(Math.random() * 1e6)}`))],
      ["academics.enrollmentHistory (admin read)", async () => (await admin()).query(api.academics.enrollmentHistory, { studentId: A.studentA })],
      ["academics.listUnenrolledStudents (admin read)", async () => (await admin()).query(api.academics.listUnenrolledStudents, { academicYearId: A.yearId })],
    ],
  } satisfies Record<ModuleKey, [string, () => Promise<unknown>][]>;
}

describe("module catalogue", () => {
  test("exactly the five documented keys, with labels and dependencies", () => {
    expect(MODULE_KEYS).toEqual(["students", "academics", "attendance", "finance", "administration"]);
    for (const k of MODULE_KEYS) {
      expect(MODULES[k].label.length).toBeGreaterThan(3);
      expect(MODULES[k].legacyDefault).toBe(true); // the five original modules
    }
    expect(MODULES.finance.requires).toEqual(["students"]);
    expect(MODULES.academics.requires).toEqual(["students"]);
    expect(MODULES.attendance.requires).toEqual(["students"]);
    expect(MODULES.administration.requires).toEqual([]);
  });

  test("selection validation: unknown, repeated and missing-dependency selections are reported, never auto-fixed", () => {
    expect(selectionProblems(ALL)).toEqual([]);
    expect(selectionProblems([])).toEqual([]);
    expect(selectionProblems(["payroll"])).toEqual(['Unknown module "payroll".']);
    expect(selectionProblems(["students", "students"])).toEqual(['Module "students" is listed twice.']);
    expect(selectionProblems(["finance"])).toEqual(["Accounts & Finance requires Student Management."]);
  });
});

describe("operator changes (internal mutation)", () => {
  test("invalid keys and broken dependencies are rejected and nothing is written", async () => {
    const { t } = await setup();
    await expect(t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ["payroll"] as never, updatedBy: "op", reason: "x" })).rejects.toThrow(/Validator/);
    expect(await errorCode(setModules(t, "alpha", ["finance", "administration"]))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(setModules(t, "alpha", ["students", "students"]))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ALL, updatedBy: " ", reason: "x" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(t.mutation(internal.schoolModules.setSchoolModules, { schoolSlug: "alpha", enabled: ALL, updatedBy: "op", reason: "" }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(setModules(t, "nowhere", ALL))).toBe("NOT_FOUND");
    expect(await t.run(async (ctx) => (await ctx.db.query("schoolModules").collect()).length)).toBe(0);
  });

  test("a valid change writes one row per key, is audited with before/after, and a dry run writes nothing", async () => {
    const { t, A } = await setup();
    const dry = await setModules(t, "alpha", without("finance"), { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, before: { mode: "legacy", enabled: ALL }, disabledNow: ["finance"] });
    expect(await t.run(async (ctx) => (await ctx.db.query("schoolModules").collect()).length)).toBe(0);

    const res = await setModules(t, "alpha", without("finance"));
    expect(res).toMatchObject({ dryRun: false, changed: true, mode: "configured", enabled: without("finance"), disabled: ["finance"] });
    const rows = await t.run((ctx) => ctx.db.query("schoolModules").withIndex("by_school", (q) => q.eq("schoolId", A.schoolId)).collect());
    expect(rows.map((r) => [r.module, r.enabled]).sort()).toEqual(ALL.map((k) => [k, k !== "finance"]).sort());
    expect(rows.every((r) => r.updatedBy === "test-operator" && r.reason === "P1 test")).toBe(true);
    const audits = await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === "school.modules_changed"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ schoolId: A.schoolId, entity: { table: "schools", id: A.schoolId } });
    expect(audits[0].actorUserId).toBeUndefined(); // the operator is not a school member
    expect(audits[0].metadata).toMatchObject({ before: { mode: "legacy", enabled: ALL }, after: { mode: "configured", enabled: without("finance") }, disabledNow: ["finance"], enabledNow: [], updatedBy: "test-operator" });
    // Setting the same list again changes nothing and writes no audit row.
    expect(await setModules(t, "alpha", without("finance"))).toMatchObject({ changed: false });
    expect(await t.run(async (ctx) => (await ctx.db.query("auditLogs").collect()).filter((a) => a.action === "school.modules_changed").length)).toBe(1);
    expect(await t.query(internal.schoolModules.getSchoolModules, { schoolSlug: "alpha" })).toMatchObject({ mode: "configured", enabled: without("finance"), disabled: ["finance"], problems: [] });
  });

  test("school accounts cannot change entitlements: only internal functions write them, and settings refuse a modules field", async () => {
    const { t, A } = await setup();
    // The operator functions are internal; no public function in the backend writes the table.
    const dir = join(__dirname, "../../convex");
    const src = readFileSync(join(dir, "schoolModules.ts"), "utf8");
    expect([...src.matchAll(/export const (\w+) = (\w+)\(/g)].map((m) => m[2])).toEqual(["internalQuery", "internalMutation"]);
    const writers: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) { if (f.name !== "_generated") walk(join(d, f.name)); continue; }
        if (!f.name.endsWith(".ts")) continue;
        const text = readFileSync(join(d, f.name), "utf8");
        if (/(insert|patch|replace|delete)\(\s*"schoolModules"/.test(text) || /db\.(insert)\("schoolModules"/.test(text)) writers.push(f.name);
      }
    };
    walk(dir);
    expect(writers).toEqual(["modules.ts"]); // convex/model/modules.ts applyModuleSelection, used only by internal operator paths
    // Even the Principal (all permissions) cannot slip modules into the settings mutation.
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.schools.updateSettings, { modules: ["finance"] } as never))).toMatch(/^THROWN: .*Validator|ArgumentValidationError/);
    expect(await t.run(async (ctx) => (await ctx.db.query("schoolModules").collect()).length)).toBe(0);
  });
});

describe("enforcement on the server", () => {
  test.each(MODULE_KEYS)("disabling %s rejects its reads and writes with MODULE_DISABLED, whatever the caller's permissions", async (key) => {
    const { t, A } = await setup();
    // Dependants must go too (validated): turning off students turns off the three that require it.
    const off: ModuleKey[] = key === "students" ? ["students", "academics", "attendance", "finance"] : [key];
    await setModules(t, "alpha", without(...off));
    for (const [name, call] of moduleCalls(t, A)[key]) {
      expect([name, await errorCode(call())]).toEqual([name, "MODULE_DISABLED"]);
    }
  });

  test.each(MODULE_KEYS)("with %s enabled the same calls succeed for the right role", async (key) => {
    const { t, A } = await setup();
    await setModules(t, "alpha", ALL);
    for (const [name, call] of moduleCalls(t, A)[key]) {
      expect([name, await errorCode(call())]).toEqual([name, "NO_ERROR"]);
    }
  });

  test("an enabled module grants no permission: role and record rules still apply", async () => {
    const { t, A, B } = await setup();
    await setModules(t, "alpha", ALL);
    const teacher = await as(t, A.users.classTeacher);
    const student = await as(t, A.users.student);
    const admin = await as(t, A.users.admin);
    expect(await errorCode(teacher.query(api.fees.listStructures, {}))).toBe("FORBIDDEN");
    expect(await errorCode(student.mutation(api.exams.create, { name: "X", classIds: [A.classId], startDate: "2026-09-01", endDate: "2026-09-10" }))).toBe("FORBIDDEN");
    expect(await errorCode(student.query(api.studentPortal.myFees, { studentId: A.studentB }))).toBe("NOT_FOUND"); // not their record
    // Attendance stays class-teacher-only: the Principal cannot mark even with the module on.
    expect(await errorCode(admin.mutation(api.attendance.mark, { sectionId: A.sectionA, date: pastMonday(), entries: [{ studentId: A.studentA, status: "present" }] }))).toBe("FORBIDDEN");
    // Tenant isolation is unchanged.
    expect(await errorCode(admin.query(api.academics.enrollmentHistory, { studentId: B.studentA }))).toBe("NOT_FOUND");
  });

  test("core functions keep working with every module off; mixed views leave the disabled parts out", async () => {
    const { t, A } = await setup();
    await setModules(t, "alpha", []);
    const admin = await as(t, A.users.admin);
    const teacher = await as(t, A.users.classTeacher);
    const student = await as(t, A.users.student);
    const s = await admin.query(api.users.session, {});
    expect(s.status === "signedIn" && s.viewer.modules).toEqual([]);
    expect((await admin.query(api.academics.listSections, {})).length).toBe(2);
    expect(await errorCode(admin.query(api.notifications.list, {}))).toBe("NO_ERROR");
    const dash = await admin.query(api.reports.adminDashboard, {});
    expect(dash.modules).toEqual([]);
    expect(dash.fees).toBeNull();
    expect(dash.overview).toMatchObject({ students: null, teachersOnLeave: null, attendance: null, attendanceTrend: [], upcomingExams: [], notices: [], tasks: { unmarkedToday: null, pendingLeave: null } });
    const profile = await admin.query(api.academics.getStudentProfile, { studentId: A.studentA });
    expect(profile).toMatchObject({ modules: [], fees: null, attendance: [], results: [], homework: [] });
    expect(profile?.parentContacts.map((c) => c.name)).toEqual(["Parent Contact"]); // core data still there
    const tdash = await teacher.query(api.dashboards.teacherOverview, {});
    expect(tdash).toMatchObject({ modules: [], todayLessons: [], homeworkToReview: [], marksTasks: [] });
    expect(tdash.classTeacherOf.every((c) => c.registerMarked === null)).toBe(true);
    expect((await student.query(api.studentPortal.myProfile, {})).state).toBe("ok");
  });

  test("files follow the module of their kind", async () => {
    const { t, A } = await setup();
    const fileId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
      return await ctx.db.insert("files", { schoolId: A.schoolId, storageId, kind: "student_document", ownerType: "student", ownerId: A.studentA, fileName: "tc.pdf", contentType: "application/pdf", size: 8, uploadedByUserId: A.users.admin });
    });
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.query(api.files.getUrl, { fileId }))).toBe("NO_ERROR");
    await setModules(t, "alpha", ["administration"]);
    expect(await errorCode(admin.query(api.files.getUrl, { fileId }))).toBe("MODULE_DISABLED");
    expect(await errorCode(admin.query(api.files.listForOwner, { ownerType: "student", ownerId: A.studentA }))).toBe("MODULE_DISABLED");
    expect(await errorCode(admin.mutation(api.files.remove, { fileId }))).toBe("MODULE_DISABLED");
    expect(await t.run((ctx) => ctx.db.get(fileId))).not.toBeNull();
  });

  test("background jobs skip a disabled module", async () => {
    const { t, A } = await setup();
    await setModules(t, "alpha", without("finance", "administration"));
    expect(await t.mutation(internal.feeReminders.remindSchool, { schoolId: A.schoolId, cursor: null, today: "2026-05-01" })).toMatchObject({ sent: 0, skipped: "module_disabled" });
    const noticeId = await t.run((ctx) => ctx.db.insert("notices", { schoolId: A.schoolId, title: "T", body: "B", type: "notice", priority: "normal", audience: { kind: "all" }, status: "published", publishDate: "2026-04-01", createdByUserId: A.users.admin }));
    expect(await t.mutation(internal.notices.notifyOnPublishDate, { noticeId, exceptUserId: null })).toEqual({ notified: 0, skipped: "module_disabled" });
    expect(await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length)).toBe(0);
  });
});

describe("tenant isolation of entitlements", () => {
  test("one school's configuration never affects another school", async () => {
    const { t, A, B } = await setup();
    await setModules(t, "alpha", without("finance"));
    const adminA = await as(t, A.users.admin);
    const adminB = await as(t, B.users.admin);
    expect(await errorCode(adminA.query(api.fees.listStructures, {}))).toBe("MODULE_DISABLED");
    expect(await errorCode(adminB.query(api.fees.listStructures, {}))).toBe("NO_ERROR");
    expect(await errorCode(adminB.mutation(api.fees.createStructure, { ...plan, classIds: [B.classId] }))).toBe("NO_ERROR");
    const sa = await adminA.query(api.users.session, {});
    const sb = await adminB.query(api.users.session, {});
    expect(sa.status === "signedIn" && sa.viewer.modules).toEqual(without("finance"));
    expect(sb.status === "signedIn" && sb.viewer.modules).toEqual(ALL);
    expect(await t.run(async (ctx) => (await ctx.db.query("schoolModules").collect()).every((r) => r.schoolId === A.schoolId))).toBe(true);
  });
});

describe("default policy for missing and malformed configuration", () => {
  const state = async (t: T, schoolId: Id<"schools">) => {
    const s = await t.run(async (ctx) => { const r = await moduleStateOf(ctx, schoolId); return { mode: r.mode, enabled: [...r.enabled], problems: r.problems }; });
    return { ...s, enabled: new Set(s.enabled) };
  };

  test("no rows = legacy: the five original modules (and only modules marked legacyDefault)", async () => {
    const { t, A } = await setup();
    const s = await state(t, A.schoolId);
    expect(s.mode).toBe("legacy");
    expect([...s.enabled]).toEqual(MODULE_KEYS.filter((k) => MODULES[k].legacyDefault));
  });

  test("configured but incomplete: a key without a row is disabled", async () => {
    const { t, A } = await setup();
    await t.run(async (ctx) => {
      for (const k of ["students", "academics", "attendance", "administration"] as const) {
        await ctx.db.insert("schoolModules", { schoolId: A.schoolId, module: k, enabled: true, updatedAt: 1, updatedBy: "hand", reason: "x" });
      }
    });
    const s = await state(t, A.schoolId);
    expect(s.mode).toBe("configured");
    expect(s.enabled.has("finance")).toBe(false);
    expect(s.problems.join(" ")).toMatch(/No setting for "finance"/);
    expect(await errorCode((await as(t, A.users.admin)).query(api.fees.listStructures, {}))).toBe("MODULE_DISABLED");
  });

  test("malformed: conflicting duplicate rows and a broken dependency fail closed", async () => {
    const { t, A } = await setup();
    await setModules(t, "alpha", ALL);
    await t.run(async (ctx) => {
      // A second, conflicting row for academics, and students switched off by hand while finance stays on.
      await ctx.db.insert("schoolModules", { schoolId: A.schoolId, module: "academics", enabled: false, updatedAt: 2, updatedBy: "hand", reason: "x" });
      const studentsRow = (await ctx.db.query("schoolModules").withIndex("by_school_module", (q) => q.eq("schoolId", A.schoolId).eq("module", "students")).first())!;
      await ctx.db.patch(studentsRow._id, { enabled: false });
    });
    const s = await state(t, A.schoolId);
    expect([...s.enabled]).toEqual(["administration"]); // academics: conflict; attendance & finance: need students
    expect(s.problems.join(" ")).toMatch(/2 settings for "academics"/);
    expect(s.problems.join(" ")).toMatch(/"finance" is off because it requires "students"/);
  });
});

describe("future modules and dependencies", () => {
  // A hypothetical catalogue with a module the product does not have yet ("library", legacyDefault: false).
  const future = {
    keys: ["students", "finance", "library"] as const,
    defs: {
      students: { requires: [] as const, legacyDefault: true },
      finance: { requires: ["students"] as const, legacyDefault: true },
      library: { requires: ["students"] as const, legacyDefault: false },
    },
  };

  test("a module added later is off for unconfigured AND already-configured schools until an operator enables it", () => {
    expect([...resolveModuleState([], future).enabled]).toEqual(["students", "finance"]);
    const configured = [{ module: "students", enabled: true }, { module: "finance", enabled: true }];
    const s = resolveModuleState(configured, future);
    expect(s.enabled.has("library")).toBe(false);
    expect(s.problems.join(" ")).toMatch(/No setting for "library"/);
    expect([...resolveModuleState([...configured, { module: "library", enabled: true }], future).enabled]).toEqual(["students", "finance", "library"]);
  });

  test("unknown stored keys are ignored and reported, never enabled", () => {
    const s = resolveModuleState([{ module: "students", enabled: true }, { module: "payroll", enabled: true }], future);
    expect([...s.enabled]).toEqual(["students"]);
    expect(s.problems.join(" ")).toMatch(/Unknown module "payroll"/);
  });

  test("turning Student Management off while its dependants stay on is rejected; nothing is changed or auto-enabled", async () => {
    const { t, A } = await setup();
    await setModules(t, "alpha", ALL);
    const rowsBefore = await t.run((ctx) => ctx.db.query("schoolModules").collect());
    for (const sel of [without("students"), ["academics", "administration"] as ModuleKey[], ["attendance"] as ModuleKey[], ["finance"] as ModuleKey[]]) {
      expect([sel.join(","), await errorCode(setModules(t, "alpha", sel))]).toEqual([sel.join(","), "INVALID_ARGUMENT"]);
    }
    expect(await t.run((ctx) => ctx.db.query("schoolModules").collect())).toEqual(rowsBefore);
    // Turning off students together with its dependants is accepted (nothing is enabled in its place).
    expect(await setModules(t, "alpha", ["administration"])).toMatchObject({ enabled: ["administration"], disabled: ["students", "academics", "attendance", "finance"] });
    expect(await errorCode((await as(t, A.users.admin)).query(api.academics.studentCounts, {}))).toBe("MODULE_DISABLED");
  });
});

describe("data is preserved while a module is off", () => {
  test("disabling Finance keeps every fee record; re-enabling restores the same ledger to authorised users", async () => {
    const { t, A } = await setup();
    const admin = await as(t, A.users.admin);
    const student = await as(t, A.users.student);
    const { structureId } = await admin.mutation(api.fees.createStructure, { ...plan, classIds: [A.classId] });
    await admin.mutation(api.fees.setStructureStatus, { structureId, status: "active" });
    await admin.mutation(api.fees.assignStructure, { structureId, target: { kind: "students", studentIds: [A.studentA] } });
    await admin.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 15000, method: "cash", paidOn: "2026-06-01", clientRequestId: "req-0000001" });
    const ledgerBefore = await admin.query(api.fees.studentLedger, { studentId: A.studentA });
    const snapshot = () => t.run(async (ctx) => ({
      structures: await ctx.db.query("feeStructures").collect(),
      obligations: await ctx.db.query("studentFees").collect(),
      payments: await ctx.db.query("feePayments").collect(),
      receipts: await ctx.db.query("receipts").collect(),
    }));
    const before = await snapshot();
    expect(before.payments).toHaveLength(1);

    await setModules(t, "alpha", without("finance"));
    expect(await errorCode(admin.query(api.fees.studentLedger, { studentId: A.studentA }))).toBe("MODULE_DISABLED");
    expect(await errorCode(admin.mutation(api.fees.recordPayment, { studentId: A.studentA, amountMinor: 100, method: "cash", paidOn: "2026-06-02", clientRequestId: "req-0000002" }))).toBe("MODULE_DISABLED");
    expect(await errorCode(student.query(api.studentPortal.myFees, {}))).toBe("MODULE_DISABLED");
    expect(await snapshot()).toEqual(before); // nothing deleted or changed

    await setModules(t, "alpha", ALL);
    expect(await admin.query(api.fees.studentLedger, { studentId: A.studentA })).toEqual(ledgerBefore);
    const mine = await student.query(api.studentPortal.myFees, {});
    expect(mine.state === "ok" && mine.totals.paidMinor).toBe(15000);
    // Still no access for roles that never had it.
    expect(await errorCode((await as(t, A.users.classTeacher)).query(api.fees.studentLedger, { studentId: A.studentA }))).not.toBe("NO_ERROR");
  });
});

describe("source inventory: every public function is classified", () => {
  // Module files: the module their functions belong to, and the named exceptions that stay core.
  const MODULE_FILES: Record<string, { module: ModuleKey; core?: string[]; only?: string[] }> = {
    "fees.ts": { module: "finance" },
    "exams.ts": { module: "academics" },
    "timetable.ts": { module: "academics" },
    "homework.ts": { module: "academics" },
    "attendance.ts": { module: "attendance" },
    "staff.ts": { module: "attendance", core: ["listTeachers", "updateTeacher"] },
    "notices.ts": { module: "administration" },
    "events.ts": { module: "administration" },
    "reports.ts": { module: "administration", core: ["adminDashboard"] },
    "academics.ts": { module: "students", only: ["listUnenrolledStudents", "enrollStudent", "endEnrollment", "createStudentWithEnrollment", "updateStudentProfile", "enrollmentHistory", "rollNumberHistory", "studentCounts"] },
    "imports.ts": { module: "students", only: ["previewStudents", "commitStudentRows"] },
    "studentLifecycle.ts": { module: "students" },
    "admissionRegister.ts": { module: "students" },
  };
  // studentPortal.ts maps functions to several modules.
  const PORTAL: Record<string, ModuleKey | "core"> = { myProfile: "core", myCertificates: "students", myTimetable: "academics", myHomework: "academics", myResults: "academics", myFees: "finance", myNotices: "administration" };
  // Core files: no module (mixed views gate their parts inside: files.ts by kind, dashboards.ts by panel).
  const CORE_FILES = ["account.ts", "accounts.ts", "audit.ts", "bulkAccounts.ts", "dashboards.ts", "files.ts", "memberships.ts", "notifications.ts", "profile.ts", "schools.ts", "tcVerification.ts", "users.ts"];

  const dir = join(__dirname, "../../convex");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const exportsOf = (file: string) => [...readFileSync(join(dir, file), "utf8").matchAll(/export const (\w+) = (\w+)\(/g)].map((m) => ({ name: m[1], builder: m[2] }));
  const isPublic = (b: string) => /^(school(Query|Mutation|Action)|query|mutation|action|\w+(Query|Mutation))$/.test(b) && !/^internal/.test(b);
  const moduleOf = (builder: string): ModuleKey | "core" => {
    const m = /^(\w+?)(Query|Mutation)$/.exec(builder);
    return m && (MODULE_KEYS as readonly string[]).includes(m[1]) ? (m[1] as ModuleKey) : "core";
  };

  test("no file with public functions is left unclassified", () => {
    const withPublic = files.filter((f) => exportsOf(f).some((e) => isPublic(e.builder)));
    const known = new Set([...Object.keys(MODULE_FILES), ...CORE_FILES, "studentPortal.ts", "auth.ts"]);
    expect(withPublic.filter((f) => !known.has(f))).toEqual([]);
  });

  test.each(Object.entries(MODULE_FILES))("%s: functions use the module wrapper (exceptions are core)", (file, spec) => {
    for (const e of exportsOf(file).filter((x) => isPublic(x.builder))) {
      const expected = spec.only ? (spec.only.includes(e.name) ? spec.module : "core") : (spec.core?.includes(e.name) ? "core" : spec.module);
      expect([file, e.name, moduleOf(e.builder)]).toEqual([file, e.name, expected]);
    }
  });

  test("studentPortal.ts functions use their module's wrapper", () => {
    const found = Object.fromEntries(exportsOf("studentPortal.ts").filter((x) => isPublic(x.builder)).map((e) => [e.name, moduleOf(e.builder)]));
    expect(found).toEqual(PORTAL);
  });

  test("core files use no module wrapper", () => {
    for (const f of CORE_FILES) for (const e of exportsOf(f).filter((x) => isPublic(x.builder))) expect([f, e.name, moduleOf(e.builder)]).toEqual([f, e.name, "core"]);
  });

  test("each report requires the module its data comes from", () => {
    const src = readFileSync(join(dir, "reports.ts"), "utf8");
    for (const [name, mod] of [["enrollmentSummary", "students"], ["studentStatistics", "students"], ["attendanceSummary", "attendance"], ["attendanceReport", "attendance"], ["lowAttendance", "attendance"], ["feeSummary", "finance"], ["examPerformance", "academics"]]) {
      const body = src.slice(src.indexOf(`export const ${name} =`), src.indexOf(`export const ${name} =`) + 600);
      expect([name, body.includes(`requireModule(ctx, ctx.actor.schoolId, "${mod}")`)]).toEqual([name, true]);
    }
  });
});

describe("frontend navigation and route guard (UI convenience, not the boundary)", () => {
  test("disabled modules disappear from navigation and their routes report module_disabled", () => {
    const admin = { role: "admin" as const, permissionSets: [], modules: without("finance") };
    const hrefs = getNavigationForUser(admin).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/admin/fees");
    expect(hrefs).toContain("/admin/students");
    expect(canAccessRoute(admin, "/admin/fees")).toBe("module_disabled");
    expect(canAccessRoute(admin, "/admin/fees/abc123")).toBe("module_disabled");
    expect(canAccessRoute(admin, "/admin/students")).toBe("allowed");
    expect(canAccessRoute(admin, "/admin/settings")).toBe("allowed"); // core
    const student = { role: "student" as const, permissionSets: [], modules: ["students" as const] };
    expect(canAccessRoute(student, "/student/fees")).toBe("module_disabled");
    expect(canAccessRoute(student, "/student/profile")).toBe("allowed");
    // Permissions still decide first: a teacher is forbidden from admin pages whatever the modules.
    expect(canAccessRoute({ role: "teacher", permissionSets: [], modules: ALL }, "/admin/fees")).toBe("forbidden");
    // Modules not known yet → module pages hidden (fail-closed), core pages still listed.
    const unknown = getNavigationForUser({ role: "admin", permissionSets: [] }).flatMap((g) => g.items.map((i) => i.href));
    expect(unknown).toContain("/admin/settings");
    expect(unknown).not.toContain("/admin/fees");
  });
});

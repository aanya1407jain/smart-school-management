/**
 * Staff permissions (core/grants.ts, memberships.setPermissions): the
 * Principal's module × action grants, enforced on the server.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ACCOUNTANT_ACCESS, CAPABILITIES, GRANT_PRESETS, OFFICE_BASE, grantProblems, isAccountantGrants, permissionsFromGrants } from "../../convex/core/grants";
import { ROLE_PERMISSIONS, resolvePermissions } from "../../convex/core/permissions";
import { as, createSchool, errorCode, makeTest, pastMonday } from "./fixtures";

describe("grant resolution (pure)", () => {
  test("an admin membership without grants is a full administrator", () => {
    expect(resolvePermissions("admin", [], {})).toEqual(new Set(ROLE_PERMISSIONS.admin));
    expect(resolvePermissions("admin", [], {}).has("students:lifecycle")).toBe(true);
  });

  test("an admin membership WITH grants gets exactly the office base + its grants", () => {
    expect(resolvePermissions("admin", [], { grants: [] })).toEqual(new Set(OFFICE_BASE));
    const accountant = GRANT_PRESETS.find((p) => p.key === "accountant")!.grants;
    const set = resolvePermissions("admin", [], { grants: accountant });
    expect(set.has("fees:manage")).toBe(true);
    expect(set.has("students:read:all")).toBe(true);
    for (const p of ["users:manage", "settings:manage", "audit:read", "staff:manage", "academics:manage", "students:write", "attendance:read:all"] as const) {
      expect(set.has(p), p).toBe(false);
    }
  });

  test("grants beat the legacy accountant set; principal-only permissions are never grantable", () => {
    const everything = Object.entries(CAPABILITIES).map(([module, cells]) => ({
      module,
      actions: Object.entries(cells).filter(([, c]) => c.kind === "grantable").map(([a]) => a),
    }));
    const set = permissionsFromGrants(everything, false);
    for (const p of ["users:manage", "settings:manage", "audit:read", "staff:manage", "attendance:mark:class_teacher", "attendance:edit:class_teacher"] as const) {
      expect(set.has(p), p).toBe(false);
    }
  });

  test("teacher grants add to teaching; school-wide ones open the admin workspace", () => {
    const set = resolvePermissions("teacher", [], { grants: [{ module: "academics", actions: ["view", "create", "edit", "delete", "approve"] }] });
    expect(set.has("exams:publish")).toBe(true);
    expect(set.has("area:admin")).toBe(true);
    expect(set.has("area:teacher")).toBe(true);
    expect(set.has("attendance:mark:class_teacher")).toBe(true); // still their own class only (requireClassTeacher)
  });

  test("section-limited view grants stay section-scoped (no school-wide read, no admin workspace)", () => {
    const set = resolvePermissions("teacher", [], { grants: [{ module: "students", actions: ["view"] }], sectionLimited: true });
    expect(set.has("students:read:all")).toBe(false);
    expect(set.has("area:admin")).toBe(false);
    expect(set).toEqual(new Set(ROLE_PERMISSIONS.teacher));
  });

  test("students never get grants", () => {
    expect(resolvePermissions("student", [], { grants: [{ module: "finance", actions: ["view", "create", "edit", "delete"] }] })).toEqual(new Set(ROLE_PERMISSIONS.student));
    expect(grantProblems("student", [{ module: "students", actions: ["view"] }], false)).toHaveLength(1);
  });

  test("validation: unavailable cells, partial link groups, section limits", () => {
    expect(grantProblems("admin", [{ module: "attendance", actions: ["create"] }], false).join(" ")).toMatch(/class teacher/);
    expect(grantProblems("admin", [{ module: "students", actions: ["create"] }], false).join(" ")).toMatch(/granted together/);
    expect(grantProblems("admin", [{ module: "students", actions: ["create", "edit"] }], false)).toEqual([]);
    expect(grantProblems("admin", [{ module: "students", actions: ["view"] }], true).join(" ")).toMatch(/teacher logins only/);
    expect(grantProblems("teacher", [{ module: "finance", actions: ["view", "create", "edit", "delete"] }], true).join(" ")).toMatch(/Students or Attendance view/);
    expect(grantProblems("teacher", [{ module: "students", actions: ["view"] }], true)).toEqual([]);
  });

  test("malformed stored data (partial link group) grants nothing from that group", () => {
    expect(permissionsFromGrants([{ module: "finance", actions: ["view"] }], false).size).toBe(0);
    expect(permissionsFromGrants([{ module: "nope", actions: ["view"] }, { module: "students", actions: ["fly"] }], false).size).toBe(0);
  });
});

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  // An office login in school A (admin role).
  const office = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "office@alpha.test" });
    const membershipId = await ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId, displayName: "Office", role: "admin", status: "active", permissionSets: [] });
    return { userId, membershipId };
  });
  return { t, A, B, office };
}

const ACCOUNTANT = GRANT_PRESETS.find((p) => p.key === "accountant")!.grants;

describe("memberships.setPermissions (server)", () => {
  test("the Principal restricts an office login; the server then enforces exactly those grants", async () => {
    const { t, A, office } = await setup();
    const principal = await as(t, A.users.admin);
    const clerk = await as(t, office.userId);
    // Before: a second full administrator.
    expect(await errorCode(clerk.mutation(api.academics.createClass, { name: "Grade 1", level: 1 }))).toBe("NO_ERROR");

    await principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: ACCOUNTANT, accessProfile: "Accountant" });
    expect(await errorCode(clerk.query(api.fees.listStructures, {}))).toBe("NO_ERROR");
    expect(await errorCode(clerk.mutation(api.academics.createClass, { name: "Grade 2", level: 2 }))).toBe("FORBIDDEN");
    expect(await errorCode(clerk.query(api.audit.list, {}))).toBe("FORBIDDEN");
    expect(await errorCode(clerk.query(api.memberships.staffAccess, {}))).toBe("FORBIDDEN");
    // No self-elevation: a restricted login cannot grant itself (or anyone) anything.
    expect(await errorCode(clerk.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, fullAdministrator: true, grants: [] }))).toBe("FORBIDDEN");
    const v = await clerk.query(api.users.viewer, {});
    expect(v.restricted).toBe(true);
    expect(v.accessProfile).toBe("Accountant");

    // Back to full administrator.
    await principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, fullAdministrator: true, grants: [] });
    expect(await errorCode(clerk.mutation(api.academics.createClass, { name: "Grade 3", level: 3 }))).toBe("NO_ERROR");
  });

  test("an office login never marks attendance, even with every grant (class teacher only)", async () => {
    const { t, A, office } = await setup();
    const principal = await as(t, A.users.admin);
    await principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "attendance", actions: ["view"] }, { module: "students", actions: ["view", "create", "edit", "approve"] }] });
    const clerk = await as(t, office.userId);
    expect(await errorCode(clerk.mutation(api.attendance.mark, { sectionId: A.sectionA, date: pastMonday(), entries: [{ studentId: A.studentA, status: "present" }] }))).toBe("FORBIDDEN");
    expect(await errorCode(clerk.query(api.academics.sectionRoster, { sectionId: A.sectionA }))).toBe("NO_ERROR");
  });

  test("refused: own access, students, other schools, teachers/office as callers, invalid cells", async () => {
    const { t, A, B, office } = await setup();
    const principal = await as(t, A.users.admin);
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: A.memberships.admin, grants: [] }))).toBe("FORBIDDEN");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: A.memberships.student, grants: [{ module: "students", actions: ["view"] }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: B.memberships.classTeacher, grants: [] }))).toBe("NOT_FOUND");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "attendance", actions: ["create"] }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "finance", actions: ["view"] }] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "students", actions: ["view"] }], sectionIds: [A.sectionA] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: A.memberships.subjectTeacher, fullAdministrator: true, grants: [] }))).toBe("INVALID_ARGUMENT");
    expect(await errorCode(principal.mutation(api.memberships.setPermissions, { targetMembershipId: A.memberships.subjectTeacher, grants: [{ module: "students", actions: ["view"] }], sectionIds: [B.sectionA] }))).toBe("NOT_FOUND");
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.mutation(api.memberships.setPermissions, { targetMembershipId: A.memberships.subjectTeacher, grants: [] }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.query(api.memberships.staffAccess, {}))).toBe("FORBIDDEN");
    // Nothing changed for the targets.
    const m = await t.run((ctx) => ctx.db.get(office.membershipId));
    expect(m?.grants).toBeUndefined();
  });

  test("teacher extra duty: exam coordinator can publish; section-limited view widens read scope only", async () => {
    const { t, A } = await setup();
    const principal = await as(t, A.users.admin);
    const { sectionC, studentC } = await t.run(async (ctx) => {
      const sectionC = await ctx.db.insert("sections", { schoolId: A.schoolId, academicYearId: A.yearId, classId: A.classId, name: "C", displayName: "8-C" });
      const studentC = await ctx.db.insert("students", { schoolId: A.schoolId, admissionNo: "alpha-C", firstName: "Chitra", lastName: "S", status: "active" });
      await ctx.db.insert("enrollments", { schoolId: A.schoolId, studentId: studentC, academicYearId: A.yearId, classId: A.classId, sectionId: sectionC, rollNo: 1, status: "active", startDate: "2026-04-01" });
      return { sectionC, studentC };
    });
    const teacher = await as(t, A.users.classTeacher);
    expect(await errorCode(teacher.query(api.academics.sectionRoster, { sectionId: sectionC }))).toBe("FORBIDDEN");

    await principal.mutation(api.memberships.setPermissions, {
      targetMembershipId: A.memberships.classTeacher,
      grants: [{ module: "students", actions: ["view"] }, { module: "attendance", actions: ["view"] }],
      sectionIds: [sectionC],
    });
    expect(await errorCode(teacher.query(api.academics.sectionRoster, { sectionId: sectionC }))).toBe("NO_ERROR");
    expect(await errorCode(teacher.query(api.attendance.studentHistory, { studentId: studentC }))).toBe("NO_ERROR");
    // Still not school-wide, and still cannot mark another section's register.
    expect(await errorCode(teacher.query(api.accounts.listPeople, { kind: "student", paginationOpts: { numItems: 5, cursor: null } }))).toBe("FORBIDDEN");
    expect(await errorCode(teacher.mutation(api.attendance.mark, { sectionId: sectionC, date: pastMonday(), entries: [{ studentId: studentC, status: "present" }] }))).toBe("FORBIDDEN");

    await principal.mutation(api.memberships.setPermissions, {
      targetMembershipId: A.memberships.classTeacher,
      grants: [{ module: "academics", actions: ["view", "create", "edit", "delete", "approve"] }],
      accessProfile: "Exam coordinator",
    });
    expect(await errorCode(teacher.query(api.academics.sectionRoster, { sectionId: sectionC }))).toBe("FORBIDDEN"); // section grant removed
    const v = await teacher.query(api.users.viewer, {});
    expect(v.role).toBe("teacher");
    expect(v.permissions).toContain("exams:publish");
    expect(v.permissions).toContain("area:admin");
  });

  test("every change is audited with before/after and listed in the history", async () => {
    const { t, A, office } = await setup();
    const principal = await as(t, A.users.admin);
    await principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "administration", actions: ["view"] }] });
    const history = await principal.query(api.memberships.permissionHistory, { targetMembershipId: office.membershipId });
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("membership.permissions_changed");
    expect(history[0].by).toBe("admin");
    const meta = history[0].metadata as { from: { fullAdministrator: boolean }; to: { grants: { module: string }[] } };
    expect(meta.from.fullAdministrator).toBe(true);
    expect(meta.to.grants.map((g) => g.module)).toEqual(["administration"]);
    const list = await principal.query(api.memberships.staffAccess, {});
    const row = list.find((r) => r.membershipId === office.membershipId)!;
    expect(row.fullAdministrator).toBe(false);
    expect(row.summary).toMatch(/Office: Administration/);
    expect(list.find((r) => r.membershipId === A.memberships.admin)!.isSelf).toBe(true);
    expect(list.some((r) => r.role === ("student" as string))).toBe(false);
  });

  test("the 'accountant only' toggle stores the Accountant grants preset; 'full admin' clears grants", async () => {
    const { t, A, office } = await setup();
    const principal = await as(t, A.users.admin);
    await principal.mutation(api.memberships.setPermissions, { targetMembershipId: office.membershipId, grants: [{ module: "administration", actions: ["view"] }] });
    await principal.mutation(api.memberships.updateAccess, { targetMembershipId: office.membershipId, permissionSets: ["accountant"] });
    let m = await t.run((ctx) => ctx.db.get(office.membershipId as Id<"schoolMemberships">));
    expect(m).toMatchObject({ permissionSets: [], grants: ACCOUNTANT_ACCESS.grants, accessProfile: "Accountant" });
    expect(isAccountantGrants(m?.grants)).toBe(true);
    await principal.mutation(api.memberships.updateAccess, { targetMembershipId: office.membershipId, permissionSets: [] });
    m = await t.run((ctx) => ctx.db.get(office.membershipId as Id<"schoolMemberships">));
    expect(m?.grants).toBeUndefined();
    expect(m?.permissionSets).toEqual([]);
  });

  test("new 'accountant only' logins have the same server access as the legacy accountant set, plus the office base", () => {
    const preset = resolvePermissions("admin", [], { grants: ACCOUNTANT_ACCESS.grants });
    const legacy = resolvePermissions("admin", ["accountant"]);
    for (const p of legacy) expect(preset.has(p), p).toBe(true);
    expect([...preset].filter((p) => !legacy.has(p)).sort()).toEqual(["files:upload", "notices:read"]);
  });
});

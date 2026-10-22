/**
 * Session identity (users.session / users.viewer). Everything about WHO the
 * caller is comes from the Convex Auth identity + schoolMemberships — never
 * from client arguments. Account roles are admin, teacher and student only; a
 * leftover guardian sign-in (removed account type) never resolves to access.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import * as usersModule from "../../convex/users";
import { as, createSchool, errorCode, makeTest } from "./fixtures";

async function setup() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  return { t, A, B };
}

describe("users.session", () => {
  test("signed out → signedOut (no throw)", async () => {
    const { t } = await setup();
    expect(await t.query(api.users.session, {})).toEqual({ status: "signedOut" });
  });

  test("admin / teacher / student get server-derived role and links; a legacy guardian sign-in gets none", async () => {
    const { t, A } = await setup();
    const admin = await (await as(t, A.users.admin)).query(api.users.session, {});
    if (admin.status !== "signedIn") throw new Error(admin.status);
    expect(admin.viewer.role).toBe("admin");
    expect(admin.viewer.school._id).toBe(A.schoolId);
    expect(admin.viewer.membershipId).toBe(A.memberships.admin);
    expect(admin.viewer.teacher).toBeNull();
    expect(admin.viewer.students).toEqual([]);
    expect(admin.memberships.map((m) => m.membershipId)).toEqual([A.memberships.admin]);

    const teacher = await (await as(t, A.users.classTeacher)).query(api.users.session, {});
    if (teacher.status !== "signedIn") throw new Error(teacher.status);
    expect(teacher.viewer.role).toBe("teacher");
    expect(teacher.viewer.teacher?.teacherId).toBe(A.classTeacher);

    const student = await (await as(t, A.users.student)).query(api.users.session, {});
    if (student.status !== "signedIn") throw new Error(student.status);
    expect(student.viewer.role).toBe("student");
    expect(student.viewer.student?.studentId).toBe(A.studentA);
    expect(student.viewer.students.map((s) => s.studentId)).toEqual([A.studentA]);
    expect("guardian" in student.viewer).toBe(false);
    expect("isGuardian" in student.viewer).toBe(false);

    // A user whose only membership is a removed guardian sign-in: no school access at all.
    const legacy = await (await as(t, A.users.legacyGuardian)).query(api.users.session, {});
    expect(legacy.status).toBe("noSchool");
    if (legacy.status === "noSchool") {
      expect(legacy.code).toBe("NO_SCHOOL_ACCESS");
      expect(legacy.memberships).toEqual([]);
    }
  });

  test("a role cannot be forged: unknown args are rejected, the role always comes from the membership", async () => {
    const { t, A } = await setup();
    const student = await as(t, A.users.student);
    const forged = errorCode(student.query(api.users.session, { role: "admin" } as never));
    expect(await forged).toMatch(/THROWN: .*(validator|extra field|role)/i);
    const viewer = await student.query(api.users.viewer, {});
    expect(viewer.role).toBe("student");
    expect(viewer.permissions).not.toContain("attendance:read:all");
  });

  test("someone else's membershipId → noSchool NO_SCHOOL_ACCESS (never their identity)", async () => {
    const { t, A, B } = await setup();
    const student = await as(t, A.users.student);
    for (const membershipId of [A.memberships.admin, B.memberships.admin]) {
      const s = await student.query(api.users.session, { membershipId });
      expect(s.status).toBe("noSchool");
      if (s.status === "noSchool") expect(s.code).toBe("NO_SCHOOL_ACCESS");
    }
  });

  test("suspended membership → noSchool; several memberships → selection required, then chosen", async () => {
    const { t, A, B } = await setup();
    await t.run((ctx) => ctx.db.patch(A.memberships.subjectTeacher, { status: "suspended" }));
    const suspended = await (await as(t, A.users.subjectTeacher)).query(api.users.session, {});
    expect(suspended.status).toBe("noSchool");

    const second = await t.run((ctx) =>
      ctx.db.insert("schoolMemberships", { schoolId: B.schoolId, userId: A.users.student, email: "g@x.test", displayName: "G", role: "student", status: "active", permissionSets: [], studentId: B.studentA }),
    );
    const g = await as(t, A.users.student);
    const choose = await g.query(api.users.session, {});
    expect(choose.status).toBe("noSchool");
    if (choose.status === "noSchool") {
      expect(choose.code).toBe("SCHOOL_SELECTION_REQUIRED");
      expect(choose.memberships).toHaveLength(2);
    }
    const inB = await g.query(api.users.session, { membershipId: second });
    if (inB.status !== "signedIn") throw new Error(inB.status);
    expect(inB.viewer.school._id).toBe(B.schoolId);
    expect(inB.viewer.students.map((s) => s.studentId)).toEqual([B.studentA]);
  });

  test("disabled user → signedOut", async () => {
    const { t, A } = await setup();
    await t.run((ctx) => ctx.db.patch(A.users.admin, { disabled: true }));
    expect((await (await as(t, A.users.admin)).query(api.users.session, {})).status).toBe("signedOut");
  });
});

describe("legacy guardian sign-ins (removed account type)", () => {
  test("a guardian membership next to a real one is ignored: only the real membership is offered", async () => {
    const { t, A } = await setup();
    // Same user also holds a leftover guardian membership (e.g. a teacher who used to be a guardian).
    await t.run((ctx) => ctx.db.insert("schoolMemberships", { schoolId: A.schoolId, userId: A.users.classTeacher, displayName: "Old", role: "student", status: "active", permissionSets: [], guardianId: A.parentContactId }));
    const s = await (await as(t, A.users.classTeacher)).query(api.users.session, {});
    if (s.status !== "signedIn") throw new Error(s.status);
    expect(s.viewer.role).toBe("teacher");
    expect(s.memberships.map((m) => m.membershipId)).toEqual([A.memberships.classTeacher]);
    // Choosing the guardian membership explicitly is refused like any membership that is not yours.
    const chosen = await (await as(t, A.users.legacyGuardian)).query(api.users.session, { membershipId: A.memberships.legacyGuardian });
    expect(chosen.status).toBe("noSchool");
  });

  test("users.studentContext (guardian child switching) no longer exists", () => {
    expect((usersModule as Record<string, unknown>).studentContext).toBeUndefined();
  });
});

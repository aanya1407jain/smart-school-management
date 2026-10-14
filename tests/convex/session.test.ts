/**
 * Session identity (users.session / users.viewer) and the guardian student
 * context (users.studentContext). Everything about WHO the caller is comes from
 * the Convex Auth identity + schoolMemberships — never from client arguments.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
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

  test("admin / teacher / student / guardian get server-derived role and links", async () => {
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
    expect(student.viewer.isGuardian).toBe(false);
    expect(student.viewer.student?.studentId).toBe(A.studentA);
    expect(student.viewer.guardian).toBeNull();
    expect(student.viewer.students.map((s) => s.studentId)).toEqual([A.studentA]);

    const guardian = await (await as(t, A.users.guardian)).query(api.users.session, {});
    if (guardian.status !== "signedIn") throw new Error(guardian.status);
    expect(guardian.viewer.role).toBe("student");
    expect(guardian.viewer.isGuardian).toBe(true);
    expect(guardian.viewer.guardian).not.toBeNull();
    expect(guardian.viewer.student).toBeNull();
    expect(guardian.viewer.students.map((s) => s.studentId)).toEqual([A.studentA]);
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
      ctx.db.insert("schoolMemberships", { schoolId: B.schoolId, userId: A.users.guardian, email: "g@x.test", displayName: "G", role: "student", status: "active", permissionSets: [], studentId: B.studentA }),
    );
    const g = await as(t, A.users.guardian);
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

describe("users.studentContext (guardian child switching)", () => {
  test("guardian: linked child OK; unlinked child and other school's child are NOT_FOUND", async () => {
    const { t, A, B } = await setup();
    const g = await as(t, A.users.guardian);
    const ctx = await g.query(api.users.studentContext, { studentId: A.studentA });
    expect(ctx).toMatchObject({ studentId: A.studentA, relation: "guardian" });
    expect(await errorCode(g.query(api.users.studentContext, { studentId: A.studentB }))).toBe("NOT_FOUND");
    expect(await errorCode(g.query(api.users.studentContext, { studentId: B.studentA }))).toBe("NOT_FOUND");
  });

  test("student: only self; teacher and admin have no student-portal context", async () => {
    const { t, A } = await setup();
    const s = await as(t, A.users.student);
    expect((await s.query(api.users.studentContext, { studentId: A.studentA })).relation).toBe("self");
    expect(await errorCode(s.query(api.users.studentContext, { studentId: A.studentB }))).toBe("NOT_FOUND");
    for (const u of [A.users.classTeacher, A.users.admin]) {
      expect(await errorCode((await as(t, u)).query(api.users.studentContext, { studentId: A.studentA }))).toBe("NOT_FOUND");
    }
  });

  test("signed out → UNAUTHENTICATED", async () => {
    const { t, A } = await setup();
    expect(await errorCode(t.query(api.users.studentContext, { studentId: A.studentA }))).toBe("UNAUTHENTICATED");
  });
});

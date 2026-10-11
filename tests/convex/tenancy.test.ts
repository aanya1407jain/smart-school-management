/**
 * Tenant isolation & authorization rules, tested in-process with convex-test.
 * Two schools with identical shapes: nothing from school B may be visible or
 * writable from school A, whatever ids the client sends.
 */
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { as, createSchool, errorCode, makeTest, pastMonday } from "./fixtures";

async function twoSchools() {
  const t = makeTest();
  const A = await createSchool(t, "alpha");
  const B = await createSchool(t, "beta");
  return { t, A, B };
}

describe("authentication & school resolution", () => {
  test("no identity → UNAUTHENTICATED", async () => {
    const { t } = await twoSchools();
    expect(await errorCode(t.query(api.users.viewer, {}))).toBe("UNAUTHENTICATED");
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  test("school is derived from the membership, not from the client", async () => {
    const { t, A } = await twoSchools();
    const admin = await as(t, A.users.admin);
    const viewer = await admin.query(api.users.viewer, {});
    expect(viewer.school._id).toBe(A.schoolId);
  });

  test("passing another school's membershipId is rejected", async () => {
    const { t, A, B } = await twoSchools();
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.query(api.users.viewer, { membershipId: B.memberships.admin }))).toBe("NO_SCHOOL_ACCESS");
  });

  test("a user in two schools must choose, and only sees the chosen school", async () => {
    const { t, A, B } = await twoSchools();
    // Give A's guardian user a second membership in school B.
    const bMembership = await t.run((ctx) =>
      ctx.db.insert("schoolMemberships", { schoolId: B.schoolId, userId: A.users.guardian, email: "g@x.test", displayName: "G", role: "student", status: "active", permissionSets: [], studentId: B.studentA }),
    );
    const g = await as(t, A.users.guardian);
    expect(await errorCode(g.query(api.users.viewer, {}))).toBe("SCHOOL_SELECTION_REQUIRED");
    const inB = await g.query(api.users.viewer, { membershipId: bMembership });
    expect(inB.school._id).toBe(B.schoolId);
    expect(inB.students.map((s) => s.studentId)).toEqual([B.studentA]);
    const me = await g.query(api.users.me, {});
    expect(me?.memberships).toHaveLength(2);
  });

  test("suspended membership or suspended school → NO_SCHOOL_ACCESS", async () => {
    const { t, A, B } = await twoSchools();
    await t.run((ctx) => ctx.db.patch(A.memberships.admin, { status: "suspended" }));
    expect(await errorCode((await as(t, A.users.admin)).query(api.users.viewer, {}))).toBe("NO_SCHOOL_ACCESS");
    await t.run((ctx) => ctx.db.patch(B.schoolId, { status: "suspended" }));
    expect(await errorCode((await as(t, B.users.admin)).query(api.users.viewer, {}))).toBe("NO_SCHOOL_ACCESS");
  });

  test("disabled user → UNAUTHENTICATED", async () => {
    const { t, A } = await twoSchools();
    await t.run((ctx) => ctx.db.patch(A.users.admin, { disabled: true }));
    expect(await errorCode((await as(t, A.users.admin)).query(api.users.viewer, {}))).toBe("UNAUTHENTICATED");
  });
});

describe("cross-school ids are NOT_FOUND", () => {
  test("admin of A cannot read B's sections, rosters or registers", async () => {
    const { t, A, B } = await twoSchools();
    const admin = await as(t, A.users.admin);
    const sections = await admin.query(api.academics.listSections, {});
    expect(sections.map((s) => s._id).sort()).toEqual([A.sectionA, A.sectionB].sort());
    expect(await errorCode(admin.query(api.academics.sectionRoster, { sectionId: B.sectionA }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.query(api.attendance.getByDate, { sectionId: B.sectionA, date: pastMonday() }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.query(api.attendance.studentHistory, { studentId: B.studentA }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.query(api.academics.listSections, { academicYearId: B.yearId }))).toBe("NOT_FOUND");
  });

  test("class teacher of A cannot mark B's section (same shape, different school)", async () => {
    const { t, A, B } = await twoSchools();
    const ct = await as(t, A.users.classTeacher);
    const res = errorCode(ct.mutation(api.attendance.mark, { sectionId: B.sectionA, date: pastMonday(), entries: [{ studentId: B.studentA, status: "present" }] }));
    expect(await res).toBe("NOT_FOUND");
  });

  test("admin of A cannot assign B's teacher as class teacher, nor enroll B's student", async () => {
    const { t, A, B } = await twoSchools();
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.academics.setClassTeacher, { sectionId: A.sectionA, teacherId: B.classTeacher }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.academics.setClassTeacher, { sectionId: B.sectionA, teacherId: null }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.academics.enrollStudent, { studentId: B.studentA, sectionId: A.sectionA, startDate: "2026-06-01" }))).toBe("NOT_FOUND");
  });

  test("notifications of another school/user cannot be read or marked", async () => {
    const { t, A, B } = await twoSchools();
    const foreign = await t.run((ctx) => ctx.db.insert("notifications", { schoolId: B.schoolId, userId: B.users.admin, type: "general", title: "x", message: "y", isRead: false }));
    const sameSchoolOtherUser = await t.run((ctx) => ctx.db.insert("notifications", { schoolId: A.schoolId, userId: A.users.student, type: "general", title: "x", message: "y", isRead: false }));
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.notifications.markRead, { notificationId: foreign }))).toBe("NOT_FOUND");
    expect(await errorCode(admin.mutation(api.notifications.markRead, { notificationId: sameSchoolOtherUser }))).toBe("NOT_FOUND");
    expect(await admin.query(api.notifications.list, {})).toEqual([]);
  });

  test("files cannot be attached to another school's records", async () => {
    const { t, A, B } = await twoSchools();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })));
    const admin = await as(t, A.users.admin);
    expect(await errorCode(admin.mutation(api.files.register, { storageId, kind: "student_document", ownerType: "student", ownerId: B.studentA, fileName: "tc.pdf" }))).toBe("NOT_FOUND");
    // convex-test does not record contentType for stored blobs, so the own-school
    // registration passes the ownership check and then fails the type check.
    expect(await errorCode(admin.mutation(api.files.register, { storageId, kind: "student_document", ownerType: "student", ownerId: A.studentA, fileName: "tc.pdf" }))).toBe("INVALID_ARGUMENT");
    const storage2 = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4"])));
    const fileId = await t.run((ctx) => ctx.db.insert("files", { schoolId: A.schoolId, storageId: storage2, kind: "student_document", ownerType: "student", ownerId: A.studentA, fileName: "tc.pdf", contentType: "application/pdf", size: 8, uploadedByUserId: A.users.admin }));
    expect((await admin.query(api.files.getUrl, { fileId })).fileName).toBe("tc.pdf");
    expect(await errorCode((await as(t, A.users.guardian)).query(api.files.getUrl, { fileId }))).toBe("NO_ERROR");
    expect(await errorCode((await as(t, A.users.subjectTeacher)).query(api.files.getUrl, { fileId }))).toBe("NO_ERROR");
    const otherAdmin = await as(t, B.users.admin);
    expect(await errorCode(otherAdmin.query(api.files.getUrl, { fileId }))).toBe("NOT_FOUND");
  });

  test("audit log is per school", async () => {
    const { t, A, B } = await twoSchools();
    await (await as(t, A.users.admin)).mutation(api.academics.setClassTeacher, { sectionId: A.sectionA, teacherId: null });
    expect((await (await as(t, A.users.admin)).query(api.audit.list, {})).length).toBe(1);
    expect(await (await as(t, B.users.admin)).query(api.audit.list, {})).toEqual([]);
  });
});

describe("attendance ownership (in-process)", () => {
  test("only the class teacher marks; subject teacher, admin, student, guardian cannot", async () => {
    const { t, A } = await twoSchools();
    const date = pastMonday();
    const entries = [{ studentId: A.studentA, status: "present" as const }];
    for (const u of [A.users.subjectTeacher, A.users.admin, A.users.student, A.users.guardian]) {
      expect(await errorCode((await as(t, u)).mutation(api.attendance.mark, { sectionId: A.sectionA, date, entries }))).toBe("FORBIDDEN");
    }
    await (await as(t, A.users.classTeacher)).mutation(api.attendance.mark, { sectionId: A.sectionA, date, entries });
    const audit = await (await as(t, A.users.admin)).query(api.audit.list, { action: "attendance.marked" });
    expect(audit).toHaveLength(1);
  });

  test("the subject teacher of 8-A owns 8-B and can mark it; the 8-A owner cannot", async () => {
    const { t, A } = await twoSchools();
    const date = pastMonday();
    const entries = [{ studentId: A.studentB, status: "present" as const }];
    expect(await errorCode((await as(t, A.users.classTeacher)).mutation(api.attendance.mark, { sectionId: A.sectionB, date, entries }))).toBe("FORBIDDEN");
    await (await as(t, A.users.subjectTeacher)).mutation(api.attendance.mark, { sectionId: A.sectionB, date, entries });
  });

  test("a student from another section cannot be smuggled into a register", async () => {
    const { t, A } = await twoSchools();
    const code = await errorCode((await as(t, A.users.classTeacher)).mutation(api.attendance.mark, {
      sectionId: A.sectionA, date: pastMonday(), entries: [{ studentId: A.studentA, status: "present" }, { studentId: A.studentB, status: "absent" }],
    }));
    expect(code).toBe("INVALID_RELATIONSHIP");
  });

  test("an admin who also has a teacher link still cannot mark unless class teacher", async () => {
    const { t, A } = await twoSchools();
    await t.run((ctx) => ctx.db.patch(A.memberships.admin, { teacherId: A.subjectTeacher }));
    expect(await errorCode((await as(t, A.users.admin)).mutation(api.attendance.mark, { sectionId: A.sectionB, date: pastMonday(), entries: [{ studentId: A.studentB, status: "present" }] }))).toBe("FORBIDDEN");
  });

  test("guardian sees linked student only; student sees self only", async () => {
    const { t, A } = await twoSchools();
    const g = await as(t, A.users.guardian);
    await g.query(api.attendance.studentHistory, { studentId: A.studentA });
    expect(await errorCode(g.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("NOT_FOUND");
    const s = await as(t, A.users.student);
    expect(await errorCode(s.query(api.attendance.studentHistory, { studentId: A.studentB }))).toBe("NOT_FOUND");
  });
});

export {};

/**
 * Service-level tests for Notices, Audience Targeting, and Notification workflows.
 * Run with: npx tsx scripts/notices-notifications.test.ts
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
  const { readDb, writeDb } = await import("../src/lib/store/db");
  const { todayISO } = await import("../src/lib/utils/dates");

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

  console.log("\n--- 1. Notice Creation & Audience Targeting Tests ---");

  // Admin login
  await login("admin@asteracademy.edu", "Admin@123", "admin");

  // Create school-wide notice
  const schoolNotice = await services.notices.create({
    title: "Annual Sports Day 2026",
    body: "Annual sports day will be held next Friday at the main school stadium.",
    type: "event",
    audience: { scope: "school" },
    publishDate: todayISO(),
    eventDate: "2026-11-20",
    priority: "high",
    status: "published",
  });
  check("Admin can create school-wide event notice", typeof schoolNotice.id === "string");

  // Create teacher-only notice
  const teacherNotice = await services.notices.create({
    title: "Staff Meeting on Curriculum Review",
    body: "All department heads and teaching staff meet in conference room B.",
    type: "notice",
    audience: { scope: "teachers" },
    publishDate: todayISO(),
    eventDate: null,
    priority: "urgent",
    status: "published",
  });
  check("Admin can create teacher-only notice", typeof teacherNotice.id === "string");

  // Create Class 10 specific notice
  const db = readDb();
  const class10 = db.classes.find((c) => c.grade === 10);
  const class12 = db.classes.find((c) => c.grade === 12);
  if (!class10 || !class12) throw new Error("Seed classes not found");

  const class10Notice = await services.notices.create({
    title: "Class 10 Board Registration Deadline",
    body: "All Class 10 students must submit their board exam registration forms.",
    type: "notice",
    audience: { scope: "classes", classIds: [class10.id] },
    publishDate: todayISO(),
    eventDate: null,
    priority: "high",
    status: "published",
  });
  check("Admin can create class-specific notice for Class 10", typeof class10Notice.id === "string");

  // Create draft notice
  const draftNotice = await services.notices.create({
    title: "Draft Policy on Summer Uniform",
    body: "Tentative draft proposal for revised summer school uniform.",
    type: "notice",
    audience: { scope: "school" },
    publishDate: todayISO(),
    eventDate: null,
    priority: "normal",
    status: "draft",
  });
  check("Admin can create draft notice", typeof draftNotice.id === "string");

  // Transition draft notice to published
  await services.notices.update(draftNotice.id, {
    title: "Draft Policy on Summer Uniform",
    body: "Final approved notice for revised summer school uniform.",
    type: "notice",
    audience: { scope: "school" },
    publishDate: todayISO(),
    eventDate: null,
    priority: "normal",
    status: "published",
  });
  let updatedNoticeList = await services.notices.list();
  const publishedDraft = updatedNoticeList.find((n) => n.id === draftNotice.id);
  check("Draft notice successfully transitioned to published", publishedDraft?.status === "published");

  // Updating notice accepts only editable fields and ignores computed / read-only fields
  const originalCreatedBy = readDb().notices.find((n) => n.id === draftNotice.id)?.createdBy;
  await services.notices.update(draftNotice.id, {
    ...publishedDraft!,
    title: "Revised Policy on Summer Uniform",
    body: "Updated guidelines for summer uniform without sending computed fields.",
    // Extra computed / read-only properties that must not pollute the record
    audienceLabel: "Computed Label",
    author: "Spoofed Author",
    isUpcoming: true,
    createdBy: "spoofed_user",
  } as never);
  const reloadedNotice = readDb().notices.find((n) => n.id === draftNotice.id)!;
  check("Notice update succeeds and preserves immutable createdBy", reloadedNotice.createdBy === originalCreatedBy);
  check("Notice title was updated", reloadedNotice.title === "Revised Policy on Summer Uniform");

  // Archive notice
  await services.notices.archive(draftNotice.id);
  const archivedNotice = readDb().notices.find((n) => n.id === draftNotice.id);
  check("Notice is archived", archivedNotice?.status === "archived");

  // Restore archived notice via services.notices.restore — back to DRAFT (republish required), no notifications
  const notifCountBeforeRestore = readDb().notifications.length;
  await services.notices.restore(draftNotice.id);
  const restoredNotice = readDb().notices.find((n) => n.id === draftNotice.id);
  check("Notice is restored to draft (republishing required)", restoredNotice?.status === "draft");
  const notifCountAfterRestore = readDb().notifications.length;
  check("Restoring archived notice via restore() does not resend notifications", notifCountAfterRestore === notifCountBeforeRestore);

  // Archive again and restore via services.notices.update — does not resend notifications
  await services.notices.archive(draftNotice.id);
  await services.notices.update(draftNotice.id, {
    title: restoredNotice!.title,
    body: restoredNotice!.body,
    type: restoredNotice!.type,
    audience: restoredNotice!.audience,
    publishDate: restoredNotice!.publishDate,
    eventDate: restoredNotice!.eventDate,
    priority: restoredNotice!.priority,
    status: "published",
  });
  const notifCountAfterUpdateRestore = readDb().notifications.length;
  check("Restoring archived notice via update() does not resend notifications", notifCountAfterUpdateRestore === notifCountBeforeRestore);

  console.log("\n--- 2. Notice Audience Privacy & Role Separation Tests ---");

  // Student login (Aarav Sharma in Class 10)
  await login("student@asteracademy.edu", "Student@123", "student");
  const studentNotices = await services.notices.list();

  check(
    "Student can view school-wide notice",
    studentNotices.some((n) => n.id === schoolNotice.id)
  );
  check(
    "Student CANNOT view teacher-only notice",
    !studentNotices.some((n) => n.id === teacherNotice.id)
  );
  check(
    "Class 10 student CAN view Class 10 notice",
    studentNotices.some((n) => n.id === class10Notice.id)
  );

  // Student cannot create or edit notices
  const studentCreateCheck = await rejects(() =>
    services.notices.create({
      title: "Hacked notice",
      body: "Students should not be allowed to post notices.",
      type: "notice",
      audience: { scope: "school" },
      publishDate: todayISO(),
      eventDate: null,
      priority: "normal",
      status: "published",
    })
  );
  check("Student is rejected from creating notice", studentCreateCheck.rejected, studentCreateCheck.code);

  // Teacher login (Rahul Verma - teaches in Class 10)
  await login("teacher@asteracademy.edu", "Teacher@123", "teacher");
  const teacherNotices = await services.notices.list();

  check(
    "Teacher CAN view school-wide notice",
    teacherNotices.some((n) => n.id === schoolNotice.id)
  );
  check(
    "Teacher CAN view teacher-only notice",
    teacherNotices.some((n) => n.id === teacherNotice.id)
  );

  console.log("\n--- 3. Notification Management & Read/Unread Workflows ---");

  // Switch back to student to test notifications
  await login("student@asteracademy.edu", "Student@123", "student");
  const studentUser = readDb().users.find((u) => u.email === "student@asteracademy.edu")!;

  // Seed two unread notifications for this student
  writeDb((d) => {
    d.notifications.push(
      {
        id: "notif_test_1",
        userId: studentUser.id,
        category: "fees",
        title: "Fee Reminder Term 1",
        message: "Your quarterly fee installment is due on 15th Nov.",
        createdAt: new Date().toISOString(),
        read: false,
        href: "/student/fees",
      },
      {
        id: "notif_test_2",
        userId: studentUser.id,
        category: "homework",
        title: "New Mathematics Homework",
        message: "Quadratic equations exercises 4.1 to 4.3 assigned.",
        createdAt: new Date().toISOString(),
        read: false,
        href: "/student/homework",
      }
    );
  });

  const unreadBefore = await services.notifications.unreadCount();
  check("Student has unread notifications", unreadBefore >= 2);

  const studentNotifs = await services.notifications.list({ unreadOnly: true });
  const hasNotif1 = studentNotifs.some((n) => n.id === "notif_test_1" && !n.read);
  check("Unread list contains test notification", hasNotif1);

  // Mark single notification as read
  await services.notifications.markRead("notif_test_1");
  const unreadAfterOne = await services.notifications.unreadCount();
  check("Marking one notification as read decrements unread count", unreadAfterOne === unreadBefore - 1);

  const readItem = (await services.notifications.list()).find((n) => n.id === "notif_test_1");
  check("Target notification status updated to read=true", readItem?.read === true);

  // Mark all as read
  const markAllResult = await services.notifications.markAllRead();
  check("markAllRead returns updated count", markAllResult.count >= 1);

  const unreadFinal = await services.notifications.unreadCount();
  check("Unread count is 0 after markAllRead", unreadFinal === 0);

  // Privacy: A student cannot mark another user's notification as read
  const otherUser = readDb().users.find((u) => u.id !== studentUser.id)!;
  writeDb((d) => {
    d.notifications.push({
      id: "notif_other_user",
      userId: otherUser.id,
      category: "general",
      title: "Private notification",
      message: "Secret update.",
      createdAt: new Date().toISOString(),
      read: false,
      href: null,
    });
  });

  const crossUserCheck = await rejects(() => services.notifications.markRead("notif_other_user"));
  check("User cannot mark another user's notification as read", crossUserCheck.rejected, crossUserCheck.code);

  console.log(`\nResults: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

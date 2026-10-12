// Smart School Management System — end-to-end checks (demo tenant: Aster Academy) for auth, route guards and the six cross-module workflows.
// Sign-in is real Convex Auth, so this needs a Convex deployment seeded with the demo accounts
// (`npm run seed:demo`) and a build with NEXT_PUBLIC_CONVEX_URL pointing at it:
//   npm run build && npm start   (in another terminal)  then  npx playwright install chromium && npm run test:e2e
// Each scenario uses a fresh browser context, i.e. a freshly seeded (mock) domain dataset.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

async function newPage(width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.setDefaultTimeout(15000);
  return { ctx, page };
}
async function login(page, email, password, role, expectOk = true) {
  await page.goto(BASE + "/login");
  await page.getByRole("radio", { name: new RegExp(role, "i") }).first().click();
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /^sign in/i }).click();
  if (expectOk) await page.waitForURL(/dashboard/);
}
async function logout(page) {
  await page.getByRole("button", { name: /open profile menu/i }).click();
  await page.getByRole("menuitem", { name: /log out/i }).click();
  await page.waitForURL(/\/login/);
}
const text = async (page) => (await page.locator("main").innerText().catch(() => page.locator("body").innerText()));
const waitText = async (page, re, timeout = 10000) => { try { await page.getByText(re).first().waitFor({ timeout }); return true; } catch { return false; } };

/** Server-side guard: what the proxy answers for a full page request, before any client code runs. */
async function serverAnswer(ctx, path) {
  const res = await ctx.request.get(BASE + path, { maxRedirects: 0 });
  return { status: res.status(), location: res.headers()["location"] ?? "" };
}

// ------------------------------------------------------------------ AUTH
{
  const { ctx, page } = await newPage();
  for (const path of ["/admin/dashboard", "/teacher/attendance", "/student/fees"]) {
    const r = await serverAnswer(ctx, path);
    check(`Signed out: server redirects ${path} to login`, r.status >= 300 && r.status < 400 && r.location.includes(`/login?next=${encodeURIComponent(path)}`), `${r.status} ${r.location}`);
  }
  const loginPage = await serverAnswer(ctx, "/login");
  check("Login page stays public", loginPage.status === 200, String(loginPage.status));
  await page.goto(BASE + "/");
  check("Splash shows demo school (tenant) name", await waitText(page, /Aster Academy/i));
  check("Splash shows product name", await waitText(page, /Smart School Management System/i));
  check("Browser title is the product name", /Smart School Management System/.test(await page.title()) && !/Aster/.test(await page.title()));
  const hasNav = await page.getByRole("navigation", { name: /main navigation/i }).count();
  check("Splash has no dashboard/sidebar", hasNav === 0);
  await page.waitForURL(/\/login/, { timeout: 8000 });
  check("Login appears after splash", page.url().endsWith("/login"));

  await login(page, "teacher@asteracademy.edu", "Teacher@123", "admin", false);
  check("Role selection cannot escalate (teacher account + Admin role rejected)", await waitText(page, /does not have Administrator access/i) && page.url().includes("/login"));
  await login(page, "admin@asteracademy.edu", "wrong-pass", "admin", false);
  check("Wrong password rejected", await waitText(page, /incorrect/i));

  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  check("Teacher login creates session → teacher dashboard", page.url().includes("/teacher/dashboard"));
  const cookies = await ctx.cookies();
  const jwt = cookies.find((c) => c.name.includes("convexAuthJWT"));
  check("Auth token is an httpOnly cookie (not readable by page scripts)", !!jwt && jwt.httpOnly === true);
  // Allowed: the Convex Auth client's own cache (short-lived access JWT + a placeholder refresh token)
  // and the mock domain dataset. Not allowed: an app session/role, a password, or the real refresh token.
  const stored = await page.evaluate(() => [localStorage, sessionStorage].flatMap((s) => Object.keys(s).map((k) => [k, s.getItem(k) ?? ""])));
  const appSessionKeys = stored.filter(([k]) => /session|role|membership/i.test(k) && !k.startsWith("__convexAuth")).map(([k]) => k);
  const realRefresh = cookies.find((c) => c.name.includes("convexAuthRefreshToken"))?.value ?? "";
  const leaksRefresh = !!realRefresh && stored.some(([, v]) => v.includes(realRefresh));
  const hasPassword = stored.some(([, v]) => /Teacher@123|"password"/.test(v));
  check("No app session/role, password or refresh token in Web Storage", appSessionKeys.length === 0 && !hasPassword && !leaksRefresh, `${appSessionKeys.join(",")} ${hasPassword ? "password" : ""} ${leaksRefresh ? "refresh" : ""}`.trim());
  const signedIn = await serverAnswer(ctx, "/teacher/attendance");
  check("Signed in: server lets the protected page through", signedIn.status === 200, String(signedIn.status));
  await logout(page);
  const afterLogout = await serverAnswer(ctx, "/teacher/dashboard");
  check("After logout: server redirects protected page to login", afterLogout.status >= 300 && afterLogout.status < 400 && afterLogout.location.includes("/login"), `${afterLogout.status}`);
  await page.goto(BASE + "/teacher/dashboard");
  await page.waitForURL(/\/login/);
  check("After logout protected route redirects to login", page.url().includes("/login"));
  await page.goBack().catch(() => {});
  await page.waitForTimeout(800);
  check("Browser back after logout does not expose protected page", !(await page.getByRole("navigation", { name: /main navigation/i }).count()));

  // Role routing comes from the server: each account lands in its own portal.
  for (const [email, password, role, home] of [["admin@asteracademy.edu", "Admin@123", "admin", "/admin/dashboard"], ["student@asteracademy.edu", "Student@123", "student", "/student/dashboard"], ["guardian@asteracademy.edu", "Guardian@123", "student", "/student/dashboard"]]) {
    await login(page, email, password, role);
    check(`${email} is routed to ${home}`, new URL(page.url()).pathname === home, page.url());
    await logout(page);
  }
  // A ?next= pointing into another portal does not override the server role.
  await page.goto(BASE + "/login?next=" + encodeURIComponent("/admin/fees"));
  await page.getByRole("radio", { name: /student/i }).first().click();
  await page.getByLabel(/email or username/i).fill("student@asteracademy.edu");
  await page.getByLabel(/^password/i).fill("Student@123");
  await page.getByRole("button", { name: /^sign in/i }).click();
  await page.waitForURL(/dashboard/);
  check("?next= into another portal is ignored (student stays in student portal)", new URL(page.url()).pathname === "/student/dashboard", page.url());
  await logout(page);
  await ctx.close();
}

// ------------------------------------------------------------------ ROLE SEPARATION & ROUTE GUARDS
{
  const { ctx, page } = await newPage();
  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  const nav = await page.getByRole("navigation", { name: /main navigation/i }).innerText();
  check("Teacher nav has no admin items", !/Fees|Settings|Reports|Teachers & Staff|Academics/.test(nav) && /My Classes/.test(nav), nav.replace(/\n/g, " | "));
  check("Teacher dashboard is teacher-specific", await waitText(page, /Mr\. Verma/) && !(await page.getByText(/Pending fees/).count()));
  for (const route of ["/admin/fees", "/admin/students", "/admin/settings", "/student/dashboard"]) {
    await page.goto(BASE + route);
    check(`Teacher blocked from ${route}`, await waitText(page, /don't have access/i));
  }
  await page.goto(BASE + "/teacher/classes/sec_12a");
  check("Teacher cannot open an unrelated class (12-A)", await waitText(page, /not assigned to you/i));
  await page.goto(BASE + "/teacher/students/stu_075");
  check("Teacher cannot open a student outside assigned classes", await waitText(page, /don't have access|not assigned|can only/i));
  await page.goto(BASE + "/teacher/classes/sec_10a");
  check("Teacher sees assigned class 10-A roster", await waitText(page, /Aarav Sharma/));
  await page.goto(BASE + "/teacher/classes");
  await waitText(page, /Class 10-A/);
  const t = await text(page);
  check("Teacher only sees assigned classes", /Class 10-A/.test(t) && /Class 9-A/.test(t) && !/Class 12-A/.test(t));
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  const nav = await page.getByRole("navigation", { name: /main navigation/i }).innerText();
  check("Student nav has only student items", /My Attendance/.test(nav) && !/Students|Settings|Reports|Attendance\n/.test(nav.replace("My Attendance", "")), nav.replace(/\n/g, " | "));
  for (const route of ["/admin/students", "/admin/students/stu_045", "/teacher/attendance", "/teacher/students/stu_045", "/admin/reports"]) {
    await page.goto(BASE + route);
    check(`Student blocked from ${route}`, await waitText(page, /don't have access/i));
  }
  await page.goto(BASE + "/student/profile");
  check("Student profile shows own record", await waitText(page, /AA-\d{4}-\d{4}/) && await waitText(page, /Aarav Sharma/));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 1 + 3: add student → teacher sees → attendance → student dashboard
{
  const { ctx, page } = await newPage();
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + "/admin/students/new");
  await page.getByLabel(/^first name/i).fill("Ishita");
  await page.getByLabel(/^last name/i).fill("Menon");
  await page.getByLabel(/date of birth/i).fill("2011-05-14");
  await page.getByLabel(/home address/i).fill("12, 4th Main, Jayanagar, Bengaluru");
  await page.getByRole("combobox", { name: /^Class/ }).selectOption({ label: "Class 10" });
  await page.getByRole("combobox", { name: /^Section/ }).selectOption({ index: 1 });
  await page.getByLabel(/guardian name/i).fill("Kavita Menon");
  await page.getByLabel(/guardian phone/i).fill("+91 98450 77777");
  await page.getByRole("button", { name: /^add student$/i }).click();
  check("W1 Admin adds student", await waitText(page, /Student enrolled/i));
  const loginEmail = (await page.getByRole("dialog").getByText(/@students\.asteracademy\.edu/).first().innerText()).trim();
  const dialogText = await page.getByRole("dialog").innerText();
  check("W1 No password is generated or shown for the new student (access is by invitation)", /issued by school invitation/i.test(dialogText) && !/Welcome@123/.test(dialogText));
  await page.getByRole("button", { name: /open profile/i }).click();
  await page.waitForURL(/\/admin\/students\/stu_/);
  const newStudentPath = new URL(page.url()).pathname;
  check("W1 New student profile opens with class 10-A", await waitText(page, /Class 10 · Section A/));
  await page.goto(BASE + "/admin/students?q=Ishita Menon");
  check("W1 Student appears in Students list", await waitText(page, /Ishita Menon/));
  await logout(page);

  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  await page.goto(BASE + "/teacher/classes/sec_10a");
  check("W1 Teacher assigned to 10-A sees the new student", await waitText(page, /Ishita Menon/));
  await page.goto(BASE + "/teacher/attendance?section=sec_10a");
  await waitText(page, /Class 10-A ·/);
  await page.getByRole("button", { name: /mark all present/i }).click();
  await page.getByRole("radiogroup", { name: /Attendance for Ishita Menon/ }).getByRole("radio", { name: "Absent" }).click();
  await page.getByRole("radiogroup", { name: /Attendance for Aarav Sharma/ }).getByRole("radio", { name: "Absent" }).click();
  await page.getByRole("button", { name: /update attendance|save attendance/i }).click();
  check("W3 Teacher saves attendance (Aarav + Ishita absent)", await waitText(page, /Attendance (saved|updated)/i));
  await logout(page);

  // The new record has no Convex Auth account yet, so the old demo password must not open anything.
  await login(page, loginEmail, "Welcome@123", "student", false);
  check("W1 New student cannot sign in before an account is provisioned", await waitText(page, /incorrect/i) && page.url().includes("/login"), loginEmail);
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + newStudentPath);
  const attendanceMetric = page.locator("dt", { hasText: /^Attendance$/i }).first().locator("xpath=following-sibling::dd");
  const metric = await attendanceMetric.innerText().catch(() => "");
  check("W1 New student's profile reflects attendance (0% after 1 absence)", /^0(\.0)?%$/.test(metric.trim()), metric);
  await logout(page);

  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await waitText(page, /Good (morning|afternoon|evening)/);
  const t2 = await text(page);
  check("W3 Aarav's attendance dropped after being marked absent (92% → 90%)", /90%/.test(t2), (t2.match(/\d+%/g) || []).slice(0, 3).join(","));
  await page.goto(BASE + "/student/notifications");
  check("W3 Aarav notified of absence", await waitText(page, /Aarav was marked absent/));
  await logout(page);

  // Class teacher CORRECTS the record (absent → present); the change propagates back.
  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  await page.goto(BASE + "/teacher/attendance?section=sec_10a");
  await waitText(page, /Class 10-A ·/);
  await page.getByRole("radiogroup", { name: /Attendance for Aarav Sharma/ }).getByRole("radio", { name: "Present" }).click();
  await page.getByRole("button", { name: /update attendance/i }).click();
  check("A16a Class teacher corrects Aarav absent → present", await waitText(page, /Attendance updated/i));
  await logout(page);
  await login(page, "guardian@asteracademy.edu", "Guardian@123", "student");
  await waitText(page, /Viewing Aarav Sharma/);
  const t3 = await text(page);
  check("A16b Correction propagates to guardian dashboard (back to 92%)", /92%/.test(t3), (t3.match(/\d+%/g) || []).slice(0, 3).join(","));
  await ctx.close();
}

// ------------------------------------------------------------------ ATTENDANCE OWNERSHIP (class teacher only)
{
  const { ctx, page } = await newPage();
  const editable = async () => (await page.getByRole("button", { name: /mark all present/i }).count()) > 0 && (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) > 0;
  const readOnly = async () => (await page.getByText(/View only/).count()) > 0 && (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) === 0
    && (await page.getByRole("button", { name: /mark all present|update attendance|save attendance/i }).count()) === 0;

  // Rahul — class teacher of 10-A; teaches Maths in 10-B (class teacher: Meera Iyer)
  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  await page.goto(BASE + "/teacher/attendance?section=sec_10a");
  await waitText(page, /Class 10-A ·/);
  check("A1/A2 Rahul (class teacher) gets mark/edit controls for 10-A", await editable());
  await page.getByRole("button", { name: /mark all present/i }).click();
  await page.getByRole("button", { name: /update attendance|save attendance/i }).click();
  await waitText(page, /Attendance (saved|updated)/i);
  await page.goto(BASE + "/teacher/attendance?section=sec_10b");
  await waitText(page, /Class 10-B ·/);
  check("A3/A4 Rahul sees 10-B read-only (subject teacher, not class teacher)", await readOnly() && await waitText(page, /Only the class teacher of 10-B \(Ms\. Meera Iyer\)/));
  await page.goto(BASE + "/teacher/attendance?section=sec_12a");
  check("A14 Direct URL to an unrelated class register is blocked", await waitText(page, /not assigned to you/i));
  await page.goto(BASE + "/teacher/classes/sec_10b");
  await waitText(page, /Class 10-B/);
  check("A3c Class page for 10-B offers View (not Mark) attendance", (await page.getByRole("link", { name: /view attendance/i }).count()) === 1 && (await page.getByRole("link", { name: /mark attendance|edit today's attendance/i }).count()) === 0);
  await page.goto(BASE + "/teacher/dashboard");
  await waitText(page, /Attendance tasks/);
  const tasks = await page.getByRole("heading", { name: "Attendance tasks" }).locator("xpath=ancestor::div[contains(@class,'glass')]").innerText();
  check("A3d Dashboard attendance tasks list only Rahul's own class (10-A)", /Class 10-A/.test(tasks) && !/Class 10-B|Class 9-A/.test(tasks), tasks.replace(/\n/g, " | "));
  await logout(page);

  // Sunita Rao — teaches English in 10-A, class teacher of 10-C
  await login(page, "sunita.rao@asteracademy.edu", "Welcome@123", "teacher");
  await page.goto(BASE + "/teacher/attendance?section=sec_10a");
  await waitText(page, /Class 10-A ·/);
  check("A5/A6 Subject teacher of 10-A cannot mark or edit 10-A", await readOnly());
  await page.goto(BASE + "/teacher/attendance?section=sec_10c");
  await waitText(page, /Class 10-C ·/);
  check("A5b Sunita CAN mark/edit her own class 10-C", await editable());
  await logout(page);

  // Admin — view only
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  check("A8a Admin dashboard has no 'Mark attendance' action", (await page.getByText(/^Mark attendance$/).count()) === 0 && await waitText(page, /Review attendance/));
  await page.goto(BASE + "/admin/attendance?section=sec_10a");
  await waitText(page, /Class 10-A ·/);
  check("A7 Admin can view 10-A register and school overview", await waitText(page, /School attendance/) && (await page.getByText("Present", { exact: true }).count()) > 0);
  check("A8/A9 Admin has no mark/edit controls", await readOnly() && await waitText(page, /Administrators can view and monitor attendance/));
  await logout(page);

  // Student & guardian — view only
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/attendance");
  check("A10 Student can view own attendance", await waitText(page, /Attendance calendar/));
  check("A11 Student has no attendance edit controls", (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) === 0 && (await page.getByRole("button", { name: /save attendance|update attendance|mark all/i }).count()) === 0);
  await page.goto(BASE + "/teacher/attendance?section=sec_10a");
  check("A11b Student blocked from the register route", await waitText(page, /don't have access/i));
  await logout(page);
  await login(page, "guardian@asteracademy.edu", "Guardian@123", "student");
  await page.goto(BASE + "/student/attendance");
  await waitText(page, /Attendance calendar/);
  await page.getByRole("button", { name: /switch student/i }).click();
  await page.getByRole("menuitem", { name: /Ananya Sharma/ }).click();
  await page.waitForTimeout(800);
  check("A12 Guardian views linked student's attendance (switch to Ananya)", await waitText(page, /Attendance calendar/) && (await page.getByRole("button", { name: /switch student/i }).innerText()).includes("Ananya"));
  check("A13 Guardian has no attendance edit controls", (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) === 0 && (await page.getByRole("button", { name: /save attendance|update attendance|mark all/i }).count()) === 0);
  await page.goto(BASE + "/admin/attendance");
  check("A13b Guardian blocked from admin attendance route", await waitText(page, /don't have access/i));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 2: fees → payment → receipt → student
{
  const { ctx, page } = await newPage();
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/fees");
  check("W2 Student sees pending ₹6,000", await waitText(page, /₹6,000/));
  await logout(page);

  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  // New fee structure assigned to Class 10
  await page.goto(BASE + "/admin/fees?tab=structures");
  await page.getByRole("button", { name: /new fee structure/i }).click();
  await page.getByRole("dialog").getByLabel(/^name/i).fill("Class 10 Science Exhibition Fee");
  await page.getByRole("dialog").getByLabel("Class 10").check();
  await page.getByRole("dialog").getByLabel("Amount").fill("1500");
  await page.getByRole("button", { name: /create structure/i }).click();
  await page.getByRole("button", { name: /^assign$/i }).click();
  check("W2 Admin creates & assigns fee structure", await waitText(page, /Assigned to \d+ students/));
  await page.goto(BASE + "/admin/fees/stu_aarav");
  check("W2 Ledger shows new outstanding ₹7,500", await waitText(page, /₹7,500/));
  await page.getByRole("button", { name: /record payment/i }).first().click();
  await page.getByRole("dialog").getByLabel(/amount/i).fill("7500");
  await page.getByRole("dialog").getByLabel(/reference/i).fill("UPI 77812");
  await page.getByRole("button", { name: /record & generate receipt/i }).click();
  check("W2 Payment recorded + receipt generated", await waitText(page, /Payment recorded/) && await waitText(page, /AA\/26-27\/\d{4}/));
  const receiptNo = (await page.getByRole("dialog").getByText(/AA\/26-27\/\d{4}/).first().innerText()).trim();
  await page.keyboard.press("Escape");
  check("W2 Outstanding balance decreased to ₹0", await waitText(page, /Fully|Paid|₹0/));
  await logout(page);

  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/fees");
  check("W2 Student sees fees fully paid", await waitText(page, /All fees paid/));
  check("W2 Student sees the new receipt", await waitText(page, new RegExp(receiptNo.replace(/\//g, "\\/"))), receiptNo);
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 4: homework only for 10-A
{
  const { ctx, page } = await newPage();
  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  await page.goto(BASE + "/teacher/homework?action=new");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^title/i).fill("Probability — practice set A");
  await dlg.getByLabel(/class & subject/i).selectOption({ label: "Class 10-A · Mathematics (8 students)" });
  await dlg.getByLabel(/instructions/i).fill("Solve all 12 probability questions from the practice set.");
  await page.getByRole("button", { name: /assign homework/i }).click();
  check("W4 Teacher creates homework for 10-A", await waitText(page, /Visible to Class 10-A only/));
  await logout(page);
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/homework");
  check("W4 10-A student sees the homework", await waitText(page, /Probability — practice set A/));
  await page.getByRole("listitem").filter({ hasText: "Probability — practice set A" }).getByRole("button", { name: /^submit$/i }).click();
  await page.getByRole("dialog").getByLabel(/your answer/i).fill("Solved all 12 questions; working attached.");
  await page.getByRole("dialog").getByRole("button", { name: /^submit$/i }).click();
  check("W4 Student submits homework", await waitText(page, /Homework submitted/));
  await logout(page);
  await login(page, "amaira.desai@students.asteracademy.edu", "Welcome@123", "student");
  await page.goto(BASE + "/student/homework");
  await page.waitForTimeout(1500);
  check("W4 10-B student does NOT see 10-A homework", !(await page.getByText(/Probability — practice set A/).count()));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 5: marks → publish → student
{
  const { ctx, page } = await newPage();
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/results");
  await waitText(page, /Unit Test 1/);
  check("W5 Unpublished Half-Yearly hidden from student", !(await page.getByRole("heading", { name: /Half-Yearly/ }).count()));
  await logout(page);

  await login(page, "teacher@asteracademy.edu", "Teacher@123", "teacher");
  await page.goto(BASE + "/teacher/examinations");
  await page.getByRole("link", { name: /Mathematics · Class 10-A/ }).first().click();
  // The link text also matches the list page, so wait for the marks sheet itself
  // (URL + its inputs) before counting rows — count() does not auto-wait.
  await page.waitForURL(/\/teacher\/examinations\/marks\?/);
  const inputs = page.getByRole("textbox", { name: /Marks for/ });
  await inputs.first().waitFor({ state: "visible", timeout: 10000 });
  const n = await inputs.count();
  const marks = [72, 67.5, 58, 61, 70, 49, 75, 66, 55];
  for (let i = 0; i < n; i++) await inputs.nth(i).fill(String(marks[i % marks.length]));
  await page.getByRole("button", { name: /save marks/i }).click();
  check("W5 Teacher enters marks for assigned subject", await waitText(page, /Marks saved/) && await waitText(page, /All students entered/));
  await page.goto(BASE + "/teacher/examinations/marks?paper=ep_ex_hy_12_mat&section=sec_12a");
  check("W5 Teacher cannot enter marks for unassigned class", await waitText(page, /not assigned|don't have access/i));
  await logout(page);

  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + "/admin/examinations/ex_hy");
  await waitText(page, /Marks entry progress/);
  // remaining pending sheet (12-C Hindi) — admin enters it
  await page.goto(BASE + "/admin/examinations/marks?paper=ep_ex_hy_12_hin&section=sec_12c");
  await waitText(page, /Hindi · Class 12-C/);
  const in2 = page.getByRole("textbox", { name: /Marks for/ });
  await in2.first().waitFor({ state: "visible", timeout: 10000 });
  const n2 = await in2.count();
  for (let i = 0; i < n2; i++) await in2.nth(i).fill(String(50 + i));
  await page.getByRole("button", { name: /save marks/i }).click();
  check("W5 Admin completes the last pending sheet", await waitText(page, /Marks saved/) && await waitText(page, /All students entered/));
  await page.goto(BASE + "/admin/examinations/ex_hy");
  check("W5 Exam reports ready to publish", await waitText(page, /ready to publish/i));
  await page.getByRole("button", { name: /publish results/i }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /publish results/i }).click();
  check("W5 Admin publishes results", await waitText(page, /Results published/));
  await logout(page);

  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/results");
  check("W5 Student sees published Half-Yearly result with grade", await waitText(page, /Half-Yearly Examination/) && await waitText(page, /Grade [A-E]/));
  check("W5 Aarav's Maths mark (67.5/80) reflected", await waitText(page, /67\.5\/80/));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 6: class-specific notice + guardian
{
  const { ctx, page } = await newPage();
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + "/admin/notices?action=new");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^title/i).fill("10-B: Lab coats required on Monday");
  await dlg.getByLabel(/^audience/i).selectOption("sections");
  await dlg.getByLabel("10-B", { exact: true }).check();
  await dlg.getByLabel(/description/i).fill("All Class 10-B students must bring lab coats for the chemistry practical.");
  await page.getByRole("button", { name: /^publish$/i }).click();
  check("W6 Admin publishes 10-B notice", await waitText(page, /Notice published/));
  await logout(page);
  await login(page, "amaira.desai@students.asteracademy.edu", "Welcome@123", "student");
  await page.goto(BASE + "/student/notices");
  check("W6 10-B student sees the notice", await waitText(page, /Lab coats required/));
  await logout(page);
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/notices");
  await page.waitForTimeout(1500);
  check("W6 10-A student does NOT see the 10-B notice", !(await page.getByText(/Lab coats required/).count()));
  await logout(page);

  await login(page, "guardian@asteracademy.edu", "Guardian@123", "student");
  check("Guardian sees linked student (Aarav) by default", await waitText(page, /Viewing Aarav Sharma/));
  await page.getByRole("button", { name: /switch student/i }).click();
  await page.getByRole("menuitem", { name: /Ananya Sharma/ }).click();
  check("Guardian can switch to second linked student (Ananya, 8-B)", await waitText(page, /Viewing Ananya Sharma/));
  await page.goto(BASE + "/student/fees");
  check("Guardian sees Ananya's sibling concession", await waitText(page, /concession/i));
  await ctx.close();
}

// ------------------------------------------------------------------ Responsive smoke
{
  const { ctx, page } = await newPage(390);
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Mobile (390px): no horizontal scroll on dashboard", overflow <= 1, `overflow ${overflow}px`);
  await page.getByRole("button", { name: /open navigation menu/i }).click();
  check("Mobile: drawer navigation opens", await page.getByRole("dialog").getByText("Teachers & Staff").isVisible().catch(() => false) || await page.getByRole("dialog").getByRole("link", { name: /Teachers/ }).waitFor().then(() => true, () => false));
  
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/admin/students");
  await waitText(page, /Students/);
  const o2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("Mobile: students table becomes cards (no overflow)", o2 <= 1, `overflow ${o2}px`);
  
  await ctx.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log("PAGE ERRORS:", JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();

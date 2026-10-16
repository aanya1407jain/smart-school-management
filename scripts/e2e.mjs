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
/** Sign in with a Login ID. The portal (role) is decided by the server, never chosen on the form. */
async function login(page, loginId, password, expectOk = true) {
  await page.goto(BASE + "/login");
  await page.getByLabel(/^login id/i).fill(loginId);
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

  await page.getByLabel(/^login id/i).waitFor();
  check("Login form has no role selector (the server decides the portal)", (await page.getByRole("radio").count()) === 0 && (await page.getByLabel(/^login id/i).count()) === 1);
  await login(page, "admin@asteracademy.edu", "Admin@123", false);
  check("An email address is not accepted as a Login ID", await waitText(page, /Login ID given by your school/i) && page.url().includes("/login"));
  await login(page, "NOBODY-404", "Admin@123", false);
  check("Unknown Login ID rejected with a generic message", await waitText(page, /Login ID or password you entered is incorrect/i));
  await login(page, "ADMIN-001", "wrong-pass", false);
  check("Wrong password rejected", await waitText(page, /incorrect/i));

  await login(page, "TCH-00001", "Teacher@123");
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
  for (const [loginId, password, home] of [["admin-001", "Admin@123", "/admin/dashboard"], ["STU-2026-00001", "Student@123", "/student/dashboard"], [" GRD-00001 ", "Guardian@123", "/student/dashboard"]]) {
    await login(page, loginId, password);
    check(`${loginId.trim()} is routed to ${home} (Login ID normalised)`, new URL(page.url()).pathname === home, page.url());
    await logout(page);
  }
  // A ?next= pointing into another portal does not override the server role.
  await page.goto(BASE + "/login?next=" + encodeURIComponent("/admin/fees"));
  await page.getByLabel(/^login id/i).fill("STU-2026-00001");
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
  await login(page, "TCH-00001", "Teacher@123");
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
  await login(page, "STU-2026-00001", "Student@123");
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
  await login(page, "ADMIN-001", "Admin@123");
  await page.goto(BASE + "/admin/students/new");
  // A unique surname per run: the admission is a real (Convex) record, so earlier runs' students remain.
  const ISHITA_LAST = `Menon${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}`;
  const ISHITA = `Ishita ${ISHITA_LAST}`;
  await page.getByLabel(/^first name/i).fill("Ishita");
  await page.getByLabel(/^last name/i).fill(ISHITA_LAST);
  await page.getByLabel(/date of birth/i).fill("2011-05-14");
  await page.getByLabel(/home address/i).fill("12, 4th Main, Jayanagar, Bengaluru");
  // The form lists the school's REAL classes/sections (Convex), not demo ids.
  await page.getByRole("combobox", { name: /^Class/ }).selectOption({ label: "Grade 10" });
  await page.getByRole("combobox", { name: /^Section/ }).selectOption({ index: 1 }); // first section of Grade 10 → 10-A
  await page.getByLabel(/guardian name/i).fill("Kavita Menon");
  await page.getByLabel(/guardian phone/i).fill("+91 98450 77777");
  await page.getByRole("button", { name: /^add student$/i }).click();
  check("W1 Admin adds student", await waitText(page, /Student enrolled/i));
  const dialogText = await page.getByRole("dialog").innerText();
  check("W1 No password is generated or shown here (accounts are created in Accounts & Import)", /Accounts & Import/i.test(dialogText) && !/Welcome@123/.test(dialogText));
  check("W1 Enrolled in the selected section (10-A) with a system roll number", /10-A · Roll \d+/.test(await page.getByTestId("created-section").innerText()) && /^AA-\d{4}-\d+$/.test((await page.getByTestId("created-admission").innerText()).trim()));
  await page.getByRole("button", { name: /open profile/i }).click();
  await page.waitForURL(/\/admin\/students\/[a-z0-9]{20,}$/);
  const newStudentPath = new URL(page.url()).pathname;
  check("W1 New student profile (real record) opens with class 10-A", await waitText(page, /Class 10-A/) && await waitText(page, new RegExp(ISHITA)));
  await page.goto(BASE + "/admin/accounts");
  await page.getByLabel(/filter students by section/i).selectOption({ label: "10-A" });
  check("W1 Student appears in the school's student records (Accounts & Import)", await page.locator("tr", { hasText: ISHITA }).first().waitFor().then(() => true, () => false));
  await logout(page);

  await login(page, "TCH-00001", "Teacher@123");
  await page.goto(BASE + "/teacher/attendance?section=10-A");
  await waitText(page, /Class 10-A ·/);
  check("W1 Class teacher of 10-A sees the new student on the register", await page.getByRole("radiogroup", { name: `Attendance for ${ISHITA}` }).waitFor().then(() => true, () => false));
  await page.getByRole("button", { name: /mark all present/i }).click();
  await page.getByRole("radiogroup", { name: `Attendance for ${ISHITA}` }).getByRole("radio", { name: "Absent" }).click();
  await page.getByRole("radiogroup", { name: /Attendance for Aarav Sharma/ }).getByRole("radio", { name: "Absent" }).click();
  await page.getByRole("button", { name: /update attendance|save attendance/i }).click();
  check("W3 Teacher saves attendance (Aarav + Ishita absent)", await waitText(page, /Attendance (saved|updated)/i));
  await logout(page);

  await login(page, "ADMIN-001", "Admin@123");
  await page.goto(BASE + newStudentPath);
  const attendanceMetric = page.locator("dt", { hasText: /^Attendance$/i }).first().locator("xpath=following-sibling::dd");
  const metric = await attendanceMetric.innerText().catch(() => "");
  check("W1 New student's profile reflects attendance (0% after 1 absence)", /^0(\.0)?%$/.test(metric.trim()), metric);
  await logout(page);

  // The register is stored in Convex: a fresh load shows the saved statuses.
  // (The demo student/guardian dashboards read the in-browser demo dataset, so the
  // Convex register is verified here and through live student accounts below.)
  await login(page, "TCH-00001", "Teacher@123");
  await page.goto(BASE + "/teacher/attendance?section=10-A");
  await waitText(page, /Class 10-A ·/);
  const aaravAbsent = page.getByRole("radiogroup", { name: /Attendance for Aarav Sharma/ }).getByRole("radio", { name: "Absent" });
  check("W3 Saved register reloads from the server (Aarav absent)", await aaravAbsent.waitFor().then(async () => (await aaravAbsent.getAttribute("aria-checked")) === "true", () => false));

  // Class teacher CORRECTS the record (absent → present); the change is persisted.
  await page.getByRole("radiogroup", { name: /Attendance for Aarav Sharma/ }).getByRole("radio", { name: "Present" }).click();
  await page.getByRole("button", { name: /update attendance/i }).click();
  check("A16a Class teacher corrects Aarav absent → present", await waitText(page, /Attendance updated/i));
  await page.reload();
  await waitText(page, /Class 10-A ·/);
  const aaravPresent = page.getByRole("radiogroup", { name: /Attendance for Aarav Sharma/ }).getByRole("radio", { name: "Present" });
  check("A16b Correction is persisted", await aaravPresent.waitFor().then(async () => (await aaravPresent.getAttribute("aria-checked")) === "true", () => false));
  await logout(page);
  await ctx.close();
}

// ------------------------------------------------------------------ ATTENDANCE OWNERSHIP (class teacher only)
{
  const { ctx, page } = await newPage();
  const editable = async () => (await page.getByRole("button", { name: /mark all present/i }).count()) > 0 && (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) > 0;
  const readOnly = async () => (await page.getByText(/View only/).count()) > 0 && (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) === 0
    && (await page.getByRole("button", { name: /mark all present|update attendance|save attendance/i }).count()) === 0;

  // Rahul — class teacher of 10-A; teaches Maths in 10-B (class teacher: Meera Iyer)
  await login(page, "TCH-00001", "Teacher@123");
  await page.goto(BASE + "/teacher/attendance?section=10-A");
  await waitText(page, /Class 10-A ·/);
  check("A1/A2 Rahul (class teacher) gets mark/edit controls for 10-A", await editable());
  await page.getByRole("button", { name: /mark all present/i }).click();
  await page.getByRole("button", { name: /update attendance|save attendance/i }).click();
  await waitText(page, /Attendance (saved|updated)/i);
  await page.goto(BASE + "/teacher/attendance?section=10-B");
  await waitText(page, /Class 10-B ·/);
  check("A3/A4 Rahul sees 10-B read-only (subject teacher, not class teacher)", await readOnly() && await waitText(page, /Only the class teacher of 10-B \(Ms\. Meera Iyer\)/));
  await page.goto(BASE + "/teacher/attendance?section=sec_12a");
  check("A14 A link to a class outside the teacher's scope (or a demo id) never reaches the register — own class shown instead",
    await waitText(page, /isn't one of your sections/i) && await waitText(page, /Class 10-A ·/));
  // Class / section filters use real ids and switch the register without errors.
  await page.getByRole("combobox", { name: /^Class$/ }).selectOption({ label: "Grade 9" });
  check("ATT Class filter switches to the teacher's 9-A register", await waitText(page, /Class 9-A ·/));
  await page.getByRole("combobox", { name: /^Class$/ }).selectOption({ label: "Grade 10" });
  await page.getByRole("combobox", { name: /^Section$/ }).selectOption({ label: "Section B" });
  check("ATT Section filter switches to 10-B", await waitText(page, /Class 10-B ·/));
  const pastDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel(/^date$/i).fill(pastDate);
  check("ATT Date filter loads that day's register (or the no-school notice)", await waitText(page, /Class 10-B ·|No school on this day/));
  await page.goto(BASE + "/teacher/classes/sec_10b");
  await waitText(page, /Class 10-B/);
  check("A3c Class page for 10-B offers View (not Mark) attendance", (await page.getByRole("link", { name: /view attendance/i }).count()) === 1 && (await page.getByRole("link", { name: /mark attendance|edit today's attendance/i }).count()) === 0);
  await page.goto(BASE + "/teacher/dashboard");
  await waitText(page, /Attendance tasks/);
  const tasks = await page.getByRole("heading", { name: "Attendance tasks" }).locator("xpath=ancestor::div[contains(@class,'glass')]").innerText();
  check("A3d Dashboard attendance tasks list only Rahul's own class (10-A)", /Class 10-A/.test(tasks) && !/Class 10-B|Class 9-A/.test(tasks), tasks.replace(/\n/g, " | "));
  await logout(page);

  // Sunita Rao — teaches English in 10-A, class teacher of 10-C
  await login(page, "TCH-00003", "Welcome@123");
  await page.goto(BASE + "/teacher/attendance?section=10-A");
  await waitText(page, /Class 10-A ·/);
  check("A5/A6 Subject teacher of 10-A cannot mark or edit 10-A", await readOnly());
  await page.goto(BASE + "/teacher/attendance?section=10-C");
  await waitText(page, /Class 10-C ·/);
  check("A5b Sunita CAN mark/edit her own class 10-C", await editable());
  await logout(page);

  // Admin — view only
  await login(page, "ADMIN-001", "Admin@123");
  check("A8a Admin dashboard has no 'Mark attendance' action", (await page.getByText(/^Mark attendance$/).count()) === 0 && await waitText(page, /Review attendance/));
  await page.goto(BASE + "/admin/attendance?section=10-A");
  await waitText(page, /Class 10-A ·/);
  check("A7 Admin can view 10-A register and school overview", await waitText(page, /School attendance/) && (await page.getByText("Present", { exact: true }).count()) > 0);
  check("A8/A9 Admin has no mark/edit controls", await readOnly() && await waitText(page, /Administrators can view and monitor attendance/));
  await logout(page);

  // Student & guardian — view only
  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/attendance");
  check("A10 Student can view own attendance", await waitText(page, /Attendance calendar/));
  const daysShown = async () => Number(await page.locator('dt:text-is("Days") + dd').first().innerText());
  const markedCells = async () => (await page.locator('[role="gridcell"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).filter((l) => l && !l.endsWith("no record"));
  const aaravDays = await daysShown();
  check("A10a Demo attendance comes from the demo registers (not a fixed 7-day list)", aaravDays > 7 && (await markedCells()).length > 0, `${aaravDays} days`);
  check("A11 Student has no attendance edit controls", (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) === 0 && (await page.getByRole("button", { name: /save attendance|update attendance|mark all/i }).count()) === 0);
  await page.goto(BASE + "/teacher/attendance?section=10-A");
  check("A11b Student blocked from the register route", await waitText(page, /don't have access/i));
  await logout(page);
  await login(page, "GRD-00001", "Guardian@123");
  await page.goto(BASE + "/student/attendance");
  await waitText(page, /Attendance calendar/);
  const guardianAaravCells = await markedCells();
  await page.getByRole("button", { name: /switch student/i }).click();
  await page.getByRole("menuitem", { name: /Ananya Sharma/ }).click();
  await page.waitForTimeout(800);
  check("A12a Each linked child shows their own demo records", JSON.stringify(await markedCells()) !== JSON.stringify(guardianAaravCells) && (await daysShown()) > 7);
  check("A12 Guardian views linked student's attendance (switch to Ananya)", await waitText(page, /Attendance calendar/) && (await page.getByRole("button", { name: /switch student/i }).innerText()).includes("Ananya"));
  check("A13 Guardian has no attendance edit controls", (await page.getByRole("radiogroup", { name: /^Attendance for / }).count()) === 0 && (await page.getByRole("button", { name: /save attendance|update attendance|mark all/i }).count()) === 0);
  await page.goto(BASE + "/admin/attendance");
  check("A13b Guardian blocked from admin attendance route", await waitText(page, /don't have access/i));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 2: fees → payment → receipt → student
{
  const { ctx, page } = await newPage();
  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/fees");
  check("W2 Student sees pending ₹6,000", await waitText(page, /₹6,000/));
  await logout(page);

  await login(page, "ADMIN-001", "Admin@123");
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

  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/fees");
  check("W2 Student sees fees fully paid", await waitText(page, /All fees paid/));
  check("W2 Student sees the new receipt", await waitText(page, new RegExp(receiptNo.replace(/\//g, "\\/"))), receiptNo);
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 4: homework only for 10-A
{
  const { ctx, page } = await newPage();
  await login(page, "TCH-00001", "Teacher@123");
  await page.goto(BASE + "/teacher/homework?action=new");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^title/i).fill("Probability — practice set A");
  await dlg.getByLabel(/class & subject/i).selectOption({ label: "Class 10-A · Mathematics (8 students)" });
  await dlg.getByLabel(/instructions/i).fill("Solve all 12 probability questions from the practice set.");
  await page.getByRole("button", { name: /assign homework/i }).click();
  check("W4 Teacher creates homework for 10-A", await waitText(page, /Visible to Class 10-A only/));
  await logout(page);
  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/homework");
  check("W4 10-A student sees the homework", await waitText(page, /Probability — practice set A/));
  await page.getByRole("listitem").filter({ hasText: "Probability — practice set A" }).getByRole("button", { name: /^submit$/i }).click();
  await page.getByRole("dialog").getByLabel(/your answer/i).fill("Solved all 12 questions; working attached.");
  await page.getByRole("dialog").getByRole("button", { name: /^submit$/i }).click();
  check("W4 Student submits homework", await waitText(page, /Homework submitted/));
  await logout(page);
  await login(page, "STU-2026-00002", "Welcome@123");
  await page.goto(BASE + "/student/homework");
  await page.waitForTimeout(1500);
  check("W4 10-B student does NOT see 10-A homework", !(await page.getByText(/Probability — practice set A/).count()));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 5: marks → publish → student
{
  const { ctx, page } = await newPage();
  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/results");
  await waitText(page, /Unit Test 1/);
  check("W5 Unpublished Half-Yearly hidden from student", !(await page.getByRole("heading", { name: /Half-Yearly/ }).count()));
  await logout(page);

  await login(page, "TCH-00001", "Teacher@123");
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

  await login(page, "ADMIN-001", "Admin@123");
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

  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/results");
  check("W5 Student sees published Half-Yearly result with grade", await waitText(page, /Half-Yearly Examination/) && await waitText(page, /Grade [A-E]/));
  check("W5 Aarav's Maths mark (67.5/80) reflected", await waitText(page, /67\.5\/80/));
  await ctx.close();
}

// ------------------------------------------------------------------ WORKFLOW 6: class-specific notice + guardian
{
  const { ctx, page } = await newPage();
  await login(page, "ADMIN-001", "Admin@123");
  await page.goto(BASE + "/admin/notices?action=new");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^title/i).fill("10-B: Lab coats required on Monday");
  await dlg.getByLabel(/^audience/i).selectOption("sections");
  await dlg.getByLabel("10-B", { exact: true }).check();
  await dlg.getByLabel(/description/i).fill("All Class 10-B students must bring lab coats for the chemistry practical.");
  await page.getByRole("button", { name: /^publish$/i }).click();
  check("W6 Admin publishes 10-B notice", await waitText(page, /Notice published/));
  await logout(page);
  await login(page, "STU-2026-00002", "Welcome@123");
  await page.goto(BASE + "/student/notices");
  check("W6 10-B student sees the notice", await waitText(page, /Lab coats required/));
  await logout(page);
  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/student/notices");
  await page.waitForTimeout(1500);
  check("W6 10-A student does NOT see the 10-B notice", !(await page.getByText(/Lab coats required/).count()));
  await logout(page);

  await login(page, "GRD-00001", "Guardian@123");
  check("Guardian sees linked student (Aarav) by default", await waitText(page, /Viewing Aarav Sharma/));
  await page.getByRole("button", { name: /switch student/i }).click();
  await page.getByRole("menuitem", { name: /Ananya Sharma/ }).click();
  check("Guardian can switch to second linked student (Ananya, 8-B)", await waitText(page, /Viewing Ananya Sharma/));
  await page.goto(BASE + "/student/fees");
  check("Guardian sees Ananya's sibling concession", await waitText(page, /concession/i));
  await ctx.close();
}

// ------------------------------------------------------------------ ACCOUNTS & IMPORT (Convex-backed admin onboarding)
{
  const { ctx, page } = await newPage();
  await login(page, "ADMIN-001", "Admin@123");
  const nav = await page.getByRole("navigation", { name: /main navigation/i }).innerText();
  check("ACC Admin nav has Accounts & Import", /Accounts & Import/.test(nav));
  await page.goto(BASE + "/admin/accounts");
  await page.getByRole("heading", { name: "Accounts & Import" }).waitFor();
  const row = page.locator("tr", { has: page.getByRole("button", { name: /create account/i }) }).first();
  await row.waitFor();
  const personName = (await row.locator("td").nth(1).locator("p").first().innerText()).trim();
  await row.getByRole("button", { name: /create account/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^create account$/i }).click();
  await page.getByTestId("issued-login-id").first().waitFor();
  const newId = (await page.getByTestId("issued-login-id").first().innerText()).trim();
  const tempPw = (await page.getByTestId("issued-password").first().innerText()).trim();
  check("ACC Admin creates an account: Login ID + one-time temporary password shown", /^STU-\d{4}-\d{5}$/.test(newId) && /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(tempPw), `${personName} ${newId}`);
  await page.getByRole("button", { name: /^done$/i }).click();
  const personRow = page.locator("tr", { hasText: personName });
  check("ACC Account shows as Active with its Login ID", await personRow.getByText("Active").first().waitFor().then(() => true, () => false) && (await personRow.innerText()).includes(newId));
  await logout(page);

  await login(page, newId.toLowerCase(), tempPw, false);
  await page.waitForURL(/\/account/);
  check("ACC New account signs in and must change the temporary password", await waitText(page, /temporary password/i) && await waitText(page, new RegExp(newId)));
  await page.goto(BASE + "/student/dashboard");
  await page.waitForURL(/\/account/);
  check("ACC Portal pages send a temporary-password account back to /account", page.url().includes("/account") && !(await page.getByRole("link", { name: /go to my portal/i }).count()));
  await page.getByLabel(/^current password/i).fill(tempPw);
  await page.getByLabel(/^new password/i).fill("Chosen#2026");
  await page.getByLabel(/^confirm new password/i).fill("Chosen#2026");
  await page.getByRole("button", { name: /^change password$/i }).click();
  check("ACC Password changed", await waitText(page, /Password changed/));
  check("ACC Temporary-password notice disappears", await page.getByText(/You signed in with a temporary password/).waitFor({ state: "detached" }).then(() => true, () => false));
  // LIVE student portal: the school-created account opens ITS OWN record from Convex (no "preview" dead end).
  check("LIVE After the password change the student lands on the student dashboard", await page.waitForURL(/\/student\/dashboard/).then(() => true, () => false), page.url());
  await page.getByTestId("live-student-dashboard").waitFor();
  check("LIVE No 'records aren't available in this preview' message", !(await text(page)).includes("aren't available in this preview"));
  check("LIVE Dashboard shows the student's own name, admission no., class-section and year",
    (await page.getByTestId("dash-name").innerText()).trim() === personName && (await page.getByTestId("dash-admission").innerText()).trim().length > 0 &&
    /^\d+-[A-Z]$/.test((await page.getByTestId("dash-class").innerText()).trim()) && /^\d{4}-\d{2}$/.test((await page.getByTestId("dash-year").innerText()).trim()),
    `${await page.getByTestId("dash-class").innerText()} ${await page.getByTestId("dash-year").innerText()}`);
  check("LIVE No demo persona data is shown to a real account", !/Aarav Sharma|Priya Sharma/.test(await page.locator("body").innerText()));
  const liveNav = await page.getByRole("navigation", { name: /main navigation/i }).innerText();
  check("LIVE Navigation lists the student modules (all backed by school records)", ["My Attendance", "My Timetable", "My Homework", "My Results", "My Fees", "Notices", "Notifications", "Profile"].every((x) => liveNav.includes(x)), liveNav.replace(/\s+/g, " "));
  await page.goto(BASE + "/student/profile");
  await page.getByTestId("live-student-profile").waitFor();
  check("LIVE Profile shows the Login ID and class/section/year", (await page.getByTestId("profile-login-id").innerText()).trim() === newId && (await page.getByTestId("profile-section").innerText()).trim().length === 1 && /^\d{4}-\d{2}$/.test((await page.getByTestId("profile-year").innerText()).trim()));
  await page.goto(BASE + "/student/attendance");
  check("LIVE Attendance page reads the student's own attendance", await page.getByTestId("live-attendance").waitFor().then(() => true, () => false));
  // Each module renders the account's real records, or the explicit empty state when the school has none.
  for (const [path, pattern, label] of [
    ["/student/timetable", /Weekly timetable|No timetable yet|Not enrolled in a class/, "timetable"],
    ["/student/homework", /open assignment|No homework set|Not enrolled in a class/, "homework"],
    ["/student/results", /No published results yet|Grade/, "results"],
    ["/student/fees", /Installments|No current academic year/, "fees"],
    ["/student/notices", /Announcements for the whole school/, "notices"],
  ]) {
    await page.goto(BASE + path);
    const ok = await waitText(page, pattern);
    check(`LIVE ${label} page shows the student's real records (no demo data)`, ok && !/Aarav Sharma/.test(await page.locator("body").innerText()));
  }
  await page.goto(BASE + "/admin/accounts");
  check("LIVE Student cannot open admin pages", await waitText(page, /can't open|don't have access/i));
  await logout(page);
  await login(page, newId, tempPw, false);
  check("ACC Temporary password no longer works", await waitText(page, /incorrect/i) && page.url().includes("/login"));
  await login(page, newId, "Chosen#2026", false);
  check("ACC New password works and opens the student portal", await page.waitForURL(/\/student\/dashboard/).then(() => true, () => false));
  await logout(page);

  await login(page, "ADMIN-001", "Admin@123");
  await page.goto(BASE + "/admin/accounts");
  await page.locator("tr", { hasText: personName }).getByRole("button", { name: /account actions/i }).click();
  await page.getByRole("menuitem", { name: /disable account/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^disable$/i }).click();
  check("ACC Admin disables the account", await waitText(page, /Account disabled/) && await page.locator("tr", { hasText: personName }).getByText("Disabled").waitFor().then(() => true, () => false));

  // Bulk import: one bad row blocks the whole file; the corrected file imports.
  await page.getByRole("tab", { name: /^import$/i }).click();
  const csv = (rows) => ({ name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\r\n"), "utf8") });
  const header = "Full name,Class,Section,Date of birth,Gender,Guardian name,Guardian phone";
  // A unique surname per run, so repeated runs against the same deployment stay unambiguous.
  const IRA = `Ira Kulkarni${Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("")}`;
  const good = `${IRA},10,C,03/09/2011,F,Meena Kulkarni,98450 66001`;
  await page.getByLabel(/upload students file/i).setInputFiles(csv([header, good, "Bad Section,10,Z,03/09/2011,F,,"]));
  check("ACC Import explains that roll numbers are system-assigned", await waitText(page, /Roll numbers are assigned automatically based on the complete class roster/));
  await page.getByRole("button", { name: /validate 2 row/i }).click();
  check("ACC Import preview reports the invalid row (row 3) and blocks import",
    await waitText(page, /1 row\(s\) have errors/) && await waitText(page, /Section "?Z"?|section/i) && await page.getByRole("button", { name: /^import 2 student/i }).isDisabled());
  await page.getByRole("button", { name: /upload corrected file/i }).click();
  await page.getByLabel(/upload students file/i).setInputFiles(csv([header, good]));
  await page.getByRole("button", { name: /validate 1 row/i }).click();
  await page.getByRole("button", { name: /^import 1 student/i }).click();
  check("ACC Corrected file imports", await waitText(page, /Imported 1 student\(s\) from students\.csv/));

  // Roll numbers: 10-C is numbered 1..n after the import (Ira included); bulk account creation for selected students.
  await page.getByRole("tab", { name: /^students$/i }).click();
  await page.getByLabel(/filter students by section/i).selectOption({ label: "10-C" });
  await page.locator("tr", { hasText: IRA }).waitFor();
  const rollCells = await page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Number(tr.children[3]?.textContent)));
  check("ROLL Section roster is numbered 1..n (system-assigned)", [...rollCells].sort((a, b) => a - b).every((n, i) => n === i + 1), rollCells.join(","));
  const eligibleBoxes = page.locator("tbody").getByRole("checkbox");
  const nEligible = await eligibleBoxes.count();
  await page.locator("tr", { hasText: IRA }).getByRole("checkbox").check();
  const other = page.locator("tbody tr", { hasNot: page.getByText(IRA) }).filter({ has: page.getByRole("checkbox") }).first();
  const otherName = (await other.locator("td").nth(1).locator("p").first().innerText()).trim();
  await other.getByRole("checkbox").check();
  check("BULK Toolbar shows the selection", (await page.getByTestId("selection-summary").innerText()).startsWith("2 students selected"));
  await page.getByRole("checkbox", { name: /select all students without an account on this page/i }).check();
  check("BULK Header checkbox selects every eligible student on the page", (await page.getByTestId("selection-summary").innerText()).startsWith(`${nEligible} student`), String(nEligible));
  await page.getByRole("checkbox", { name: /select all students without an account on this page/i }).uncheck();
  check("BULK Header checkbox clears the page selection", (await page.getByRole("region", { name: "Selection" }).count()) === 0);
  await page.locator("tr", { hasText: IRA }).getByRole("checkbox").check();
  await other.getByRole("checkbox").check(); // the same row as before (names can repeat across runs)
  await page.getByRole("region", { name: "Selection" }).getByRole("button", { name: /create accounts/i }).click();
  const confirmBox = page.getByTestId("bulk-confirm");
  await confirmBox.waitFor();
  check("BULK Confirmation shows what will happen", /Selected\s*2/.test(await confirmBox.innerText()) && /Will get an account\s*2/.test(await confirmBox.innerText()) && /change it at first sign-in/.test(await confirmBox.innerText()));
  await page.getByRole("button", { name: /^create 2 accounts$/i }).click();
  await page.getByTestId("bulk-summary").waitFor({ timeout: 60000 });
  check("BULK Run completes with an accurate summary", /2 accounts created · 0 skipped · 0 failed/.test(await page.getByTestId("bulk-summary").innerText()));
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /download 2 credentials/i }).click()]);
  const csvText = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  check("BULK Credential CSV lists exactly the new accounts", csvText.split(/\r?\n/).length === 3 && csvText.includes(IRA) && /STU-\d{4}-\d{5}/.test(csvText));
  await page.getByRole("dialog").getByRole("button", { name: /^close$/i }).click();
  check("BULK Selected students now show Active accounts", await page.locator("tr", { hasText: IRA }).getByText("Active").waitFor().then(() => true, () => false));
  // Cross-page selection: "select all matching" covers every student without an account (server-side), and a filter change clears it.
  await page.getByLabel(/filter students by section/i).selectOption({ label: "All sections" });
  await page.getByTestId("scope-counts").waitFor();
  const without = Number((await page.getByTestId("scope-counts").innerText()).match(/·\s*([\d,]+) without/)[1].replace(/,/g, ""));
  await page.getByRole("checkbox", { name: /select all students without an account on this page/i }).check();
  const pageCount = Number((await page.getByTestId("selection-summary").innerText()).match(/^([\d,]+)/)[1].replace(/,/g, ""));
  const allLink = page.getByRole("button", { name: /^select all [\d,]+ students without an account$/i });
  if (without > pageCount) {
    await allLink.click();
    check("BULK “Select all matching” selects every student without an account across pages", (await page.getByTestId("selection-summary").innerText()).startsWith(`${without.toLocaleString()} students selected`), `${pageCount} on page, ${without} matching`);
  } else {
    check("BULK “Select all matching” not offered when the page already holds every match", (await allLink.count()) === 0);
  }
  await page.getByLabel(/filter students by section/i).selectOption({ label: "10-C" });
  check("BULK Changing the filter clears the selection", await page.getByRole("region", { name: "Selection" }).waitFor({ state: "detached" }).then(() => true, () => false));
  await logout(page);
  await login(page, newId, "Chosen#2026", false);
  check("ACC Disabled account cannot sign in", await waitText(page, /active access|incorrect/i) && page.url().includes("/login"));
  // LIVE: a BULK-created account (credentials from the CSV) signs in, changes the password and sees its own record.
  {
    const line = csvText.split(/\r?\n/).find((l) => l.includes(IRA)).split(",");
    const [, admission, cls, loginId, temp] = line.map((c) => c.replace(/^"|"$/g, ""));
    await login(page, loginId, temp, false);
    await page.waitForURL(/\/account/);
    await page.getByLabel(/^current password/i).fill(temp);
    await page.getByLabel(/^new password/i).fill("IraChosen#2026");
    await page.getByLabel(/^confirm new password/i).fill("IraChosen#2026");
    await page.getByRole("button", { name: /^change password$/i }).click();
    await page.waitForURL(/\/student\/dashboard/);
    await page.getByTestId("live-student-dashboard").waitFor();
    check("LIVE Bulk-created account resolves its own record (name, admission no., 10-C)",
      (await page.getByTestId("dash-name").innerText()).trim() === IRA && (await page.getByTestId("dash-admission").innerText()).trim() === admission &&
      (await page.getByTestId("dash-class").innerText()).trim() === "10-C" && cls.includes("10-C"), `${loginId} ${cls}`);
    await logout(page);
    // The class teacher of 10-C marks the register; the live student sees it and is notified.
    await login(page, "TCH-00003", "Welcome@123");
    await page.goto(BASE + "/teacher/attendance?section=10-C");
    await waitText(page, /Class 10-C ·/);
    const markable = await page.getByRole("button", { name: /mark all present/i }).count();
    // Absence notifications are sent when a register is first marked (corrections do not re-notify).
    const freshRegister = (await page.getByRole("button", { name: /^save attendance$/i }).count()) > 0;
    if (markable) {
      await page.getByRole("button", { name: /mark all present/i }).click();
      await page.getByRole("radiogroup", { name: new RegExp(`Attendance for ${IRA}`) }).getByRole("radio", { name: "Absent" }).click();
      await page.getByRole("button", { name: /update attendance|save attendance/i }).click();
      await waitText(page, /Attendance (saved|updated)/i);
    }
    await logout(page);
    await login(page, loginId, "IraChosen#2026", false);
    await page.waitForURL(/\/student\/dashboard/);
    await page.goto(BASE + "/student/attendance");
    await page.getByTestId("live-attendance").waitFor();
    check("LIVE Bulk-created student sees the class teacher's register (absent recorded)", !markable || await waitText(page, /Absent/));
    await page.goto(BASE + "/student/notifications");
    await page.getByTestId("live-notifications").waitFor();
    check("LIVE Bulk-created student is notified of the absence", !markable || !freshRegister || await waitText(page, /marked absent/i), freshRegister ? "first marking" : "register already marked today — correction (no notification by design)");
    await page.goto(BASE + "/student/timetable");
    // Only 10-A has a timetable in the demo seed, so 10-C shows the explicit empty state.
    check("LIVE Bulk-created student sees 10-C's timetable state from the school's records", await waitText(page, /Class 10-C · weekly schedule/) && await waitText(page, /No timetable yet|Weekly timetable/));
    await logout(page);
  }
  await login(page, "TCH-00001", "Teacher@123");
  await page.goto(BASE + "/admin/accounts");
  check("ACC Teacher blocked from Accounts & Import", await waitText(page, /don't have access/i));
  await ctx.close();
}

// ------------------------------------------------------------------ Responsive smoke
{
  const { ctx, page } = await newPage(390);
  await login(page, "ADMIN-001", "Admin@123");
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

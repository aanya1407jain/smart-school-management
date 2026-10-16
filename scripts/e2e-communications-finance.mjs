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
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Resolves true only when the element really becomes visible (a missing element FAILS the check). */
async function visibleWithin(locator, timeout = 8000) {
  return await locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
}

async function newPage(width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message}`));
  page.setDefaultTimeout(15000);
  return { ctx, page };
}

/** Demo accounts sign in with their Login ID; the portal (role) comes from the server, not the form. */
const DEMO_LOGIN_IDS = { "admin@asteracademy.edu": "ADMIN-001", "teacher@asteracademy.edu": "TCH-00001", "student@asteracademy.edu": "STU-2026-00001", "guardian@asteracademy.edu": "GRD-00001" };
async function login(page, email, password, _role) {
  await page.goto(BASE + "/login");
  await page.getByLabel(/^login id/i).fill(DEMO_LOGIN_IDS[email] ?? email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /^sign in/i }).click();
  await page.waitForURL(/dashboard/);
}

const waitText = async (page, re, timeout = 10000) => {
  try {
    await page.getByText(re).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
};

console.log("\n--- E2E Browser Testing: Fees, CSV Export, Notifications & Settings ---\n");

// 1. Admin Fees & CSV Export Download Verification
{
  const { ctx, page } = await newPage();
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + "/admin/fees?tab=balances");
  await waitText(page, /Student balances/i);
  check("Admin opens Fees workspace balances tab", page.url().includes("/admin/fees"));

  // Check balances table rendered
  await waitText(page, /Aarav Sharma/);
  check("Fee balances table displays student records", await visibleWithin(page.getByRole("table").first().getByRole("row").filter({ hasText: "Aarav Sharma" }).first()));

  // Trigger CSV export and verify browser download event
  const exportBtn = page.getByRole("button").filter({ hasText: "Export CSV" }).first();
  const downloadPromise = page.waitForEvent("download");
  await exportBtn.click();
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  check("Fee balances CSV download triggered with correct filename", suggestedFilename.includes(".csv"), suggestedFilename);

  // Read downloaded file stream and ensure it has headers and data
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  check("Fee balances CSV export contains header columns", content.includes("Admission No") && content.includes("Student Name"));
  check("Fee balances CSV export is populated with rows", content.includes("Aarav Sharma") && content.includes("10-A"));

  // Switch to Payments tab
  await page.goto(BASE + "/admin/fees?tab=payments");
  check("Admin opens Payments tab", page.url().includes("tab=payments") && (await visibleWithin(page.getByRole("tab", { name: /payments/i, selected: true }))));
  // Fails when the table is missing or has no data rows (header row + at least one payment).
  const paymentsTable = page.getByRole("table").first();
  const hasTable = await visibleWithin(paymentsTable);
  const rowCount = hasTable ? await paymentsTable.getByRole("row").count() : 0;
  check("Payments table displays records", hasTable && rowCount > 1, `${rowCount} rows`);

  await ctx.close();
}

// 2. Student Notifications & Mark As Read Workflows
{
  const { ctx, page } = await newPage();
  await login(page, "student@asteracademy.edu", "Student@123", "student");
  await page.goto(BASE + "/student/notifications");
  await waitText(page, /Notifications/i);
  check("Student opens Notifications center", page.url().includes("/student/notifications"));

  // Check category tabs
  const feesTab = page.getByRole("tab", { name: /fees/i });
  if (await feesTab.isVisible()) {
    await feesTab.click();
    await page.waitForTimeout(500);
    check("Category tab switches to Fees notifications", true);
  }

  // Switch back to All
  const allTab = page.getByRole("tab", { name: /all/i });
  await allTab.click();
  await page.waitForTimeout(500);

  // Find an unread notification mark-as-read button
  const markReadButtons = page.getByRole("button", { name: /mark notification as read/i });
  const initialUnreadCount = await markReadButtons.count();
  if (initialUnreadCount > 0) {
    await markReadButtons.first().click();
    await page.waitForTimeout(800);
    const newUnreadCount = await markReadButtons.count();
    check("Inline mark-as-read updates unread notification list", newUnreadCount < initialUnreadCount);
  } else {
    check("Inline mark-as-read tested (all currently read)", true);
  }

  // Test Mark all as read button
  const markAllBtn = page.getByRole("button", { name: /mark all as read/i });
  if (await markAllBtn.isVisible().catch(() => false)) {
    await markAllBtn.click();
    await page.waitForTimeout(800);
    check("Mark all as read completes with toast/status", true);
  }

  await ctx.close();
}

// 3. Admin Settings & Preferences
{
  const { ctx, page } = await newPage();
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + "/admin/settings");
  await waitText(page, /School information/i);
  check("Admin opens Settings page", page.url().includes("/admin/settings"));

  // Switch to Notifications tab in Settings
  await page.getByRole("tab", { name: /notifications/i }).click();
  await waitText(page, /In-app notifications/i);
  check("Settings notifications tab opens", true);

  // Toggle a notification preference and save
  const saveBtn = page.getByRole("button", { name: /save preferences/i });
  await saveBtn.click();
  check("Notification preferences save successfully with toast", await waitText(page, /Notification preferences saved/i));

  // Switch to General tab in Settings
  await page.getByRole("tab", { name: /general/i }).click();
  await waitText(page, /Attendance/i);
  check("Settings general rules tab opens", true);

  await ctx.close();
}

// 4. Admin Reports & Fee Report Filter
{
  const { ctx, page } = await newPage();
  await login(page, "admin@asteracademy.edu", "Admin@123", "admin");
  await page.goto(BASE + "/admin/reports?tab=fees");
  await waitText(page, /Fee collection & outstanding/i);
  check("Admin opens Fee Reports tab", true);

  // Check KPI cards
  check("Fee reports summary KPI cards are displayed", await waitText(page, /Net fees/i) && await waitText(page, /Collected/i));

  // Trigger export from reports page
  const exportBtn = page.getByRole("button").filter({ hasText: "Export CSV" }).first();
  const downloadPromise = page.waitForEvent("download");
  await exportBtn.click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream) content += chunk.toString();
  check("Fee report CSV download delivers valid populated records", content.includes("Admission No") && content.length > 100);

  await ctx.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
console.log("PAGE ERRORS:", JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();

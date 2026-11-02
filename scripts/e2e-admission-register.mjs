import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const waitText = async (page, re, timeout = 10000) => {
  try {
    await page.getByText(re).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
};

async function login(page, loginId, password) {
  await page.goto(BASE + "/login");
  await page.getByLabel(/^login id/i).fill(loginId);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /^sign in/i }).click();
  await page.waitForURL(/dashboard/);
}

async function logout(page) {
  await page.getByRole("button", { name: /open profile menu/i }).click();
  await page.getByRole("menuitem", { name: /log out/i }).click();
  await page.waitForURL(/\/login/);
}

// 1. Admin Admission Register (CSR) verification & CSV export
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();

  await login(page, "ADMIN-001", "Admin@123");
  await page.goto(BASE + "/admin/students");

  // Verify tab exists and click it
  const csrTab = page.getByRole("tab", { name: /admission register \(csr\)/i });
  await csrTab.waitFor();
  check("CSR Tab is visible for Admin", await csrTab.isVisible());
  await csrTab.click();

  // Verify table is displayed with headers
  check("CSR Table header 'Admission No.' visible", await waitText(page, /Admission No\./i));
  check("CSR Table header 'Student' visible", await waitText(page, /^Student$/));
  check("CSR Table header 'Current placement' visible", await waitText(page, /^Current placement$/));
  check("CSR Table header 'Parent contact' visible", await waitText(page, /^Parent contact$/));

  // Verify live student records appear with Scholar number
  check("CSR Student row appears (Aarav Sharma)", await waitText(page, /Aarav Sharma/));
  check("CSR Scholar number appears", await waitText(page, /Scholar:\s*0246CBSE/i));

  // Test search filter
  const searchInput = page.getByPlaceholder(/search admission no\., scholar no\., name\.\.\./i);
  await searchInput.fill("Aarav");
  await page.waitForTimeout(500);
  check("CSR Search filters to Aarav Sharma", await waitText(page, /Aarav Sharma/));

  // Clear search
  await searchInput.fill("");
  await page.waitForTimeout(500);

  // Test CSV export button
  const exportBtn = page.getByRole("button", { name: /download register \(csv\)/i });
  check("CSR Download register (CSV) button is visible and enabled", await exportBtn.isVisible() && await exportBtn.isEnabled());

  // Listen for browser download event
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await exportBtn.click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  check("CSR CSV Download triggered", filename.endsWith(".csv"), filename);

  const downloadPath = await download.path();
  if (downloadPath && fs.existsSync(downloadPath)) {
    const content = fs.readFileSync(downloadPath, "utf-8");
    const lines = content.trim().split("\r\n");
    check("CSR CSV has content with header and data rows", lines.length > 5, `${lines.length} lines`);
    check("CSR CSV contains Admission No. header", lines[0].includes("Admission No."));
    check("CSR CSV contains Aarav Sharma record", content.includes("Aarav Sharma"));
  } else {
    check("CSR CSV file saved on disk", false, "Path not found");
  }

  await logout(page);
  await ctx.close();
}

// 2. Permission check: Teacher blocked from admin students page
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await login(page, "TCH-00001", "Teacher@123");
  await page.goto(BASE + "/admin/students");
  check("Teacher cannot access admin students route", await waitText(page, /don't have access|denied/i) || page.url().includes("/teacher/dashboard"));

  await logout(page);
  await ctx.close();
}

// 3. Permission check: Student blocked from admin students page
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await login(page, "STU-2026-00001", "Student@123");
  await page.goto(BASE + "/admin/students");
  check("Student cannot access admin students route", await waitText(page, /don't have access|denied/i) || page.url().includes("/student/dashboard"));

  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\nCSR Verification: ${results.length - failed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

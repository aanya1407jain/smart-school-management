// Responsive layout audit: signs in to each portal with the development demo
// accounts (same ones scripts/e2e.mjs uses), opens every route at phone,
// tablet and desktop widths, and reports horizontal page overflow (with the
// elements that cause it) and page errors. Read-only: it never submits forms.
//   BASE_URL=http://localhost:3000 node scripts/responsive-audit.mjs [--shots dir] [--only /admin/dashboard,...]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
// --only /admin/fees,/admin/students/* — exact routes, or a prefix ending in "*" (matches the dynamic detail page found on the list page).
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const wanted = (r) => !only || only.some((o) => (o.endsWith("*") ? r.startsWith(o.slice(0, -1)) && !/\/(new|edit|marks)$/.test(r) : o === r));
const WIDTHS = (process.env.WIDTHS ?? "320,375,768,1024,1440").split(",").map(Number);

const CHROME = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

const PORTALS = [
  { role: "admin", loginId: "admin-001", password: "Admin@123", routes: ["/admin/dashboard", "/admin/students", "/admin/students/new", "/admin/promotions", "/admin/academics", "/admin/teachers", "/admin/teachers/new", "/admin/accounts", "/admin/permissions", "/admin/attendance", "/admin/fees", "/admin/examinations", "/admin/examinations/marks", "/admin/timetable", "/admin/notices", "/admin/notifications", "/admin/reports", "/admin/audit", "/admin/settings", "/admin/profile", "/account"],
    dynamic: [["/admin/students", /^\/admin\/students\/(?!new)[^/]+$/], ["/admin/teachers", /^\/admin\/teachers\/(?!new)[^/]+$/], ["/admin/examinations", /^\/admin\/examinations\/(?!marks)[^/]+$/], ["/admin/fees", /^\/admin\/fees\/[^/]+$/]] },
  { role: "teacher", loginId: "tch-00001", password: "Teacher@123", routes: ["/teacher/dashboard", "/teacher/classes", "/teacher/attendance", "/teacher/examinations", "/teacher/examinations/marks", "/teacher/homework", "/teacher/timetable", "/teacher/notices", "/teacher/notifications", "/teacher/profile", "/teacher/settings"],
    dynamic: [["/teacher/classes", /^\/teacher\/classes\/[^/]+$/], ["/teacher/homework", /^\/teacher\/homework\/[^/]+$/], ["/teacher/examinations", /^\/teacher\/examinations\/(?!marks)[^/]+$/]] },
  { role: "student", loginId: "STU-2026-00001", password: "Student@123", routes: ["/student/dashboard", "/student/attendance", "/student/certificates", "/student/fees", "/student/homework", "/student/notices", "/student/notifications", "/student/profile", "/student/results", "/student/timetable", "/student/settings"], dynamic: [] },
];

/** Elements wider than the viewport that are NOT inside a horizontal scroll container (those are fine). */
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const scrollsX = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1) return true; } return false; };
  const culprits = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1 || getComputedStyle(el).position === "fixed") continue;
    if (scrollsX(el)) continue;
    const id = `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${String(el.className).split(" ").slice(0, 4).join(".")}`;
    culprits.push(`${id} → right ${Math.round(r.right)}px`);
    if (culprits.length >= 4) break;
  }
  // Date fields need ~140px to show dd/mm/yyyy at 16px next to the calendar button.
  const narrowDates = [...document.querySelectorAll("main input[type=date]")].filter((i) => i.offsetParent && i.clientWidth < 140).map((i) => `input[type=date] ${i.clientWidth}px`);
  return { overflow: document.documentElement.scrollWidth - vw, culprits: [...culprits, ...narrowDates] };
};

/**
 * Wait until the page is really rendered: past the session check (the shell's
 * <main>), no loading placeholders left in it, and the route fade-in finished.
 * Measuring earlier would only measure the loading screen.
 */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("main#main, main").first().waitFor({ timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => {
    const main = document.querySelector("main");
    if (!main || /Checking your session/.test(document.body.innerText)) return false;
    return ![...main.querySelectorAll("[role=status]")].some((s) => /loading/i.test(s.textContent + (s.getAttribute("aria-label") ?? "")));
  }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
}

const report = [];

// The public sign-in page, measured (and photographed with --shots) before signing in.
if (!only || only.includes("/login")) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    await page.goto(BASE + "/login");
    await page.getByLabel(/^login id/i).waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(900);
    const m = await page.evaluate(MEASURE);
    report.push({ role: "public", route: "/login", width, overflow: m.overflow, culprits: m.culprits, errors: [] });
    console.log(`${m.overflow > 0 ? "OVERFLOW" : m.culprits.length ? "CLIPPED " : "ok      "} ${String(width).padStart(4)} /login`);
    if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, `public_login_${width}.png`), fullPage: true }); }
  }
  await ctx.close();
}
for (const portal of PORTALS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.setDefaultTimeout(20000);
  try {
    await page.goto(BASE + "/login");
    await page.getByLabel(/^login id/i).waitFor({ timeout: 60000 });
    await page.getByLabel(/^login id/i).fill(portal.loginId);
    await page.getByLabel(/^password/i).fill(portal.password);
    await page.getByRole("button", { name: /^sign in/i }).click();
    await page.waitForURL(/dashboard|account/, { timeout: 60000 });
  } catch (e) {
    report.push({ role: portal.role, route: "(sign-in)", width: "-", overflow: "-", note: `sign-in failed, portal untested: ${e.message.split("\n")[0]}` });
    console.log(`SKIPPED ${portal.role} portal — sign-in failed: ${e.message.split("\n")[0]}`);
    await ctx.close();
    continue;
  }

  const routes = [...portal.routes];
  for (const [list, re] of portal.dynamic) {
    await page.goto(BASE + list); await settle(page);
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    const hit = hrefs.find((h) => h && re.test(h.split("?")[0]));
    if (hit) routes.push(hit.split("?")[0]); else report.push({ role: portal.role, route: `${list}/[dynamic]`, width: "-", overflow: "-", note: "no detail link found (untested)" });
  }

  for (const route of routes.filter(wanted)) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
      errors.length = 0;
      try { await page.goto(BASE + route); } catch (e) { report.push({ role: portal.role, route, width, overflow: "-", note: `navigation failed: ${e.message.split("\n")[0]}` }); console.log(`FAILED   ${width} ${route}`); continue; }
      await settle(page);
      const m = await page.evaluate(MEASURE);
      const row = { role: portal.role, route, width, overflow: m.overflow, culprits: m.culprits, errors: [...new Set(errors)].slice(0, 3) };
      report.push(row);
      const flag = m.overflow > 0 ? "OVERFLOW" : m.culprits.length ? "CLIPPED " : "ok      ";
      console.log(`${flag} ${String(width).padStart(4)} ${route}${m.culprits.length ? ` (+${m.overflow}px) ${m.culprits.join(" | ")}` : ""}${row.errors.length ? `  ERR: ${row.errors[0].slice(0, 140)}` : ""}`);
      if (shotsDir) {
        fs.mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: path.join(shotsDir, `${portal.role}${route.replace(/\//g, "_")}_${width}.png`), fullPage: true });
      }
    }
  }
  await ctx.close();
}
await browser.close();
const bad = report.filter((r) => typeof r.overflow === "number" && r.overflow > 0);
console.log(`\n${report.length} checks · ${bad.length} with horizontal overflow · ${report.filter((r) => !(r.overflow > 0) && r.culprits?.length).length} with clipped fields ·${report.filter((r) => r.errors?.length).length} with console/page errors`);
fs.writeFileSync(process.env.REPORT ?? "responsive-audit.json", JSON.stringify(report, null, 2));

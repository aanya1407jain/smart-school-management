/**
 * LOAD TEST — bulk student-account creation at realistic scale against a REAL
 * Convex deployment. It WRITES data (imports synthetic students and creates
 * their accounts), so run it ONLY against a disposable deployment seeded with
 * the demo school (e.g. a local backend):
 *
 *   LOAD_TEST_DISPOSABLE=yes CONVEX_URL=http://127.0.0.1:3210 STUDENTS=1050 \
 *     npx tsx --tsconfig tsconfig.json scripts/bulk-accounts-load.ts
 *
 * Steps: sign in as the demo admin → import STUDENTS synthetic students spread
 * over the demo sections (300-row imports) → verify each touched section is
 * numbered 1..n alphabetically → create accounts for ALL students without one
 * through the bulk workflow (prepare → start → batches) → verify counts,
 * unique Login IDs and timing. Passwords are counted, never printed.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const URL = process.env.CONVEX_URL;
const N = Number(process.env.STUDENTS ?? 1050);
if (process.env.LOAD_TEST_DISPOSABLE !== "yes" || !URL) {
  console.error("Refusing to run: set LOAD_TEST_DISPOSABLE=yes and CONVEX_URL to a DISPOSABLE deployment (this script writes data).");
  process.exit(2);
}

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

async function main() {
  const c = new ConvexHttpClient(URL!);
  const r = await c.action(api.auth.signIn, { provider: "password", params: { loginId: process.env.ADMIN_LOGIN_ID ?? "ADMIN-001", password: process.env.ADMIN_PASSWORD ?? "Admin@123", flow: "signIn" } });
  c.setAuth(r.tokens!.token);
  const today = new Date().toISOString().slice(0, 10);
  const sections = await c.query(api.academics.listSections, {});
  const run = Date.now().toString(36).toUpperCase();

  // 1. Import N synthetic students, round-robin over the sections, 300 rows per import.
  const rows = Array.from({ length: N }, (_, i) => {
    const s = sections[i % sections.length];
    const [level, name] = s.displayName.split("-");
    const first = String.fromCharCode(65 + ((i * 7) % 26)) + `oad${String(i).padStart(4, "0")}`;
    return { rowNumber: i + 2, values: { firstName: first, lastName: `Test${run}`, className: level, section: name, admissionNo: `LT-${run}-${i}` } };
  });
  let t0 = Date.now();
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300).map((row, j) => ({ ...row, rowNumber: j + 2 }));
    await c.mutation(api.imports.commitStudentRows, { rows: chunk, createAccounts: false, today });
  }
  check(`Imported ${N} students in ${Math.ceil(N / 300)} imports`, true, `${Date.now() - t0} ms`);

  // 2. Every section: roll numbers 1..n, alphabetical.
  let rosterOk = true;
  for (const s of sections) {
    const roster = await c.query(api.students.sectionRoster, { sectionId: s._id });
    const nums = roster.students.map((x) => x.rollNo);
    const names = roster.students.map((x) => x.name.toLowerCase().replace(/\s+/g, " "));
    if (nums.some((n, i) => n !== i + 1) || names.some((n, i) => i > 0 && names[i - 1].split(" ")[0] > n.split(" ")[0])) rosterOk = false;
  }
  check("All sections numbered 1..n alphabetically after the imports", rosterOk);

  // 3. Bulk accounts for ALL students without an account.
  const before = await c.query(api.bulkAccounts.scopeCounts, {});
  const expected = before.withoutAccount;
  t0 = Date.now();
  const jobId = await c.mutation(api.bulkAccounts.createJob, { scope: { type: "all" } });
  let pages = 0;
  for (;;) { pages++; if ((await c.mutation(api.bulkAccounts.prepareJob, { jobId })).done) break; }
  const ready = await c.query(api.bulkAccounts.getJob, { jobId });
  check(`Snapshot: ${ready.total} students in ${pages} page(s), ${ready.queued} to create`, ready.queued === expected, `expected ${expected}`);
  await c.mutation(api.bulkAccounts.startJob, { jobId });
  const logins = new Set<string>();
  let passwords = 0, batches = 0;
  for (;;) {
    const res = await c.action(api.bulkAccounts.processBatch, { jobId });
    batches++;
    for (const cr of res.credentials) { logins.add(cr.loginId); if (cr.temporaryPassword) passwords++; }
    if (res.credentials.length) await c.mutation(api.bulkAccounts.acknowledge, { jobId, itemIds: res.credentials.map((x) => x.itemId) });
    if (batches % 10 === 0) { const j = await c.query(api.bulkAccounts.getJob, { jobId }); console.log(`  … ${j.created + j.skipped + j.failed} of ${j.total} processed`); }
    if (res.done) break;
  }
  const ms = Date.now() - t0;
  const job = await c.query(api.bulkAccounts.getJob, { jobId });
  check(`Created ${job.created} accounts in ${batches} batch calls`, job.status === "completed" && job.created === expected && job.failed === 0, `${ms} ms total, ${Math.round(ms / Math.max(1, job.created))} ms/account`);
  check("Every created account has a unique Login ID and one delivered temporary password", logins.size === job.created && passwords === job.created && job.undelivered === 0);
  const after = await c.query(api.bulkAccounts.scopeCounts, {});
  check("No student is left without an account; none has two", after.withoutAccount === 0 && after.withAccount === before.total);
  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(String(e?.message ?? e).slice(0, 400)); process.exit(1); });

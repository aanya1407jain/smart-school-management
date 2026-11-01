/**
 * Module selection and inclusion planning (dry run — nothing is copied).
 *
 * `resolveClosure` validates a product's module selection against REQUIRES and
 * never adds a module silently. `inclusionPlan` lists which files of the CURRENT
 * tree a product would ship and which shipped files still depend on modules the
 * product excludes ("blockers"). The export script (later step) refuses to run
 * while blockers or transitional files remain; until then the blocker list is a
 * ratchet (docs/modularization/sa-blockers-baseline.json for Students + Attendance).
 *
 *   npx tsx scripts/modularity/select.ts students attendance
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { REQUIRES, TARGET_MODULES, findRequiresCycle, ownerOf, type Owner, type TargetModule } from "./ownership";
import { scan, violationKey, type Violation } from "./boundaries";

export type BusinessModule = Exclude<TargetModule, "core">;
export const BUSINESS_MODULES = TARGET_MODULES.filter((m): m is BusinessModule => m !== "core");

export type SelectionProblem = { code: "UNKNOWN_MODULE" | "DUPLICATE" | "MISSING_REQUIRED" | "CYCLE" | "EMPTY"; detail: string };

export function resolveClosure(selection: readonly string[]): { modules: BusinessModule[]; problems: SelectionProblem[] } {
  const problems: SelectionProblem[] = [];
  if (selection.length === 0) problems.push({ code: "EMPTY", detail: "Choose at least one module." });
  const seen = new Set<string>();
  for (const id of selection) {
    if (!(BUSINESS_MODULES as readonly string[]).includes(id)) problems.push({ code: "UNKNOWN_MODULE", detail: `Unknown module "${id}".` });
    else if (seen.has(id)) problems.push({ code: "DUPLICATE", detail: `Module "${id}" is listed twice.` });
    seen.add(id);
  }
  const cycle = findRequiresCycle();
  if (cycle) problems.push({ code: "CYCLE", detail: `Required-module cycle: ${cycle.join(" → ")}` });
  for (const id of seen) {
    if (!(BUSINESS_MODULES as readonly string[]).includes(id)) continue;
    for (const dep of REQUIRES[id as BusinessModule]) {
      if (dep !== "core" && !seen.has(dep)) problems.push({ code: "MISSING_REQUIRED", detail: `${id} requires ${dep}; add it to the product (modules are never added automatically).` });
    }
  }
  const modules = BUSINESS_MODULES.filter((m) => seen.has(m));
  return { modules, problems };
}

export type InclusionPlan = {
  modules: BusinessModule[];
  excludedModules: BusinessModule[];
  included: string[];
  excluded: string[];
  /** Files mixing several owners; must be split before a customer export. */
  transitional: string[];
  /** Included files that still depend on an excluded module. Must reach zero. */
  blockers: Violation[];
};

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!["node_modules", "_generated", ".next"].includes(e.name)) walk(p); }
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(join(root, "src"));
  walk(join(root, "convex"));
  return out.sort();
}

export function inclusionPlan(root: string, selection: readonly string[]): InclusionPlan {
  const { modules, problems } = resolveClosure(selection);
  if (problems.length) throw new Error(problems.map((p) => p.detail).join(" "));
  const shipped = new Set<Owner>(["core", ...modules]);
  const excludedModules = BUSINESS_MODULES.filter((m) => !modules.includes(m));
  const plan: InclusionPlan = { modules, excludedModules, included: [], excluded: [], transitional: [], blockers: [] };
  for (const f of listFiles(root)) {
    const o = ownerOf(f);
    if (o === "transitional") plan.transitional.push(f);
    else if (o && shipped.has(o)) plan.included.push(f);
    else plan.excluded.push(f);
  }
  plan.blockers = scan(root).violations.filter((v) => shipped.has(v.fromOwner) && (excludedModules as readonly string[]).includes(v.toOwner));
  return plan;
}

export const SA_BLOCKERS_PATH = "docs/modularization/sa-blockers-baseline.json";

// CLI
const isMain = typeof process !== "undefined" && process.argv[1] && /select\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const root = resolve(dirname(process.argv[1]), "..", "..");
  const selection = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const plan = inclusionPlan(root, selection);
  if (process.argv.includes("--write-sa-baseline")) {
    writeFileSync(join(root, SA_BLOCKERS_PATH), JSON.stringify({ note: "Students + Attendance export blockers: Core/Students/Attendance files that still depend on Academics, Fees or Examinations. Must shrink to zero before the export (tests/convex/module-selection.test.ts).", blockers: plan.blockers.map(violationKey) }, null, 2) + "\n");
  }
  console.log(JSON.stringify({
    modules: plan.modules, excluded: plan.excludedModules,
    files: { included: plan.included.length, excluded: plan.excluded.length, transitional: plan.transitional.length },
    blockers: plan.blockers.map(violationKey),
  }, null, 2));
}

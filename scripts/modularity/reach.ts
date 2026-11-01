/**
 * Frontend reachability for a product: which src/ files the product's pages
 * (Core + selected module routes, plus app-shell files) actually import, with
 * their owners. Used while cutting the demo layer and transitional shells out
 * of shipped code; the export script relies on ownership, not on this.
 *
 *   npx tsx scripts/modularity/reach.ts students attendance
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ownerOf } from "./ownership";
import { resolveClosure } from "./select";
import { core } from "./manifests/core";
import { MANIFESTS } from "./manifests/modules";

const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(root: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2));
  else if (spec.startsWith("@convex/")) base = join(root, "convex", spec.slice(8));
  else if (spec.startsWith(".")) base = resolve(dirname(join(root, from)), spec);
  else return null;
  for (const e of ["", ...EXT]) {
    const p = base + e;
    if (existsSync(p) && /\.(ts|tsx)$/.test(p)) return relative(root, p).replace(/\\/g, "/");
  }
  return null;
}

export function importsOf(root: string, file: string): string[] {
  const src = readFileSync(join(root, file), "utf8");
  const specs = [...src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
  return specs.map((s) => resolveImport(root, file, s)).filter((x): x is string => !!x && !x.includes("/_generated/"));
}

/** App-router files that are not pages but are always part of the shell (layouts, error pages, global styles). */
export function shellFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^(layout|error|not-found|loading|global-error|template)\.tsx$/.test(e.name)) out.push(relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(join(root, "src/app"));
  return out;
}

export function reachable(root: string, selection: readonly string[]): Map<string, string[]> {
  const { modules, problems } = resolveClosure(selection);
  if (problems.length) throw new Error(problems.map((p) => p.detail).join(" "));
  const routes = [...core.routes, ...MANIFESTS.filter((m) => (modules as readonly string[]).includes(m.id)).flatMap((m) => m.routes)].map((r) => r.file);
  const seen = new Map<string, string[]>(); // file -> importers
  const queue = [...routes, ...shellFiles(root)];
  for (const f of queue) seen.set(f, []);
  while (queue.length) {
    const f = queue.shift()!;
    if (ownerOf(f) === "composition") continue; // regenerated per product by the export script
    for (const d of importsOf(root, f)) {
      if (!seen.has(d)) { seen.set(d, [f]); queue.push(d); }
      else seen.get(d)!.push(f);
    }
  }
  return seen;
}

const isMain = typeof process !== "undefined" && process.argv[1] && /reach\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const root = resolve(dirname(process.argv[1]), "..", "..");
  const selection = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const { modules } = resolveClosure(selection);
  const shipped = new Set<string>(["core", "composition", ...modules]);
  const seen = reachable(root, selection);
  const bad = [...seen].filter(([f]) => !shipped.has(ownerOf(f) ?? "?"));
  for (const [f, by] of bad.sort()) console.log(`${ownerOf(f)}\t${f}\t<- ${by.slice(0, 4).join(", ")}${by.length > 4 ? ` (+${by.length - 4})` : ""}`);
  console.log(`${seen.size} reachable files, ${bad.length} not shippable`);
}

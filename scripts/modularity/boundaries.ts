/**
 * Module boundary scanner (read-only). Walks src/ and convex/, resolves every
 * import (`@/`, `@convex/`, relative), every `api.<file>` / `internal.<file>`
 * reference, every `ctx.db.query/insert("table")` / `getInSchool(ctx, "table")`
 * and every `v.id("table")` in convex/schema.ts, and reports dependencies that
 * the target ownership (./ownership.ts) forbids.
 *
 * Violation kinds:
 *   import  a source file imports a file it may not depend on
 *   api     a source file calls a Convex function file it may not depend on
 *   table   a Convex file reads/writes a table it may not depend on
 *   schema  a table's v.id() field references a table its owner may not depend on
 *   entry   an allowed dependency bypasses the target module's public entry (V9)
 *
 *   npx tsx scripts/modularity/boundaries.ts            # print the report
 *   npx tsx scripts/modularity/boundaries.ts --baseline # rewrite the baseline
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { PUBLIC_ENTRIES, TABLE_OWNER, mayDepend, ownerOf, type Owner, type TargetModule } from "./ownership";

export type ViolationKind = "import" | "api" | "table" | "schema" | "entry";
export type Violation = { kind: ViolationKind; from: string; to: string; fromOwner: Owner; toOwner: Owner | "unknown" };

export type BoundaryReport = {
  files: number;
  unowned: string[];
  owners: Record<string, number>;
  violations: Violation[];
  /** Tables accessed in convex/ that have no owner in TABLE_OWNER. */
  unownedTables: string[];
};

export type ScanOptions = { publicEntries?: Partial<Record<TargetModule, readonly string[]>> };

const SKIP_DIRS = new Set(["node_modules", "_generated", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/**
 * Drop lines that are unambiguously comments (start with `//`, `/*`, `*` or end a
 * block). Conservative on purpose: a trailing `// …` after code is kept, so the
 * scan may over-report but can never hide real code (regex/string contents are
 * never parsed as comment delimiters).
 */
export function stripCommentLines(src: string): string {
  return src
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? "" : line))
    .join("\n");
}

/**
 * Public-entry rule (V9): when `toOwner` is a module that declares public entries,
 * a file of another owner may only import one of those entries. Modules without
 * declared entries are not checked yet (dormant until extraction).
 */
export function bypassesPublicEntry(fromOwner: Owner, target: string, toOwner: Owner, entries: Partial<Record<TargetModule, readonly string[]>>): boolean {
  if (fromOwner === toOwner || toOwner === "core" || toOwner === "transitional" || toOwner === "composition" || toOwner === "demo") return false;
  const declared = entries[toOwner];
  if (!declared || declared.length === 0) return false;
  return !declared.includes(target);
}

/** Tables declared in convex/schema.ts with the tables their v.id() fields reference. */
export function schemaReferences(root: string): { table: string; refs: string[] }[] {
  const src = readFileSync(join(root, "convex", "schema.ts"), "utf8");
  const starts = [...src.matchAll(/^\s{2}(\w+):\s*defineTable\(/gm)].map((m) => ({ table: m[1], at: m.index ?? 0 }));
  return starts.map((s, i) => {
    const body = stripCommentLines(src.slice(s.at, starts[i + 1]?.at ?? src.length));
    return { table: s.table, refs: [...new Set([...body.matchAll(/v\.id\(\s*["'](\w+)["']\s*\)/g)].map((m) => m[1]))].sort() };
  });
}

export function scan(root: string, options: ScanOptions = {}): BoundaryReport {
  const entries = options.publicEntries ?? PUBLIC_ENTRIES;
  const rel = (p: string) => relative(root, p).replace(/\\/g, "/");
  const files = [...walk(join(root, "src")), ...walk(join(root, "convex"))];
  const known = new Set(files.map(rel));
  const resolveSpec = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2));
    else if (spec.startsWith("@convex/")) base = join(root, "convex", spec.slice(8));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    else return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const r = rel(base + ext);
      if (known.has(r)) return r;
    }
    return null;
  };

  const owners: Record<string, number> = {};
  const unowned: string[] = [];
  const violations: Violation[] = [];
  const unownedTables = new Set<string>();
  const seen = new Set<string>();
  const add = (v: Violation) => {
    const key = `${v.kind}|${v.from}|${v.to}`;
    if (!seen.has(key)) { seen.add(key); violations.push(v); }
  };
  const checkFile = (kind: "import" | "api", file: string, owner: Owner, target: string) => {
    const to = ownerOf(target);
    if (!to) return;
    if (!mayDepend(owner, to)) add({ kind, from: file, to: target, fromOwner: owner, toOwner: to });
    else if (kind === "import" && bypassesPublicEntry(owner, target, to, entries)) add({ kind: "entry", from: file, to: target, fromOwner: owner, toOwner: to });
  };

  for (const abs of files) {
    const file = rel(abs);
    const owner = ownerOf(file);
    if (!owner) { unowned.push(file); continue; }
    owners[owner] = (owners[owner] ?? 0) + 1;
    const src = stripCommentLines(readFileSync(abs, "utf8"));

    for (const m of src.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveSpec(abs, m[1] ?? m[2]);
      if (target) checkFile("import", file, owner, target);
    }
    for (const m of src.matchAll(/\b(?:api|internal)\.(\w+)\./g)) {
      const target = `convex/${m[1]}.ts`;
      if (known.has(target)) checkFile("api", file, owner, target);
    }
    if (file.startsWith("convex/")) {
      const tables = [
        // `ctx.db` and `.query("t")` may be on separate lines.
        ...[...src.matchAll(/ctx\.db\s*\.\s*(?:query|insert)\(\s*["'](\w+)["']/g)].map((x) => x[1]),
        ...[...src.matchAll(/getInSchool\([^,()]+,\s*["'](\w+)["']/g)].map((x) => x[1]),
      ];
      for (const t of new Set(tables)) {
        const to = TABLE_OWNER[t];
        if (!to) { unownedTables.add(t); continue; }
        if (!mayDepend(owner, to)) add({ kind: "table", from: file, to: t, fromOwner: owner, toOwner: to });
      }
    }
  }

  for (const { table, refs } of schemaReferences(root)) {
    const from = TABLE_OWNER[table];
    if (!from) continue; // reported by the ownership test
    for (const r of refs) {
      const to = TABLE_OWNER[r];
      if (!to) { unownedTables.add(r); continue; }
      if (!mayDepend(from, to)) add({ kind: "schema", from: `convex/schema.ts#${table}`, to: r, fromOwner: from, toOwner: to });
    }
  }

  violations.sort((a, b) => `${a.kind}|${a.from}|${a.to}`.localeCompare(`${b.kind}|${b.from}|${b.to}`));
  return { files: files.length, unowned: unowned.sort(), owners, violations, unownedTables: [...unownedTables].sort() };
}

/** Table names declared in convex/schema.ts (top-level `name: defineTable(`). */
export function schemaTables(root: string): string[] {
  return schemaReferences(root).map((t) => t.table).sort();
}

export const BASELINE_PATH = "docs/modularization/boundary-baseline.json";
export const violationKey = (v: Violation) => `${v.kind} ${v.from} -> ${v.to}`;

// CLI
const isMain = typeof process !== "undefined" && process.argv[1] && /boundaries\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  const root = resolve(dirname(process.argv[1]), "..", "..");
  const report = scan(root);
  const keys = report.violations.map(violationKey);
  if (process.argv.includes("--baseline")) {
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify({ note: "Known module-boundary violations at the start of the extraction. This list may only shrink (tests/convex/module-boundaries.test.ts).", violations: keys }, null, 2) + "\n");
    console.log(`Baseline written: ${keys.length} violations.`);
  } else {
    const byPair: Record<string, number> = {};
    for (const v of report.violations) byPair[`${v.kind}: ${v.fromOwner} -> ${v.toOwner}`] = (byPair[`${v.kind}: ${v.fromOwner} -> ${v.toOwner}`] ?? 0) + 1;
    console.log(JSON.stringify({ files: report.files, owners: report.owners, unowned: report.unowned, unownedTables: report.unownedTables, violations: keys.length, byPair }, null, 2));
  }
}

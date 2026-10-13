"use client";
/**
 * Bulk import: choose → upload (CSV/XLSX) → map columns → server preview →
 * confirm (all-or-nothing commit, re-validated on the server) → report and,
 * optionally, issue account credentials. Generic over the specs in
 * convex/model/importSpecs.ts.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Rows3, Upload, XCircle } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge, Button, Card, Checkbox, FormField, Segmented, Select, StatCard, useToast } from "@/components/ui";
import { useSchoolAction, useSchoolMutation, useSchoolQueryRunner } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { IMPORT_SPECS, MAX_IMPORT_ROWS, bestSheetIndex, matchColumns, missingRequiredFields, templateRows, type ImportTarget } from "@convex/model/importSpecs";
import { downloadCsv, readSpreadsheet, type ParsedSheet } from "@/features/imports/spreadsheet";
import { todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { CredentialsModal, type FailedCredential, type IssuedCredential } from "./credentials-modal";

type Step = "upload" | "map" | "preview" | "done";
type Row = { rowNumber: number; values: Record<string, string> };
type Issue = { field: string; message: string };
type RowResult = { rowNumber: number; label: string; status: "valid" | "warning" | "invalid"; errors: Issue[]; warnings: Issue[] };
type Preview = { results: RowResult[]; summary: { total: number; valid: number; warnings: number; invalid: number; duplicates: number } };
type Created = { rowNumber: number; name: string; membershipId?: string; loginId?: string };

const ISSUE_CHUNK = 50;

export function ImportWizard({ allowed, canCreateAccounts }: { allowed: ImportTarget[]; canCreateAccounts: boolean }) {
  const { toast } = useToast();
  const [target, setTarget] = useState<ImportTarget>(allowed[0]);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet: ParsedSheet | null = sheets[sheetIndex] ?? null;
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [createAccounts, setCreateAccounts] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState<"all" | "problems">("problems");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created[]>([]);
  const [issued, setIssued] = useState<IssuedCredential[]>([]);
  const [failures, setFailures] = useState<FailedCredential[]>([]);
  const [showCreds, setShowCreds] = useState(false);

  const spec = IMPORT_SPECS[target];
  const previewStudents = useSchoolQueryRunner(api.imports.previewStudents);
  const previewTeachers = useSchoolQueryRunner(api.imports.previewTeachers);
  const commitStudents = useSchoolMutation(api.imports.commitStudentRows);
  const commitTeachers = useSchoolMutation(api.imports.commitTeacherRows);
  const issuePending = useSchoolAction(api.accounts.issuePendingCredentials);

  const restart = () => {
    setStep("upload"); setSheets([]); setSheetIndex(0); setFileName(""); setMapping({}); setPreview(null); setCreated([]); setIssued([]); setFailures([]);
  };

  const rows: Row[] = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((r) => {
      const values: Record<string, string> = {};
      for (const f of spec.fields) {
        const idx = mapping[f.key];
        if (idx !== null && idx !== undefined) {
          const v = (r.cells[idx] ?? "").trim();
          if (v) values[f.key] = v;
        }
      }
      return { rowNumber: r.rowNumber, values };
    });
  }, [sheet, mapping, spec]);

  // How every source column of the selected sheet was (or was not) matched.
  const matches = useMemo(() => (sheet ? matchColumns(sheet.headings, spec) : null), [sheet, spec]);
  const missingRequired = useMemo(() => missingRequiredFields(mapping, spec), [mapping, spec]);
  const columnUse = useMemo(() => {
    const use = new Map<number, string[]>();
    for (const f of spec.fields) {
      const i = mapping[f.key];
      if (i !== null && i !== undefined) use.set(i, [...(use.get(i) ?? []), f.label]);
    }
    return use;
  }, [mapping, spec]);
  const doubleMapped = [...columnUse.entries()].filter(([, labels]) => labels.length > 1);
  const tooManyRows = !!sheet && sheet.rows.length > MAX_IMPORT_ROWS;

  const selectSheet = (index: number, list: ParsedSheet[] = sheets) => {
    setSheetIndex(index);
    setMapping(list[index] ? matchColumns(list[index].headings, spec).mapping : {});
    setPreview(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await readSpreadsheet(file);
      setSheets(parsed);
      setFileName(file.name);
      selectSheet(bestSheetIndex(parsed.map((p) => ({ headings: p.headings, rowCount: p.rows.length })), spec), parsed);
      setStep("map");
    } catch (e) {
      toast({ tone: "error", title: "Could not read the file", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const setField = (key: string, value: string) => {
    setMapping((m) => ({ ...m, [key]: value === "" ? null : Number(value) }));
    setPreview(null); // any earlier validation no longer matches the mapping
  };

  const args = () => ({ rows, createAccounts, today: todayISO() });

  const runPreview = async () => {
    setBusy(true);
    try {
      const p = target === "students" ? await previewStudents(args()) : await previewTeachers(args());
      setPreview(p);
      setFilter(p.summary.invalid + p.summary.warnings > 0 ? "problems" : "all");
      setStep("preview");
    } catch (e) {
      toast({ tone: "error", title: "Validation failed", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const result = target === "students" ? await commitStudents(args()) : await commitTeachers(args());
      const list: Created[] = result.created.map((c) => ({ rowNumber: c.rowNumber, name: c.name, membershipId: c.membershipId, loginId: c.loginId }));
      setCreated(list);
      setStep("done");
      toast({ title: `Imported ${list.length} ${spec.noun}(s)` });
      if (createAccounts) await issueFor(list);
    } catch (e) {
      toast({ tone: "error", title: "Import failed — nothing was imported", description: errorMessage(e) });
      // The data may have changed since the preview: refresh it.
      await runPreview();
    } finally {
      setBusy(false);
    }
  };

  const issueFor = async (list: Created[]) => {
    const pending = list.filter((c) => c.membershipId);
    const ok: IssuedCredential[] = [];
    const bad: FailedCredential[] = [];
    for (let i = 0; i < pending.length; i += ISSUE_CHUNK) {
      const chunk = pending.slice(i, i + ISSUE_CHUNK);
      try {
        const res = await issuePending({ targetMembershipIds: chunk.map((c) => c.membershipId as Id<"schoolMemberships">) });
        res.forEach((r, j) => {
          if (r.ok) ok.push({ loginId: r.loginId, displayName: r.displayName, temporaryPassword: r.temporaryPassword });
          else bad.push({ displayName: chunk[j].name, error: r.error });
        });
      } catch (e) {
        chunk.forEach((c) => bad.push({ displayName: c.name, error: errorMessage(e) }));
      }
    }
    setIssued(ok);
    setFailures(bad);
    setShowCreds(true);
  };

  const mappedCount = Object.values(mapping).filter((v) => v !== null && v !== undefined).length;
  const sampleFields = spec.fields.filter((f) => mapping[f.key] !== null && mapping[f.key] !== undefined);
  const shown = (preview?.results ?? []).filter((r) => filter === "all" || r.status !== "valid");

  return (
    <Card className="p-4 sm:p-5">
      <ol className="mb-5 flex flex-wrap gap-2 text-[12.5px]" aria-label="Import steps">
        {(["upload", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li key={s} aria-current={step === s ? "step" : undefined} className={cn("rounded-full px-3 py-1 ring-1 ring-inset", step === s ? "bg-sapphire text-white ring-sapphire" : "text-ink-muted ring-line")}>
            {i + 1}. {{ upload: "Upload", map: "Match columns", preview: "Review", done: "Done" }[s]}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <div className="space-y-5">
          {allowed.length > 1 && (
            <Segmented label="What are you importing?" value={target} onChange={(v) => setTarget(v)} options={allowed.map((t) => ({ value: t, label: IMPORT_SPECS[t].label }))} />
          )}
          <div className="rounded-2xl border border-dashed border-heather bg-white/60 p-6 text-center">
            <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-sapphire" aria-hidden />
            <p className="text-sm font-medium text-ink">Upload a CSV or Excel (.xlsx) file of {spec.label.toLowerCase()}</p>
            <p className="mt-1 text-[13px] text-ink-muted">First row = column headings. Up to {MAX_IMPORT_ROWS} rows per import.</p>
            <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-soft hover:bg-primary-hover">
              <Upload className="h-4 w-4" aria-hidden /> {busy ? "Reading…" : "Choose file"}
              <input
                type="file" className="sr-only" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label={`Upload ${spec.label} file`} disabled={busy}
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-muted">
            <span>Not sure about the format? Start from the template.</span>
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`${target}-import-template`, templateRows(spec))}>
              <Download className="h-4 w-4" /> Download template
            </Button>
          </div>
        </div>
      )}

      {step === "map" && sheet && matches && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-ink-soft">
              <span className="font-medium text-ink">{fileName}</span> — sheet <span className="font-medium text-ink">{sheet.name}</span>, {sheet.rows.length} data row(s).
              {" "}Match each field to a column in your file ({mappedCount} matched automatically or by you).
            </p>
            {sheets.length > 1 && (
              <FormField label="Worksheet" className="w-full sm:w-64">
                <Select value={String(sheetIndex)} onChange={(e) => selectSheet(Number(e.target.value))} aria-label="Worksheet to import">
                  {sheets.map((sh, i) => <option key={i} value={i}>{sh.name} ({sh.rows.length} row{sh.rows.length === 1 ? "" : "s"})</option>)}
                </Select>
              </FormField>
            )}
          </div>

          {target === "students" && (
            <p role="note" className="rounded-xl border border-line/80 bg-white/60 px-4 py-3 text-[13px] text-ink-soft">
              Roll numbers are assigned automatically based on the complete class roster: after the import every affected section
              (existing and new students together) is numbered 1, 2, 3… alphabetically by first name, then last name.
              {matches.columns.some((c) => c.status === "not_imported" && /roll/i.test(c.note ?? "")) && <> The file&apos;s roll-number column is ignored.</>}
            </p>
          )}
          {tooManyRows && (
            <p role="alert" className="rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum">
              This sheet has {sheet.rows.length} rows. Import at most {MAX_IMPORT_ROWS} rows at a time — split the file.
            </p>
          )}
          {missingRequired.length > 0 && (
            <p role="alert" className="rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum">
              Required field{missingRequired.length > 1 ? "s" : ""} not mapped: {missingRequired.join(", ")}. Choose the matching column{missingRequired.length > 1 ? "s" : ""} below.
            </p>
          )}
          {doubleMapped.length > 0 && (
            <p role="alert" className="rounded-xl border border-mauve/30 bg-blush/30 px-4 py-3 text-[13px] text-ink-soft">
              {doubleMapped.map(([i, labels]) => `Column "${sheet.headings[i] || columnName(i)}" is used for ${labels.join(" and ")}`).join("; ")}. Check that this is intended.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {spec.fields.filter((f) => f.key !== "loginId" || createAccounts).map((f) => (
              <FormField key={f.key} label={f.label} required={f.required} hint={f.help}>
                <Select value={mapping[f.key] === null || mapping[f.key] === undefined ? "" : String(mapping[f.key])} onChange={(e) => setField(f.key, e.target.value)}>
                  <option value="">— Not mapped —</option>
                  {sheet.headings.map((h, i) => <option key={i} value={i}>{h ? `${h} (column ${columnName(i)})` : `Column ${columnName(i)} (no heading)`}</option>)}
                </Select>
              </FormField>
            ))}
          </div>

          <details className="rounded-xl border border-line/80 bg-white/60 p-4 text-[13px]" open={matches.columns.some((c) => c.status !== "mapped" && c.status !== "empty")}>
            <summary className="cursor-pointer font-medium text-ink">Columns in this sheet ({sheet.headings.filter(Boolean).length})</summary>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {matches.columns.filter((c) => c.status !== "empty").map((c) => {
                const usedFor = columnUse.get(c.index);
                return (
                  <li key={c.index} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-mono text-ink">{c.heading}</span>
                    {usedFor ? (
                      <span className="text-lagoon">→ {usedFor.join(", ")}</span>
                    ) : (
                      <span className={c.status === "ambiguous" || c.status === "duplicate" ? "text-plum" : "text-ink-muted"}>
                        — {c.status === "not_imported" || c.status === "ambiguous" || c.status === "duplicate" ? c.note : "not used (not a known column — map it manually if needed)"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>

          {sampleFields.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-line/80 bg-white/70">
              <table className="w-full text-[12.5px]">
                <caption className="px-3 py-2 text-left text-[12px] font-medium text-ink-muted">First rows as they will be read with this mapping</caption>
                <thead className="bg-alabaster text-left text-ink-muted">
                  <tr><th scope="col" className="px-3 py-1.5">Row</th>{sampleFields.map((f) => <th key={f.key} scope="col" className="whitespace-nowrap px-3 py-1.5">{f.label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 3).map((r) => (
                    <tr key={r.rowNumber} className="border-t border-line/60">
                      <td className="px-3 py-1.5 font-mono">{r.rowNumber}</td>
                      {sampleFields.map((f) => <td key={f.key} className="whitespace-nowrap px-3 py-1.5">{r.values[f.key] ?? ""}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canCreateAccounts && (
            <div className="rounded-xl border border-line/80 bg-white/60 p-4">
              <Checkbox
                checked={createAccounts}
                onChange={(e) => setCreateAccounts(e.target.checked)}
                label="Also create sign-in accounts"
                description="Each imported person gets a Login ID (from the Login ID column, or generated) and a one-time temporary password."
              />
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={restart}><ArrowLeft className="h-4 w-4" /> Choose another file</Button>
            <Button onClick={runPreview} loading={busy} disabled={missingRequired.length > 0 || tooManyRows || sheet.rows.length === 0}>Validate {sheet.rows.length} row(s)</Button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Rows" value={preview.summary.total} icon={<Rows3 className="h-5 w-5" />} tone="sapphire" />
            <StatCard label="Ready" value={preview.summary.valid + preview.summary.warnings} icon={<CheckCircle2 className="h-5 w-5" />} />
            <StatCard label="With warnings" value={preview.summary.warnings} icon={<AlertTriangle className="h-5 w-5" />} tone="lavender" />
            <StatCard label="With errors" value={preview.summary.invalid} icon={<XCircle className="h-5 w-5" />} tone="purple" />
          </div>
          {preview.summary.invalid > 0 ? (
            <p role="alert" className="rounded-xl border border-plum/20 bg-plum/5 px-4 py-3 text-[13px] text-plum">
              {preview.summary.invalid} row(s) have errors{preview.summary.duplicates ? ` (${preview.summary.duplicates} duplicate)` : ""}. Fix them in your file and upload it again — nothing is imported until every row is valid.
            </p>
          ) : (
            <p role="status" className="rounded-xl border border-lagoon/25 bg-teal-soft px-4 py-3 text-[13px] text-lagoon">
              All {preview.summary.total} row(s) are valid. Warnings do not block the import; review them before confirming.
            </p>
          )}
          <Segmented label="Rows to show" size="sm" value={filter} onChange={setFilter} options={[{ value: "problems", label: "Errors & warnings" }, { value: "all", label: "All rows" }]} />
          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-line/80 bg-white/70">
            <table className="w-full text-sm">
              <caption className="sr-only">Validation results</caption>
              <thead className="sticky top-0 bg-alabaster text-left text-[12px] uppercase tracking-wide text-ink-muted">
                <tr><th scope="col" className="px-3 py-2">Row</th><th scope="col" className="px-3 py-2">{spec.noun}</th><th scope="col" className="px-3 py-2">Result</th><th scope="col" className="px-3 py-2">Details</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-muted">No rows to show.</td></tr>}
                {shown.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-line/60 align-top">
                    <td className="px-3 py-2 font-mono text-[13px]">{r.rowNumber}</td>
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.status === "invalid" ? "plum" : r.status === "warning" ? "lavender" : "teal"}>{r.status === "invalid" ? "Error" : r.status === "warning" ? "Warning" : "Valid"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-[13px]">
                      {r.errors.map((e, i) => <p key={`e${i}`} className="text-plum">{e.message}</p>)}
                      {r.warnings.map((w, i) => <p key={`w${i}`} className="text-ink-soft">{w.message}</p>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => setStep("map")}><ArrowLeft className="h-4 w-4" /> Back to columns</Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={restart}>Upload corrected file</Button>
              <Button onClick={commit} loading={busy} disabled={preview.summary.invalid > 0}>
                Import {preview.summary.total} {spec.noun}(s){createAccounts ? " and create accounts" : ""}
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div role="status" className="flex items-start gap-3 rounded-xl border border-lagoon/25 bg-teal-soft px-4 py-3 text-sm text-lagoon">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Imported {created.length} {spec.noun}(s) from {fileName}.</p>
              {createAccounts && <p className="text-[13px]">Credentials issued: {issued.length}{failures.length ? `, failed: ${failures.length} (still pending)` : ""}.</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {createAccounts && (issued.length > 0 || failures.length > 0) && <Button variant="outline" onClick={() => setShowCreds(true)}>View credentials</Button>}
            <Button variant="outline" onClick={() => downloadCsv(`${target}-import-report`, [["Row", "Name", "Login ID"], ...created.map((c) => [String(c.rowNumber), c.name, c.loginId ?? ""])])}>
              <Download className="h-4 w-4" /> Download report
            </Button>
            <Button onClick={restart}>Import another file</Button>
          </div>
        </div>
      )}

      <CredentialsModal open={showCreds} onClose={() => setShowCreds(false)} credentials={issued} failures={failures} title="Imported account credentials" />
    </Card>
  );
}

/** Spreadsheet column letter for a 0-based index (0 → A, 26 → AA). */
function columnName(index: number): string {
  let n = index + 1, out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}


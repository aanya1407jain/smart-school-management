/**
 * Reading uploaded spreadsheets (CSV, XLSX) and writing CSV downloads, in the
 * browser. Parsing only turns the file into text cells; every rule is enforced
 * by the server (convex/imports.ts).
 */

export type SheetRow = { rowNumber: number; cells: string[] };
/** One worksheet: its name, the heading row and the data rows (spreadsheet row numbers kept). */
export type ParsedSheet = { name: string; headings: string[]; rows: SheetRow[] };

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF/LF line breaks, newlines inside quotes, optional BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("The CSV file has an unclosed quote.");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10); // read-excel-file returns dates as UTC midnight
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
}

/** Turn a cell matrix into headings + rows: the first non-empty row is the heading row; blank rows are skipped. */
export function sheetFromMatrix(name: string, matrix: unknown[][]): ParsedSheet | null {
  const textRows = matrix.map((r) => r.map(cellToText));
  const headerIndex = textRows.findIndex((r) => r.some((c) => c !== ""));
  if (headerIndex < 0) return null;
  const headings = textRows[headerIndex];
  const rows: SheetRow[] = [];
  for (let i = headerIndex + 1; i < textRows.length; i++) {
    const cells = textRows[i];
    if (cells.every((c) => c === "")) continue; // skip blank lines
    rows.push({ rowNumber: i + 1, cells }); // spreadsheet row number (1-based)
  }
  return { name, headings, rows };
}

/**
 * Every non-empty worksheet of the file (a CSV is one sheet). The caller picks
 * the sheet to import — workbooks often start with a "Read Me" or notes sheet,
 * so the FIRST sheet is not necessarily the data.
 */
export async function readSpreadsheet(file: File): Promise<ParsedSheet[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 5 MB. Split it into smaller files.");
  const name = file.name.toLowerCase();
  let sheets: (ParsedSheet | null)[];
  if (name.endsWith(".csv") || file.type === "text/csv") {
    sheets = [sheetFromMatrix(file.name, parseCsv(await file.text()))];
  } else if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const all = (await readXlsxFile(file)) as unknown as { sheet: string; data: unknown[][] }[];
    sheets = all.map((s) => sheetFromMatrix(s.sheet, s.data));
  } else {
    throw new Error("Upload a .csv or .xlsx file.");
  }
  const found = sheets.filter((s): s is ParsedSheet => s !== null);
  if (found.length === 0) throw new Error("The file is empty.");
  return found;
}

/** Neutralise spreadsheet formulas (CSV injection) by prefixing risky leading characters. */
function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => `"${safeCell(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

export function downloadCsv(filename: string, rows: string[][]) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

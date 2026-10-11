/**
 * CSV serialization and file download utilities.
 * Conforms to RFC 4180: wraps cells with quotes, escaping internal quotes as `""`.
 */

export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export function toCsvString(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): string {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(","));
  return [headerLine, ...dataLines].join("\r\n");
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): void {
  if (typeof window === "undefined") return;
  const content = toCsvString(headers, rows);
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  // Defer revoking the object URL and removing the element so the browser's
  // asynchronous download manager has sufficient time to read the blob stream.
  // Immediate synchronous revocation causes 0-byte (empty) file downloads in Chromium/Gecko.
  setTimeout(() => {
    try {
      if (a.parentNode) {
        a.parentNode.removeChild(a);
      }
    } catch {
      // ignore DOM cleanup error
    }
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore revocation error
    }
  }, 1000);
}

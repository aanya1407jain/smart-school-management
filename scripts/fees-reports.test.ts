export {};

/**
 * Unit and authorization tests for Admin Fee Reports filtering and CSV export.
 * Run with: npx tsx scripts/fees-reports.test.ts
 */

// ---- minimal browser shim for Web Storage ----
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as Record<string, unknown>;
g.window = { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage(), addEventListener: () => {} };

type TestResult = { name: string; ok: boolean; detail?: string };
const results: TestResult[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function run() {
  const { escapeCsvCell, toCsvString } = await import("../src/lib/utils/csv");
  const { services } = await import("../src/lib/services");
  const { readDb } = await import("../src/lib/store/db");

  console.log("\n--- 1. CSV Escaping & Serialization Tests ---");

  // Basic string
  check("escapeCsvCell wraps plain string in quotes", escapeCsvCell("Aster Academy") === '"Aster Academy"');
  // Numbers
  check("escapeCsvCell converts number to quoted string", escapeCsvCell(12500) === '"12500"');
  // Null and undefined
  check("escapeCsvCell handles null safely", escapeCsvCell(null) === '""');
  check("escapeCsvCell handles undefined safely", escapeCsvCell(undefined) === '""');
  // Comma escaping
  check("escapeCsvCell handles commas", escapeCsvCell("Sharma, Aarav") === '"Sharma, Aarav"');
  // Double quotes escaping
  check(
    'escapeCsvCell doubles internal double quotes',
    escapeCsvCell('Grade 10 "A" Section') === '"Grade 10 ""A"" Section"'
  );
  // Newlines escaping
  check(
    "escapeCsvCell preserves embedded newlines within quotes",
    escapeCsvCell("Address line 1\nAddress line 2") === '"Address line 1\nAddress line 2"'
  );

  // Full CSV generation
  const headers = ["Student Name", "Class", "Outstanding (INR)"];
  const rows = [
    ['Sharma, Aarav', '10-A', 5000],
    ['Verma, Diya "Junior"', '10-B\nRoom 2', 0],
  ];
  const csv = toCsvString(headers, rows);
  const lines = csv.split("\r\n");
  check("toCsvString produces expected line count", lines.length === 3);
  check("toCsvString header matches", lines[0] === '"Student Name","Class","Outstanding (INR)"');
  check(
    "toCsvString row 1 escaped correctly",
    lines[1] === '"Sharma, Aarav","10-A","5000"'
  );

  console.log("\n--- 2. Fee Report Service Authorization Tests ---");

  const SERVER_STUDENTS: Record<string, { studentId: string; name: string }[]> = {
    "student@asteracademy.edu": [{ studentId: "cvx_aarav", name: "Aarav Sharma" }],
    "guardian@asteracademy.edu": [{ studentId: "cvx_aarav", name: "Aarav Sharma" }, { studentId: "cvx_ananya", name: "Ananya Sharma" }],
  };
  const login = (email: string, roleOrPassword: "admin" | "teacher" | "student" | string, roleArg?: "admin" | "teacher" | "student") => {
    const role = (roleArg ?? roleOrPassword) as "admin" | "teacher" | "student";
    const bound = services.auth.bindIdentity({ email, role, displayName: email, permissionSets: [], students: SERVER_STUDENTS[email] ?? [] });
    if (!bound.ok) throw new Error(`could not bind ${email}`);
    return bound.user;
  };
  const rejects = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return { rejected: false, code: "" };
    } catch (e) {
      return { rejected: true, code: (e as { code?: string }).code ?? (e as Error).message };
    }
  };

  // Student should be rejected from listing all balances
  await login("student@asteracademy.edu", "Student@123", "student");
  const studentCheck = await rejects(() => services.fees.listBalances());
  check("Student cannot access admin fee balance report", studentCheck.rejected, studentCheck.code);

  // Admin can list balances
  await login("admin@asteracademy.edu", "Admin@123", "admin");
  const allBalances = await services.fees.listBalances();
  check("Admin can access fee balances", Array.isArray(allBalances) && allBalances.length > 0);

  console.log("\n--- 3. Fee Report Filtering Tests ---");

  const db = readDb();
  const currentYearId = db.school.currentAcademicYearId;

  // Filter by academic year
  const yearBalances = await services.fees.listBalances({ academicYearId: currentYearId });
  check("Filter by current academic year returns records", yearBalances.length > 0);
  check(
    "All returned records belong to the requested academic year",
    yearBalances.every((r) => r.academicYearId === currentYearId)
  );

  // Filter by class
  const class10 = db.classes.find((c) => c.grade === 10);
  if (class10) {
    const classBalances = await services.fees.listBalances({ classId: class10.id });
    check("Filter by class returns records", classBalances.length > 0);
    check(
      "All records match selected classId",
      classBalances.every((r) => r.classId === class10.id)
    );

    // Filter by class + section
    const sec10a = db.sections.find((s) => s.classId === class10.id);
    if (sec10a) {
      const secBalances = await services.fees.listBalances({ classId: class10.id, sectionId: sec10a.id });
      check(
        "Filter by class and section returns matching records",
        secBalances.every((r) => r.sectionId === sec10a.id)
      );
    }
  }

  // Filter by standing
  const overdueBalances = await services.fees.listBalances({ standing: "overdue" });
  check(
    "Filter by standing 'overdue' returns only overdue students",
    overdueBalances.every((r) => r.standing === "overdue")
  );

  // Search filter
  if (allBalances.length > 0) {
    const firstStudent = allBalances[0];
    const searchByName = await services.fees.listBalances({ search: firstStudent.name.slice(0, 4) });
    check(
      "Search by partial name returns matching student",
      searchByName.some((r) => r.studentId === firstStudent.studentId)
    );

    const searchByAdm = await services.fees.listBalances({ search: firstStudent.admissionNo });
    check(
      "Search by admission number returns matching student",
      searchByAdm.some((r) => r.studentId === firstStudent.studentId)
    );
  }

  // Financial integrity
  check(
    "Fee balances maintain net = paid + outstanding calculation",
    allBalances.every((r) => r.net === r.paid + r.outstanding)
  );

  console.log("\n--- 4. CSV Export Data & Download Regression Tests ---");

  // Verify that live fee balances serialize to non-empty CSV with headers and row data
  const feeReportHeaders = [
    "Student Name",
    "Admission No",
    "Class",
    "Net Fees (INR)",
    "Amount Paid (INR)",
    "Outstanding (INR)",
    "Payment Status",
    "Last Payment Date",
  ];
  const reportRows = allBalances.map((r) => [
    r.name,
    r.admissionNo,
    r.classLabel,
    r.net,
    r.paid,
    r.outstanding,
    r.standing,
    r.lastPayment ?? "—",
  ]);

  const fullReportCsv = toCsvString(feeReportHeaders, reportRows);
  const reportLines = fullReportCsv.split("\r\n");

  check("Exported fee report CSV is non-empty", fullReportCsv.length > 0);
  check(
    "Exported fee report CSV has header row matching domain columns",
    reportLines[0] ===
      '"Student Name","Admission No","Class","Net Fees (INR)","Amount Paid (INR)","Outstanding (INR)","Payment Status","Last Payment Date"'
  );
  check(
    "Exported fee report CSV has data row for every student in dataset",
    reportLines.length === allBalances.length + 1
  );

  // Check first student record integrity in CSV
  const firstRow = reportLines[1];
  const firstBal = allBalances[0];
  check(
    "First row contains student name",
    firstRow.includes(`"${firstBal.name}"`)
  );
  check(
    "First row contains admission number",
    firstRow.includes(`"${firstBal.admissionNo}"`)
  );
  check(
    "First row contains class label",
    firstRow.includes(`"${firstBal.classLabel}"`)
  );
  check(
    "First row contains net amount",
    firstRow.includes(`"${firstBal.net}"`)
  );
  check(
    "First row contains payment standing",
    firstRow.includes(`"${firstBal.standing}"`)
  );

  // Filtered dataset export regression test (Class 10)
  if (class10) {
    const class10Balances = await services.fees.listBalances({ classId: class10.id });
    const class10Rows = class10Balances.map((r) => [
      r.name,
      r.admissionNo,
      r.classLabel,
      r.net,
      r.paid,
      r.outstanding,
      r.standing,
      r.lastPayment ?? "—",
    ]);
    const class10Csv = toCsvString(feeReportHeaders, class10Rows);
    const class10Lines = class10Csv.split("\r\n");

    check("Filtered Class 10 CSV export contains headers", class10Lines[0] === reportLines[0]);
    check(
      "Filtered Class 10 CSV row count matches filtered balances",
      class10Lines.length === class10Balances.length + 1
    );
    check(
      "Filtered Class 10 CSV contains only Class 10 students",
      class10Lines.slice(1).every((line) => line.includes('"10-A"') || line.includes('"10-B"') || line.includes('"10-C"'))
    );
  }

  // Regression test: downloadCsv utility does not synchronously revoke the Blob URL
  const { downloadCsv } = await import("../src/lib/utils/csv");

  let capturedBlobContent = "";
  let clicked = false;
  let revokedSynchronously = false;
  let revokeCalledCount = 0;

  // Mock DOM environment for downloadCsv testing
  const mockAnchor: Record<string, unknown> = {
    style: {},
    click: () => {
      clicked = true;
    },
    parentNode: null,
  };

  const originalDoc = g.document;
  const originalURL = g.URL;
  const originalBlob = g.Blob;

  g.Blob = class MockBlob {
    content: string;
    type: string;
    constructor(parts: (string | unknown)[], options?: { type?: string }) {
      this.content = parts.join("");
      this.type = options?.type ?? "";
      capturedBlobContent = this.content;
    }
  } as unknown as typeof Blob;

  g.URL = {
    createObjectURL: () => "blob:http://localhost:3000/mock-uuid",
    revokeObjectURL: () => {
      revokeCalledCount++;
    },
  } as unknown as typeof URL;

  const mockBody = {
    appendChild: (el: unknown) => {
      (el as { parentNode: unknown }).parentNode = mockBody;
    },
    removeChild: (el: unknown) => {
      (el as { parentNode: unknown }).parentNode = null;
    },
  };

  g.document = {
    createElement: (tag: string) => (tag === "a" ? (mockAnchor as unknown as HTMLElement) : {}),
    body: mockBody,
  } as unknown as Document;

  downloadCsv("test_report", ["Col A", "Col B"], [["Val 1", 100]]);

  // At this moment, click() has executed synchronously.
  // URL.revokeObjectURL MUST NOT have been called yet (deferred via setTimeout)!
  revokedSynchronously = revokeCalledCount > 0;
  check("downloadCsv triggers anchor click", clicked);
  check(
    "downloadCsv created Blob with UTF-8 BOM and headers/data",
    capturedBlobContent.startsWith("\uFEFF") && capturedBlobContent.includes('"Col A","Col B"')
  );
  check(
    "downloadCsv does NOT revoke Blob URL synchronously (avoids 0-byte download bug)",
    !revokedSynchronously
  );

  // Wait for setTimeout to execute cleanup
  await new Promise((r) => setTimeout(r, 1100));
  check("downloadCsv cleans up Blob URL after timeout", revokeCalledCount === 1);

  // Restore mocks
  g.document = originalDoc;
  g.URL = originalURL;
  g.Blob = originalBlob;

  console.log(`\nResults: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (results.some((r) => !r.ok)) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

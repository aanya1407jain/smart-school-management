"use client";
/**
 * Admission Register (CSR / Central Student Register) — Student Management module.
 *
 * Displays the school's complete admission register in admission-number order,
 * including active students, leavers (transferred), alumni (passed out), and inactive records.
 * Standard columns are derived from existing school records on the server;
 * any active extra columns defined by the school are dynamically mapped.
 *
 * Permissions:
 *  - View register: `students:read:all`
 *  - Export register: `students:export` (Students → Export grant)
 */
import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Search } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
  Badge, Button, Card, DataTable, EmptyState, LoadingState, SearchInput, Select, useToast, type Column,
} from "@/components/ui";
import { useSchoolPaginatedQuery, useSchoolQuery, useSchoolQueryRunner } from "@/lib/convex/membership";
import { useSession } from "@/features/auth/session-provider";
import { downloadCsv } from "@/lib/utils/csv";

type RegisterPageResult = FunctionReturnType<typeof api.admissionRegister.page>;
type RegisterRow = RegisterPageResult["page"][number];

const STATUS_TONES: Record<string, "teal" | "neutral" | "plum" | "blush"> = {
  active: "teal",
  alumni: "neutral",
  transferred: "plum",
  inactive: "blush",
};

export function AdmissionRegisterPanel() {
  const { can } = useSession();
  const canExport = can("students:export");
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);

  // Paginated register rows (standard + custom)
  const list = useSchoolPaginatedQuery(api.admissionRegister.page, {}, { initialNumItems: 50 });
  const activeFields = useSchoolQuery(api.admissionRegister.fields, {});
  const runExport = useSchoolQueryRunner(api.admissionRegister.exportPage);

  const rawRows: RegisterRow[] = useMemo(() => {
    return (list.results ?? []) as RegisterRow[];
  }, [list.results]);

  // Client-side quick filter on current loaded page for rapid search
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawRows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.admissionNo.toLowerCase().includes(q) ||
        (r.scholarNo && r.scholarNo.toLowerCase().includes(q)) ||
        r.name.toLowerCase().includes(q) ||
        (r.current && `${r.current.className} ${r.current.section}`.toLowerCase().includes(q))
      );
    });
  }, [rawRows, search, statusFilter]);

  // Export full register via admissionRegister.exportPage (rule 7: page <= 100 rows per call)
  const handleExportCsv = async () => {
    if (!canExport) return;
    setIsExporting(true);
    try {
      let cursor: string | null = null;
      const allRows: RegisterRow[] = [];
      let serverColumns: { key: string; label: string }[] = [];

      do {
        const res: RegisterPageResult = await runExport({
          paginationOpts: { numItems: 100, cursor },
        });
        allRows.push(...res.page);
        serverColumns = res.columns;
        cursor = res.isDone ? null : res.continueCursor;
      } while (cursor);

      if (allRows.length === 0) {
        toast({ title: "No records", description: "The admission register is empty.", tone: "info" });
        return;
      }

      const headers = [
        "Admission No.",
        "Scholar No.",
        "Student Name",
        "Status",
        "Gender",
        "Date of Birth",
        "Admission Date",
        "Admitted Class & Section",
        "Current Class, Section & Roll",
        "Parent Name",
        "Parent Relation",
        "Parent Phone",
        "Address",
        "Leaving Date",
        "TC No.",
        "Leaving Reason",
        ...serverColumns.map((c) => c.label),
      ];

      const csvRows = allRows.map((r) => [
        r.admissionNo,
        r.scholarNo ?? "",
        r.name,
        r.status,
        r.gender ?? "",
        r.dateOfBirth ?? "",
        r.admissionDate ?? "",
        r.admittedTo ? `${r.admittedTo.className} - ${r.admittedTo.section} (${r.admittedTo.academicYear})` : "",
        r.current ? `${r.current.className} - ${r.current.section} (Roll ${r.current.rollNo ?? "—"})` : "",
        r.parent?.name ?? "",
        r.parent?.relation ?? "",
        r.parent?.phone ?? "",
        r.address ?? "",
        r.leaving?.leavingDate ?? "",
        r.leaving?.tcNo ?? "",
        r.leaving?.reason ?? "",
        ...serverColumns.map((c) => (r.custom[c.key] !== null && r.custom[c.key] !== undefined ? String(r.custom[c.key]) : "")),
      ]);

      downloadCsv("admission-register", headers, csvRows);
      toast({ title: "Register exported", description: `Exported ${allRows.length} student record(s) to CSV.` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || "Could not export the admission register.", tone: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  // Dynamic table columns: derived standard columns + any active school custom columns
  const tableColumns: Column<RegisterRow>[] = useMemo(() => {
    const cols: Column<RegisterRow>[] = [
      {
        key: "admissionNo",
        header: "Admission No.",
        primary: true,
        cell: (r) => (
          <div>
            <span className="font-semibold text-ink">{r.admissionNo}</span>
            {r.scholarNo && <span className="block text-[11px] text-ink-muted">Scholar: {r.scholarNo}</span>}
          </div>
        ),
      },
      {
        key: "name",
        header: "Student",
        cell: (r) => (
          <div>
            <span className="font-medium text-ink">{r.name}</span>
            <span className="block text-[11px] text-ink-muted">{r.gender ?? "—"} · DOB: {r.dateOfBirth ?? "—"}</span>
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        cell: (r) => <Badge tone={STATUS_TONES[r.status] ?? "stone"} className="capitalize">{r.status}</Badge>,
      },
      {
        key: "current",
        header: "Current placement",
        cell: (r) =>
          r.current ? (
            <div>
              <span className="text-ink">{r.current.className} - {r.current.section}</span>
              <span className="block text-[11px] text-ink-muted">Roll {r.current.rollNo ?? "—"} · {r.current.academicYear}</span>
            </div>
          ) : (
            <span className="text-ink-muted">—</span>
          ),
      },
      {
        key: "admittedTo",
        header: "Admitted",
        cell: (r) =>
          r.admittedTo ? (
            <div>
              <span className="text-ink">{r.admittedTo.className} - {r.admittedTo.section}</span>
              <span className="block text-[11px] text-ink-muted">{r.admissionDate ?? r.admittedTo.academicYear}</span>
            </div>
          ) : (
            <span className="text-ink-muted">—</span>
          ),
      },
      {
        key: "parent",
        header: "Parent contact",
        cell: (r) =>
          r.parent ? (
            <div>
              <span className="text-ink">{r.parent.name}</span>
              <span className="block text-[11px] text-ink-muted">{r.parent.relation} · {r.parent.phone}</span>
            </div>
          ) : (
            <span className="text-ink-muted">—</span>
          ),
      },
      {
        key: "leaving",
        header: "Leaving / TC",
        cell: (r) =>
          r.leaving ? (
            <div>
              <span className="font-medium text-plum">TC: {r.leaving.tcNo}</span>
              <span className="block text-[11px] text-ink-muted">{r.leaving.leavingDate} ({r.leaving.reason})</span>
            </div>
          ) : (
            <span className="text-ink-muted">—</span>
          ),
      },
    ];

    // Pluggable columns from server (if defined by school Principal)
    if (activeFields && activeFields.length > 0) {
      for (const f of activeFields) {
        cols.push({
          key: `custom_${f.key}`,
          header: f.label,
          cell: (r) => {
            const v = r.custom[f.key];
            if (v === null || v === undefined) return <span className="text-ink-muted">—</span>;
            if (typeof v === "boolean") return <span>{v ? "Yes" : "No"}</span>;
            return <span>{String(v)}</span>;
          },
        });
      }
    }

    return cols;
  }, [activeFields]);

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search admission no., scholar no., name..."
            label="Search admission register"
            className="sm:w-80"
          />
          <Select
            aria-label="Filter status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-44"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="transferred">Transferred (TC)</option>
            <option value="alumni">Alumni (Passed out)</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        {canExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={isExporting}
            className="shrink-0"
          >
            <Download className="mr-1.5 h-4 w-4" />
            {isExporting ? "Exporting..." : "Download register (CSV)"}
          </Button>
        )}
      </Card>

      <Card>
        {list.status === "LoadingFirstPage" ? (
          <LoadingState variant="table" />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={<FileSpreadsheet className="h-6 w-6" />}
            title="No register records"
            description={
              search || statusFilter !== "all"
                ? "No register entries match the current filters."
                : "No student admission records found in the register."
            }
          />
        ) : (
          <div>
            <DataTable
              columns={tableColumns}
              rows={filteredRows}
              getRowId={(r) => r.studentId}
            />
            {list.status === "CanLoadMore" && (
              <div className="border-t border-line/60 p-3 text-center">
                <Button variant="outline" size="sm" onClick={() => list.loadMore(50)}>
                  Load more records
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

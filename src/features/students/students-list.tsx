"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, MoreHorizontal, Pencil, UserPlus, Eye, Wallet } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import type { StudentStatus } from "@/types/students";
import type { StudentListItem } from "@/lib/services/students.service";
import {
  Avatar, Button, Card, DataTable, DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger, EmptyState, ErrorState,
  FilterBar, FilterPills, FilterSelect, LinkButton, LoadingState, PageHeader, Pagination, SearchInput, StatusBadge, type SortState,
} from "@/components/ui";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { useAcademicOptions } from "@/features/shared/use-academic-options";

const STATUS_TABS: { value: StudentStatus | "all"; label: string }[] = [
  { value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" },
  { value: "transferred", label: "Transferred" }, { value: "alumni", label: "Alumni" },
];

export function AttendancePill({ value, threshold = 85 }: { value: number | null; threshold?: number }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-heather/30" aria-hidden>
        <span className={cn("block h-full rounded-full", value < threshold ? "bg-plum" : "bg-teal")} style={{ width: `${value}%` }} />
      </span>
      <span className={cn("text-[13px] font-medium", value < threshold ? "text-plum" : "text-ink-soft")}>{formatPercent(value)}</span>
    </span>
  );
}

export function StudentsList() {
  const router = useRouter();
  const params = useSearchParams();
  const opts = useAcademicOptions();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [yearId, setYearId] = useState("");
  const [status, setStatus] = useState<StudentStatus | "all">("active");
  const [sort, setSort] = useState<SortState>({ key: "class", dir: "asc" });
  const [page, setPage] = useState(1);

  useEffect(() => { setSearch(params.get("q") ?? ""); }, [params]);
  useEffect(() => setPage(1), [search, classId, sectionId, yearId, status]);

  const q = useQuery(
    () => services.students.list({ search, classId, sectionId, academicYearId: yearId || undefined, status, sortBy: sort.key as never, sortDir: sort.dir, page, pageSize: 10 }),
    [search, classId, sectionId, yearId, status, sort.key, sort.dir, page],
  );

  const sectionOptions = useMemo(
    () => (opts.data?.sections ?? []).filter((s) => !classId || s.classId === classId).map((s) => ({ value: s.id, label: classId ? `Section ${s.name}` : `Class ${s.label}` })),
    [opts.data, classId],
  );

  const exportCsv = () => {
    const rows = q.data?.items ?? [];
    const header = ["Admission No", "Name", "Class", "Roll", "Parent contact", "Phone", "Attendance %", "Fee status", "Outstanding"];
    const csv = [header, ...rows.map((r) => [r.admissionNo, r.name, r.classLabel, r.rollNo ?? "", r.guardianName ?? "", r.guardianPhone ?? "", r.attendancePct?.toFixed(1) ?? "", r.feeStanding ?? "", r.outstanding ?? ""])]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "students.csv";
    a.click();
  };

  return (
    <div>
      <PageHeader
        title="Students"
        description="Every enrolled student, with live attendance and fee standing."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!q.data?.items.length}><Download className="h-4 w-4" /> Export page</Button>
            <LinkButton href="/admin/students/new"><UserPlus className="h-4 w-4" /> Add student</LinkButton>
          </>
        }
      />

      <Card className="p-4 sm:p-5">
        <FilterPills
          label="Filter by status"
          className="mb-4"
          value={status}
          onChange={setStatus}
          items={STATUS_TABS.map((t) => ({ value: t.value, label: t.label, count: q.data ? q.data.statusCounts[t.value] : null }))}
        />

        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, admission no. or parent" className="col-span-2 sm:w-72" label="Search students" />
          <FilterSelect label="Class" value={classId} onChange={(v) => { setClassId(v); setSectionId(""); }} allLabel="All classes" options={(opts.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <FilterSelect label="Section" value={sectionId} onChange={setSectionId} allLabel="All sections" options={sectionOptions} />
          <FilterSelect label="Academic year" value={yearId} onChange={setYearId} allLabel="Current year" options={(opts.data?.years ?? []).filter((y) => y.id !== opts.data?.currentYearId).map((y) => ({ value: y.id, label: y.name }))} />
        </FilterBar>

        <div className="mt-5">
          {q.isLoading && !q.data ? <LoadingState variant="table" /> : q.error && !q.data ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
            <div className={cn("transition-opacity", q.isRefreshing && "opacity-60")}>
              <DataTable<StudentListItem>
                caption="Students"
                rows={q.data?.items ?? []}
                getRowId={(r) => r.id}
                onRowClick={(r) => router.push(`/admin/students/${r.id}`)}
                sort={sort}
                onSortChange={setSort}
                empty={
                  <EmptyState
                    title="No students found"
                    description={search || classId || sectionId ? "Try a different search or clear the filters." : "Add your first student to get started."}
                    action={search || classId || sectionId ? <Button variant="outline" onClick={() => { setSearch(""); setClassId(""); setSectionId(""); }}>Clear filters</Button> : <LinkButton href="/admin/students/new">Add student</LinkButton>}
                  />
                }
                columns={[
                  {
                    key: "student", header: "Student", sortKey: "name", primary: true,
                    cell: (r) => (
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{r.name}</p>
                          <p className="truncate text-[12px] text-ink-muted">{r.email}</p>
                        </div>
                      </div>
                    ),
                  },
                  { key: "id", header: "Student ID", sortKey: "admissionNo", headerClassName: "whitespace-nowrap", cell: (r) => <span className="whitespace-nowrap font-mono text-[12.5px]">{r.admissionNo}</span> },
                  { key: "class", header: "Class", sortKey: "class", cell: (r) => <span className="font-medium text-ink">{r.grade || "—"}</span> },
                  { key: "section", header: "Section", cell: (r) => <span>{r.classLabel.split("-")[1] ?? "—"}{r.rollNo ? <span className="ml-1 text-[12px] text-ink-muted">· #{r.rollNo}</span> : null}</span> },
                  { key: "guardian", header: "Parent contact", cell: (r) => r.guardianName ? <div><p className="text-ink">{r.guardianName}</p><p className="text-[12px] text-ink-muted">{r.guardianRelation}</p></div> : "—" },
                  { key: "attendance", header: "Attendance", sortKey: "attendance", cell: (r) => <AttendancePill value={r.attendancePct} /> },
                  { key: "fees", header: "Fee status", sortKey: "outstanding", cell: (r) => r.feeStanding ? <div className="space-y-0.5"><StatusBadge status={r.feeStanding} />{(r.outstanding ?? 0) > 0 && <p className="text-[12px] text-ink-muted">{formatCurrency(r.outstanding!)} due</p>}</div> : "—" },
                  { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
                ]}
                rowActions={(r) => (
                  <DropdownMenu>
                    <DropdownTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownTrigger>
                    <DropdownContent>
                      <DropdownItem onSelect={() => router.push(`/admin/students/${r.id}`)}><Eye className="h-4 w-4" /> View profile</DropdownItem>
                      <DropdownItem onSelect={() => router.push(`/admin/students/${r.id}/edit`)}><Pencil className="h-4 w-4" /> Edit details</DropdownItem>
                      <DropdownItem onSelect={() => router.push(`/admin/fees/${r.id}`)}><Wallet className="h-4 w-4" /> Fee ledger</DropdownItem>
                    </DropdownContent>
                  </DropdownMenu>
                )}
              />
              {q.data && q.data.total > 0 && (
                <div className="mt-5">
                  <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPageChange={setPage} />
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

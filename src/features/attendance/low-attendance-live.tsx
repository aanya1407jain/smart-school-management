"use client";
/**
 * LIVE "students below the threshold" list (reports.lowAttendance). Uses the
 * school's own lowAttendanceThreshold and late-counts-as-present setting, from
 * stored attendance records of the current academic year. Fetched on demand
 * (not a live subscription) so a whole-school scan that is too large shows a
 * clear message asking for a section instead of breaking the page.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, RotateCcw } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolQueryRunner } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { Avatar, Button, Card, CardHeader, DataTable, EmptyState, LoadingState, Select } from "@/components/ui";
import { formatPercent } from "@/lib/utils/format";
import { formatDate } from "@/lib/utils/dates";
import { downloadCsv } from "@/lib/utils/csv";
import { useAcademicOptions } from "@/features/shared/use-academic-options";

type Result = FunctionReturnType<typeof api.attendanceReports.lowAttendance>;

export function LiveLowAttendance() {
  const run = useSchoolQueryRunner(api.attendanceReports.lowAttendance);
  const opts = useAcademicOptions();
  const [sectionId, setSectionId] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await run(sectionId ? { sectionId: sectionId as Id<"sections"> } : {}));
    } catch (e) {
      setData(null);
      setError(getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [run, sectionId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Card data-testid="live-low-attendance">
      <CardHeader
        title={data ? `Students below ${data.threshold}%` : "Students below the attendance threshold"}
        description={data ? `${formatDate(data.from)} – ${formatDate(data.to)} · ${data.lateCountsAsPresent ? "late counts as present" : "late does not count as present"} · threshold from school settings` : "Uses the threshold in school settings."}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-44">
              <option value="">Whole school</option>
              {(opts.data?.sections ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <Button size="sm" variant="outline" onClick={load} aria-label="Refresh"><RotateCcw className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" disabled={!data?.students.length} onClick={() => data && downloadCsv("low-attendance.csv", ["Student", "Admission no", "Class", "Present", "Late", "Absent", "Marked days", "Attendance %"], data.students.map((s) => [s.name, s.admissionNo, s.classLabel, s.present, s.late, s.absent, s.counted, s.percentage]))}><Download className="h-4 w-4" /> CSV</Button>
          </div>
        }
      />
      <div className="p-5">
        {loading ? <LoadingState variant="inline" /> : error ? (
          <p role="alert" className="text-[13px] text-plum">{error}</p>
        ) : (
          <DataTable caption="Students below the attendance threshold" rows={data?.students ?? []} getRowId={(s) => s.studentId} empty={<EmptyState title="No students below the threshold" description="Students appear here once their marked attendance falls below the school's requirement." />}
            columns={[
              { key: "n", header: "Student", primary: true, cell: (s) => <Link href={`/admin/students/${s.studentId}`} className="flex items-center gap-2.5 hover:text-lagoon"><Avatar name={s.name} size="sm" /><span className="font-semibold text-ink">{s.name}</span></Link> },
              { key: "c", header: "Class", cell: (s) => s.classLabel },
              { key: "a", header: "Absent days", cell: (s) => s.absent },
              { key: "l", header: "Late", cell: (s) => s.late },
              { key: "p", header: "Attendance", align: "right", cell: (s) => <span className="font-semibold text-plum">{formatPercent(s.percentage, 1)}</span> },
            ]} />
        )}
      </div>
    </Card>
  );
}

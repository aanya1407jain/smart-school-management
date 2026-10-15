"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX2, CheckCheck, CheckCircle2, History, Loader2, Lock, Save, UserX } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AttendanceStatus } from "@/types/domain";
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, FormField, GlassCard, Input, PageHeader, ProgressBar, Segmented, Select,
  StatusBadge, Tabs, TabsContent, TabsList, useToast,
} from "@/components/ui";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { formatDate, formatDateTime, formatLongDate, isSchoolDay, previousSchoolDay, todayISO } from "@/lib/utils/dates";
import { formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; short: string; activeClass: string }[] = [
  { value: "present", label: "Present", short: "P", activeClass: "bg-teal text-white shadow-soft" },
  { value: "absent", label: "Absent", short: "A", activeClass: "bg-plum text-white shadow-soft" },
  { value: "late", label: "Late", short: "L", activeClass: "bg-mauve text-white shadow-soft" },
];

const VALID_STATUSES: ReadonlySet<string> = new Set(["present", "absent", "late"]);

function isStatus(v: unknown): v is AttendanceStatus {
  return typeof v === "string" && VALID_STATUSES.has(v);
}

/** Attendance % where late students count as attended. Returns null when nothing is marked. */
function attendancePct(present?: number | null, late?: number | null, absent?: number | null): number | null {
  const p = present ?? 0;
  const l = late ?? 0;
  const a = absent ?? 0;
  const total = p + l + a;
  return total > 0 ? ((p + l) / total) * 100 : null;
}

/** Formats a Convex timestamp (ms) safely; returns null for missing/invalid values. */
function safeDateTime(ts?: number | null): string | null {
  if (ts == null) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : formatDateTime(d.toISOString());
}

/** Local-calendar ISO date N days ago (avoids the UTC shift of toISOString()). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as { data?: unknown; message?: unknown };
    if (typeof anyE.data === "string") return anyE.data; // ConvexError payload
    if (typeof anyE.message === "string") return anyE.message;
  }
  return String(e);
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

/** Shared by Admin (all sections) and Teacher (assigned sections only — enforced by the backend). */
export function AttendanceWorkspace({ area }: { area: "admin" | "teacher" }) {
  const params = useSearchParams();
  const opts = useAcademicOptions();
  const defaultDate = isSchoolDay(todayISO()) ? todayISO() : previousSchoolDay(todayISO());
  const [date, setDate] = useState(defaultDate);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState(params.get("section") ?? "");

  const overviewRaw = useQuery(api.attendance.dailyOverview, { date });
  const overviewList = overviewRaw === undefined ? undefined : (overviewRaw ?? []);

  // Pick a sensible default section once the overview loads.
  useEffect(() => {
    if (sectionId || !overviewList || overviewList.length === 0) return;
    const first =
      overviewList.find((r) => r.isClassTeacher) ?? overviewList.find((r) => !r.marked) ?? overviewList[0];
    if (first) setSectionId(first.sectionId);
  }, [overviewList, sectionId]);

  // Keep the class dropdown in sync with the selected section.
  useEffect(() => {
    const s = opts.data?.sections?.find((x) => x.id === sectionId);
    if (s) setClassId(s.classId);
  }, [sectionId, opts.data]);

  const allSections = opts.data?.sections ?? [];
  const sections = allSections.filter((s) => !classId || s.classId === classId);
  const year = opts.data?.years?.find((y) => y.id === opts.data?.currentYearId);

  const overviewStats = useMemo(() => {
    const list = overviewList ?? [];
    let present = 0;
    let late = 0;
    let absent = 0;
    let markedSections = 0;
    for (const s of list) {
      if (!s.marked) continue;
      markedSections += 1;
      present += s.presentCount ?? 0;
      late += s.lateCount ?? 0;
      absent += s.absentCount ?? 0;
    }
    return {
      totalSections: list.length,
      markedSections,
      percentage: attendancePct(present, late, absent),
      absentCount: absent,
    };
  }, [overviewList]);

  return (
    <div>
      <PageHeader
        title="Attendance"
        description={
          area === "admin"
            ? "Monitor daily attendance for every section. Registers are marked and corrected by each section's class teacher."
            : "Mark and correct attendance for the section where you are class teacher. Other classes you teach are view-only."
        }
      />

      <Card className="mb-5 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FormField label="Academic year">
            <Select value={year?.id ?? ""} disabled>
              {year ? <option value={year.id}>{year.name}</option> : <option value="">—</option>}
            </Select>
          </FormField>
          <FormField label="Class">
            <Select
              value={classId}
              disabled={opts.isLoading}
              onChange={(e) => {
                const nextClass = e.target.value;
                setClassId(nextClass);
                const first = allSections.find((s) => s.classId === nextClass);
                setSectionId(first?.id ?? "");
              }}
            >
              {!classId && <option value="">Select class</option>}
              {(opts.data?.classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Section">
            <Select value={sectionId} disabled={sections.length === 0} onChange={(e) => setSectionId(e.target.value)}>
              {!sectionId && <option value="">Select section</option>}
              {sections.map((s) => (
                <option key={s.id} value={s.id}>Section {s.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Date">
            <Input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </FormField>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Tabs defaultValue="register">
          <TabsList items={[{ value: "register", label: "Register" }, { value: "history", label: "History" }]} />
          <TabsContent value="register">
            {sectionId ? (
              <Register key={`${sectionId}-${date}`} sectionId={sectionId} date={date} />
            ) : overviewList === undefined ? (
              <LoadingCard />
            ) : (
              <Card>
                <EmptyState
                  title={area === "teacher" ? "No sections assigned" : "Choose a section"}
                  description={
                    area === "teacher"
                      ? "Classes assigned to you will appear here."
                      : "Pick a class and section above to open its register."
                  }
                />
              </Card>
            )}
          </TabsContent>
          <TabsContent value="history">
            {sectionId ? (
              <SectionHistory sectionId={sectionId} />
            ) : (
              <Card><EmptyState title="Choose a section" description="Select a section to see its recent registers." /></Card>
            )}
          </TabsContent>
        </Tabs>

        <GlassCard className="h-fit">
          <CardHeader title={area === "admin" ? "School overview" : "My sections"} description={formatLongDate(date)} />
          <div className="p-5">
            {overviewList === undefined ? (
              <div className="flex justify-center p-6">
                <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-label="Loading overview" />
              </div>
            ) : overviewList.length === 0 ? (
              <EmptyState title="No sections" description="There are no sections to show for this date." />
            ) : (
              <>
                {area === "admin" && (
                  <div className="mb-4 rounded-xl bg-white/70 p-3.5">
                    <div className="flex items-end justify-between">
                      <p className="text-[13px] text-ink-muted">School attendance</p>
                      <p className="text-xl font-semibold text-sapphire">
                        {overviewStats.percentage != null ? formatPercent(overviewStats.percentage, 1) : "—"}
                      </p>
                    </div>
                    <ProgressBar
                      className="mt-2"
                      value={(overviewStats.markedSections / Math.max(1, overviewStats.totalSections)) * 100}
                      label="Sections marked"
                    />
                    <p className="mt-1.5 text-[12px] text-ink-muted">
                      {overviewStats.markedSections}/{overviewStats.totalSections} sections marked · {overviewStats.absentCount} absent
                    </p>
                  </div>
                )}
                <ul className="grid grid-cols-3 gap-2">
                  {overviewList.map((r) => {
                    const selected = r.sectionId === sectionId;
                    const pct = attendancePct(r.presentCount, r.lateCount, r.absentCount);
                    return (
                      <li key={r.sectionId}>
                        <button
                          type="button"
                          onClick={() => setSectionId(r.sectionId)}
                          aria-pressed={selected}
                          className={cn(
                            "w-full rounded-xl border px-2 py-2 text-center transition-colors",
                            selected
                              ? "border-lagoon bg-lagoon text-white"
                              : r.marked
                                ? "border-teal/30 bg-teal-soft/60 hover:bg-teal-soft"
                                : "border-dashed border-mauve/60 bg-white/60 hover:bg-white",
                          )}
                        >
                          <span className="block text-sm font-semibold">{r.displayName ?? "—"}</span>
                          <span className={cn("block text-[11px]", selected ? "text-white/80" : "text-ink-muted")}>
                            {r.marked ? (pct != null ? formatPercent(pct) : "Marked") : "Not marked"}
                            {area === "teacher" && !r.isClassTeacher && " · view"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function LoadingCard() {
  return (
    <Card className="flex items-center justify-center p-12">
      <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-label="Loading" />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */

function Register({ sectionId, date }: { sectionId: string; date: string }) {
  const { toast } = useToast();

  const registerData = useQuery(api.attendance.getByDate, {
    sectionId: sectionId as Id<"sections">,
    date,
    today: todayISO(),
  });
  const markAttendance = useMutation(api.attendance.mark);
  const updateAttendance = useMutation(api.attendance.update);

  const [entries, setEntries] = useState<Record<string, AttendanceStatus>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const students = registerData?.students ?? [];

  // Statuses as stored on the server — the baseline for edits and diffing.
  const serverEntries = useMemo(() => {
    const map: Record<string, AttendanceStatus> = {};
    for (const s of registerData?.students ?? []) {
      if (isStatus(s.status)) map[s.studentId] = s.status;
    }
    return map;
  }, [registerData]);

  // Sync local state from the server whenever there are no unsaved edits.
  useEffect(() => {
    if (!dirty) setEntries(serverEntries);
  }, [serverEntries, dirty]);

  // Only count entries for students actually on this roster.
  const rosterIds = useMemo(() => new Set(students.map((s) => s.studentId as string)), [students]);
  const rosterEntries = useMemo(
    () => Object.entries(entries).filter(([id, v]) => rosterIds.has(id) && isStatus(v)) as [string, AttendanceStatus][],
    [entries, rosterIds],
  );

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 };
    for (const [, v] of rosterEntries) c[v] += 1;
    return c;
  }, [rosterEntries]);

  if (registerData === undefined) return <LoadingCard />;

  if (registerData === null) {
    return (
      <Card>
        <EmptyState
          icon={<Lock className="h-6 w-6" />}
          title="Register unavailable"
          description="This section doesn't exist or you don't have access to its attendance."
        />
      </Card>
    );
  }

  const r = registerData;
  const sectionName = r.section?.displayName ?? "";
  const total = students.length;
  const marked = rosterEntries.length;
  const unmarked = Math.max(0, total - marked);
  const writable = Boolean(r.canMark || r.canEdit);
  const hasSession = Boolean(r.session);

  if (!r.isSchoolDay) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarX2 className="h-6 w-6" />}
          title="No school on this day"
          description={`${formatLongDate(date)} is not a designated school day. Choose a school day to mark attendance.`}
        />
      </Card>
    );
  }

  const setStatus = (studentId: string, v: AttendanceStatus) => {
    setEntries((prev) => ({ ...prev, [studentId]: v }));
    setDirty(true);
  };

  const setAll = (v: AttendanceStatus) => {
    setEntries(Object.fromEntries(students.map((s) => [s.studentId, v])));
    setDirty(true);
  };

  const discard = () => {
    setEntries(serverEntries);
    setDirty(false);
  };

  const save = async () => {
    if (!writable || saving) return;
    if (marked < total) {
      toast({ title: "Register incomplete", description: `${unmarked} student(s) still need a status.`, tone: "error" });
      return;
    }

    setSaving(true);
    try {
      if (hasSession) {
        // Send only rows that differ from what's stored.
        const changes = rosterEntries
          .filter(([studentId, status]) => serverEntries[studentId] !== status)
          .map(([studentId, status]) => ({ studentId: studentId as Id<"students">, status }));

        if (changes.length === 0) {
          setDirty(false);
          toast({ title: "No changes to save", description: "The register already matches what's recorded." });
          return;
        }

        await updateAttendance({ sectionId: sectionId as Id<"sections">, date, changes });
        setDirty(false);
        toast({
          title: "Attendance updated",
          description: `${changes.length} change(s) saved for Class ${sectionName}.`,
        });
      } else {
        const entriesList = rosterEntries.map(([studentId, status]) => ({
          studentId: studentId as Id<"students">,
          status,
        }));

        await markAttendance({ sectionId: sectionId as Id<"sections">, date, entries: entriesList });
        setDirty(false);
        toast({ title: "Attendance saved", description: `Class ${sectionName} attendance recorded for ${formatDate(date)}.` });
      }
    } catch (e) {
      toast({ title: "Could not save attendance", description: errorMessage(e), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const markedAt = safeDateTime(r.session?.markedAt);
  const editedAt = safeDateTime(r.session?.lastEditedAt);

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-sapphire">
            Class {sectionName || "—"} · {formatDate(date)}
          </h2>
          <p className="text-[13px] text-ink-muted">
            {hasSession ? (
              <>
                {markedAt ? `Marked at ${markedAt}` : "Marked"}
                {editedAt ? ` · Edited ${editedAt}` : ""}
              </>
            ) : (
              "Not marked yet"
            )}
            {dirty && <span className="ml-2 font-medium text-plum">· Unsaved changes</span>}
          </p>
        </div>
        {writable ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => setAll("present")} disabled={saving || total === 0}>
              <CheckCheck className="h-4 w-4" /> Mark all present
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAll("absent")} disabled={saving || total === 0}>
              <UserX className="h-4 w-4" /> Mark all absent
            </Button>
          </div>
        ) : (
          <Badge tone="outline"><Lock className="h-3 w-3" /> View only</Badge>
        )}
      </div>

      {!writable && r.readOnlyReason && (
        <div role="note" className="mx-5 mt-4 flex items-start gap-2 rounded-2xl border border-mauve/40 bg-lavender/15 px-4 py-3 text-sm text-plum">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{r.readOnlyReason}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-5 pt-4 text-[13px]">
        <Badge tone="teal">{counts.present} present</Badge>
        <Badge tone="plum">{counts.absent} absent</Badge>
        <Badge tone="lavender">{counts.late} late</Badge>
        <Badge tone="outline">{unmarked} unmarked</Badge>
      </div>

      {total === 0 ? (
        <EmptyState title="No students in this section" description="Students enrolled in this section will appear here." />
      ) : (
        <ul className="divide-y divide-line/50 px-5 py-2">
          {students.map((s) => {
            const status = entries[s.studentId];
            return (
              <li key={s.studentId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 text-right text-[12px] text-ink-muted">{s.rollNo ?? "—"}</span>
                  <Avatar name={s.name ?? "?"} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{s.name ?? "Unnamed student"}</p>
                    <p className="text-[12px] text-ink-muted">Adm: {s.admissionNo ?? "—"}</p>
                  </div>
                </div>
                {writable ? (
                  <Segmented<AttendanceStatus>
                    label={`Attendance for ${s.name ?? "student"}`}
                    size="sm"
                    value={status ?? null}
                    onChange={(v) => setStatus(s.studentId, v)}
                    options={STATUS_OPTIONS}
                  />
                ) : status ? (
                  <StatusBadge status={status} />
                ) : (
                  <span className="text-[12.5px] text-ink-muted">Not marked</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {writable && total > 0 && (
        <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-2xl border-t border-line/60 bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-muted">
            {unmarked === 0 ? (
              <span className="inline-flex items-center gap-1 text-lagoon">
                <CheckCircle2 className="h-4 w-4" /> All {total} students marked
              </span>
            ) : (
              `${unmarked} student(s) still to mark`
            )}
          </p>
          <div className="flex gap-2">
            {dirty && hasSession && (
              <Button variant="ghost" onClick={discard} disabled={saving}>Discard changes</Button>
            )}
            <Button onClick={save} loading={saving} disabled={saving || unmarked > 0 || (!dirty && hasSession)}>
              <Save className="h-4 w-4" /> {hasSession ? "Update attendance" : "Save attendance"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function SectionHistory({ sectionId }: { sectionId: string }) {
  const today = todayISO();
  const fromDate = useMemo(() => isoDaysAgo(30), []);

  const historyRaw = useQuery(api.attendance.listBySection, {
    sectionId: sectionId as Id<"sections">,
    from: fromDate,
    to: today,
  });
  const history = historyRaw === undefined ? undefined : (historyRaw ?? []);

  return (
    <Card>
      <CardHeader title="Recent registers" description="Last 30 days" icon={<History className="h-4 w-4" />} />
      <div className="p-5">
        {history === undefined ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-ink-muted" aria-label="Loading history" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState title="No attendance history yet" description="Registers marked in the last 30 days will appear here." />
        ) : (
          <ul className="divide-y divide-line/60">
            {history.map((h) => {
              const present = h.presentCount ?? 0;
              const late = h.lateCount ?? 0;
              const absent = h.absentCount ?? 0;
              const pct = attendancePct(present, late, absent);
              const markedAt = safeDateTime(h.markedAt);
              const editedAt = safeDateTime(h.lastEditedAt);
              return (
                <li key={h.date} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">{formatLongDate(h.date)}</p>
                    <p className="text-[12.5px] text-ink-muted">
                      {markedAt ? `Marked at ${markedAt}` : "Marked"}
                      {editedAt ? ` · Edited ${editedAt}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status="present" label={`${present} present`} />
                    <StatusBadge status="late" label={`${late} late`} />
                    <StatusBadge status="absent" label={`${absent} absent`} />
                    <span className="w-14 text-right text-sm font-semibold text-sapphire">
                      {pct != null ? formatPercent(pct) : "—"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
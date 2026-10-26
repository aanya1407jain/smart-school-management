"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX2, Check, CheckCheck, CheckCircle2, Clock3, History, Lock, Save, UserX, Loader2, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { AttendanceStatus } from "@/types/domain";
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, FormField, GlassCard, Input, PageHeader, Segmented, Select, StatusBadge,
  Tabs, TabsContent, TabsList, useToast, ProgressBar,
} from "@/components/ui";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { pickSection, type LiveSection } from "./section-pick";
import { formatDate, formatDateTime, formatLongDate, isSchoolDay, previousSchoolDay, todayISO } from "@/lib/utils/dates";
import { formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

// Tactile toggle chips: gradient fill + soft glow when chosen (white or plum text keeps AA contrast).
const STATUS_OPTIONS: { value: AttendanceStatus; label: string; short: string; activeClass: string; icon: ReactNode }[] = [
  { value: "present", label: "Present", short: "P", icon: <Check className="h-3.5 w-3.5" aria-hidden />, activeClass: "bg-gradient-to-br from-teal to-lagoon text-white shadow-[0_4px_14px_-4px_rgb(var(--c-teal)/0.65)]" },
  { value: "absent", label: "Absent", short: "A", icon: <X className="h-3.5 w-3.5" aria-hidden />, activeClass: "bg-gradient-to-br from-purple to-plum text-white shadow-[0_4px_14px_-4px_rgb(var(--c-plum)/0.6)]" },
  { value: "late", label: "Late", short: "L", icon: <Clock3 className="h-3.5 w-3.5" aria-hidden />, activeClass: "bg-gradient-to-br from-blush to-lavender text-plum shadow-[0_4px_14px_-4px_rgb(var(--c-mauve)/0.7)]" },
];

/** Shared by Admin (all sections, view-only) and Teacher (assigned sections; only the class teacher can mark). */
export function AttendanceWorkspace({ area }: { area: "admin" | "teacher" }) {
  const params = useSearchParams();
  const requested = params.get("section");
  const defaultDate = isSchoolDay(todayISO()) ? todayISO() : previousSchoolDay(todayISO());
  const [date, setDate] = useState(defaultDate);
  const [classId, setClassId] = useState<string>("");
  const [sectionId, setSectionId] = useState<string>("");

  // Live academic structure (real Convex ids), scoped to the caller by the server.
  const years = useSchoolQuery(api.academics.listAcademicYears, {});
  const classes = useSchoolQuery(api.academics.listClasses, {});
  const sectionList = useSchoolQuery(api.academics.listSections, {});
  const overviewList = useSchoolQuery(api.attendance.dailyOverview, { date });
  const year = years?.find((y) => y.isCurrent) ?? null;

  const sectionsAll = useMemo<LiveSection[]>(() => (sectionList ?? []).map((s) => ({ _id: s._id, classId: s.classId, name: s.name, displayName: s.displayName, isClassTeacher: s.isClassTeacher })), [sectionList]);
  // Only classes that have a section this account can see.
  const classOptions = useMemo(() => (classes ?? []).filter((c) => sectionsAll.some((s) => s.classId === c._id)).sort((a, b) => a.level - b.level), [classes, sectionsAll]);

  // Initial / deep-linked selection, once the server lists are in.
  useEffect(() => {
    if (sectionId || sectionList === undefined) return;
    const first = pickSection(sectionsAll, requested, overviewList);
    if (first) { setSectionId(first._id); setClassId(first.classId); }
  }, [sectionId, sectionList, sectionsAll, requested, overviewList]);

  const selected = sectionsAll.find((s) => s._id === sectionId) ?? null;
  const sections = sectionsAll.filter((s) => !classId || s.classId === classId);
  const ignoredLink = !!requested && sectionList !== undefined && !sectionsAll.some((s) => s._id === requested || s.displayName.toLowerCase() === requested.trim().toLowerCase());

  const selectSection = (id: string) => {
    const s = sectionsAll.find((x) => x._id === id);
    if (!s) return;
    setSectionId(s._id);
    setClassId(s.classId);
  };

  // Compute school-wide stats from Convex overview
  const overviewStats = useMemo(() => {
    if (!overviewList) return { totalSections: 0, markedSections: 0, percentage: 0, absentCount: 0 };
    const totalSections = overviewList.length;
    const markedSections = overviewList.filter((s) => s.marked).length;
    let totalPresent = 0;
    let totalAbsent = 0;
    overviewList.forEach((s) => {
      if (s.marked) {
        totalPresent += s.presentCount ?? 0;
        totalAbsent += s.absentCount ?? 0;
      }
    });
    const totalStudents = totalPresent + totalAbsent;
    const percentage = totalStudents > 0 ? (totalPresent / totalStudents) * 100 : 0;
    return { totalSections, markedSections, percentage, absentCount: totalAbsent };
  }, [overviewList]);

  const loadingStructure = years === undefined || classes === undefined || sectionList === undefined;

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
            <Select value={year?._id ?? ""} disabled aria-label="Academic year">
              {year ? <option value={year._id}>{year.name}</option> : <option value="">{years === undefined ? "Loading…" : "Not set"}</option>}
            </Select>
          </FormField>
          <FormField label="Class">
            <Select
              aria-label="Class"
              value={classId}
              disabled={loadingStructure || classOptions.length === 0}
              onChange={(e) => {
                const next = e.target.value;
                setClassId(next);
                const first = sectionsAll.find((s) => s.classId === next);
                setSectionId(first?._id ?? "");
              }}
            >
              {loadingStructure && <option value="">Loading…</option>}
              {classOptions.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Section">
            <Select aria-label="Section" value={sectionId} disabled={loadingStructure || sections.length === 0} onChange={(e) => selectSection(e.target.value)}>
              {sections.length === 0 && <option value="">{loadingStructure ? "Loading…" : "No sections"}</option>}
              {sections.map((s) => <option key={s._id} value={s._id}>Section {s.name}{s.isClassTeacher ? " · class teacher" : ""}</option>)}
            </Select>
          </FormField>
          <FormField label="Date"><Input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} /></FormField>
        </div>
        {ignoredLink && (
          <p role="status" className="mt-3 text-[12.5px] text-ink-muted">The class in the link isn&apos;t one of your sections, so your own section is shown instead.</p>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Tabs defaultValue="register">
          <TabsList items={[{ value: "register", label: "Register" }, { value: "history", label: "History" }]} />
          <TabsContent value="register">
            {loadingStructure ? (
              <Card className="flex items-center justify-center p-12" role="status" aria-label="Loading sections"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></Card>
            ) : selected ? (
              <Register key={`${selected._id}-${date}`} sectionId={selected._id} date={date} />
            ) : (
              <Card><EmptyState title={area === "admin" ? "No sections in the current academic year" : "No sections assigned"} description={area === "admin" ? "Create sections in Academics to start taking attendance." : "Classes assigned to you will appear here."} /></Card>
            )}
          </TabsContent>
          <TabsContent value="history">{selected && <SectionHistory sectionId={selected._id} />}</TabsContent>
        </Tabs>

        <GlassCard className="h-fit">
          <CardHeader title={area === "admin" ? "School overview" : "My sections"} description={formatLongDate(date)} />
          <div className="p-5">
            {!overviewList ? (
              <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>
            ) : (
              <>
                {area === "admin" && (
                  <div className="mb-4 rounded-xl bg-white/70 p-3.5">
                    <div className="flex items-end justify-between">
                      <p className="text-[13px] text-ink-muted">School attendance</p>
                      <p className="text-xl font-semibold text-sapphire">{formatPercent(overviewStats.percentage, 1)}</p>
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
                <ul className="grid grid-cols-3 gap-2 xl:grid-cols-3">
                  {overviewList.map((r) => {
                    const totalMarked = (r.presentCount ?? 0) + (r.absentCount ?? 0);
                    const pct = totalMarked > 0 ? ((r.presentCount ?? 0) / totalMarked) * 100 : 0;
                    return (
                      <li key={r.sectionId}>
                        <button
                          onClick={() => selectSection(r.sectionId)}
                          aria-pressed={r.sectionId === sectionId}
                          className={cn(
                            "w-full rounded-xl border px-2 py-2 text-center transition-colors",
                            r.sectionId === sectionId
                              ? "border-lagoon bg-lagoon text-white"
                              : r.marked
                              ? "border-teal/30 bg-teal-soft/60 hover:bg-teal-soft"
                              : "border-dashed border-mauve/60 bg-white/60 hover:bg-white"
                          )}
                        >
                          <span className="block text-sm font-semibold">{r.displayName}</span>
                          <span className={cn("block text-[11px]", r.sectionId === sectionId ? "text-white/80" : "text-ink-muted")}>
                            {r.marked ? formatPercent(pct) : "Not marked"}
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

function Register({ sectionId, date }: { sectionId: Id<"sections">; date: string }) {
  const { toast } = useToast();

  // `today` is the real current date (it only affects the canMark hint; `mark` re-checks on the server).
  const registerData = useSchoolQuery(api.attendance.getByDate, { sectionId, date, today: todayISO() });
  const markAttendance = useSchoolMutation(api.attendance.mark);
  const updateAttendance = useSchoolMutation(api.attendance.update);

  const [entries, setEntries] = useState<Record<string, AttendanceStatus>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (registerData && !dirty) {
      const initial: Record<string, AttendanceStatus> = {};
      registerData.students.forEach((s) => {
        if (s.status === "present" || s.status === "absent" || s.status === "late") {
          initial[s.studentId] = s.status;
        }
      });
      setEntries(initial);
    }
  }, [registerData, dirty]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 };
    Object.values(entries).forEach((v) => {
      if (v === "present" || v === "absent" || v === "late") c[v] += 1;
    });
    return c;
  }, [entries]);

  if (registerData === undefined) {
    return (
      <Card className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </Card>
    );
  }

  const r = registerData;
  const total = r.students.length;
  const writable = r.canMark || r.canEdit;
  const marked = Object.keys(entries).filter((id) => r.students.some((s) => s.studentId === id)).length;

  const setAll = (v: AttendanceStatus) => {
    setEntries(Object.fromEntries(r.students.map((s) => [s.studentId, v])));
    setDirty(true);
  };

  // Entries keyed by the server's own student ids (only students on this register).
  const registerEntries = () =>
    r.students.flatMap((s) => (entries[s.studentId] ? [{ studentId: s.studentId, status: entries[s.studentId] }] : []));

  const save = async () => {
    setSaving(true);
    try {
      if (r.session) {
        // Updating existing session
        const changes = registerEntries();
        await updateAttendance({
          sectionId,
          date,
          changes,
        });
        setDirty(false);
        toast({ title: "Attendance updated", description: `Class ${r.section.displayName} attendance updated successfully.` });
      } else {
        // Creating new register
        const entriesList = registerEntries();
        await markAttendance({
          sectionId,
          date,
          entries: entriesList,
        });
        setDirty(false);
        toast({ title: "Attendance saved", description: `Class ${r.section.displayName} attendance recorded.` });
      }
    } catch (e: any) {
      toast({ title: "Could not save attendance", description: e.message || String(e), tone: "error" });
    }
    setSaving(false);
  };

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

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-sapphire">Class {r.section.displayName} · {formatDate(date)}</h2>
          <p className="text-[13px] text-ink-muted">
            {r.session ? (
              <>
                Marked at {formatDateTime(new Date(r.session.markedAt).toISOString())}
                {r.session.lastEditedAt ? ` · Edited ${formatDateTime(new Date(r.session.lastEditedAt).toISOString())}` : ""}
              </>
            ) : (
              "Not marked yet"
            )}
            {dirty && <span className="ml-2 font-medium text-plum">· Unsaved changes</span>}
          </p>
        </div>
        {writable ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => setAll("present")}><CheckCheck className="h-4 w-4" /> Mark all present</Button>
            <Button size="sm" variant="outline" onClick={() => setAll("absent")}><UserX className="h-4 w-4" /> Mark all absent</Button>
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
        <Badge tone="teal" className="figures">{counts.present} present</Badge>
        <Badge tone="plum" className="figures">{counts.absent} absent</Badge>
        <Badge tone="lavender" className="figures">{counts.late} late</Badge>
        <Badge tone="outline" className="figures">{total - marked} unmarked</Badge>
        {total > 0 && <ProgressBar value={(marked / total) * 100} label="Register marked" className="ml-auto w-32 self-center" />}
      </div>

      {total === 0 ? (
        <EmptyState title="No students in this section" />
      ) : (
        <ul className="divide-y divide-line/50 px-5 py-2">
          {r.students.map((s) => (
            <li key={s.studentId} className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-teal-soft/30">
              <div className="flex min-w-0 items-center gap-3">
                <span className="mono-id w-6 shrink-0 text-right text-ink-muted">{s.rollNo ?? "—"}</span>
                <Avatar name={s.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                  <p className="text-[12px] text-ink-muted">Adm: <span className="mono-id">{s.admissionNo}</span></p>
                </div>
              </div>
              {writable ? (
                <Segmented<AttendanceStatus>
                  label={`Attendance for ${s.name}`}
                  size="sm"
                  variant="chips"
                  value={entries[s.studentId] ?? null}
                  onChange={(v) => {
                    setEntries((e) => ({ ...e, [s.studentId]: v }));
                    setDirty(true);
                  }}
                  options={STATUS_OPTIONS}
                />
              ) : entries[s.studentId] ? (
                <StatusBadge status={entries[s.studentId]} />
              ) : (
                <span className="text-[12.5px] text-ink-muted">Not marked</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {writable && (
        <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-2xl border-t border-line/60 bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-muted">
            {marked === total ? (
              <span className="inline-flex items-center gap-1 text-lagoon"><CheckCircle2 className="h-4 w-4" /> All {total} students marked</span>
            ) : (
              `${total - marked} student(s) still to mark`
            )}
          </p>
          <Button onClick={save} loading={saving} disabled={marked < total || (!dirty && !!r.session)}>
            <Save className="h-4 w-4" /> {r.session ? "Update attendance" : "Save attendance"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function SectionHistory({ sectionId }: { sectionId: Id<"sections"> }) {
  // Query past 30 days for this section
  const today = todayISO();
  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 30);
  const fromDate = pastDate.toISOString().slice(0, 10);

  const history = useSchoolQuery(api.attendance.listBySection, {
    sectionId,
    from: fromDate,
    to: today,
  });

  return (
    <Card>
      <CardHeader title="Recent registers" icon={<History className="h-4 w-4" />} />
      <div className="p-5">
        {history === undefined ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
        ) : history.length === 0 ? (
          <EmptyState title="No attendance history yet" />
        ) : (
          <ul className="divide-y divide-line/60">
            {history.map((h) => {
              const totalMarked = h.presentCount + h.absentCount;
              const pct = totalMarked > 0 ? (h.presentCount / totalMarked) * 100 : 0;
              return (
                <li key={h.date} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">{formatLongDate(h.date)}</p>
                    <p className="text-[12.5px] text-ink-muted">
                      Marked at {formatDateTime(new Date(h.markedAt).toISOString())}
                      {h.lastEditedAt ? ` · Edited ${formatDateTime(new Date(h.lastEditedAt).toISOString())}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status="present" label={`${h.presentCount} present`} />
                    <StatusBadge status="late" label={`${h.lateCount} late`} />
                    <StatusBadge status="absent" label={`${h.absentCount} absent`} />
                    <span className="w-14 text-right text-sm font-semibold text-sapphire">{formatPercent(pct)}</span>
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

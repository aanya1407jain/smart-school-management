"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX2, CheckCheck, CheckCircle2, History, Lock, Save, UserX } from "lucide-react";
import type { AttendanceStatus } from "@/types/domain";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import {
  Avatar, Badge, Button, Card, CardHeader, EmptyState, FormField, GlassCard, Input, PageHeader, QueryView, Segmented, Select, StatusBadge,
  Tabs, TabsContent, TabsList, useToast, ProgressBar,
} from "@/components/ui";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { formatDate, formatDateTime, formatLongDate, isSchoolDay, previousSchoolDay, todayISO } from "@/lib/utils/dates";
import { formatPercent } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; short: string; activeClass: string }[] = [
  { value: "present", label: "Present", short: "P", activeClass: "bg-teal text-white shadow-soft" },
  { value: "absent", label: "Absent", short: "A", activeClass: "bg-plum text-white shadow-soft" },
  { value: "late", label: "Late", short: "L", activeClass: "bg-mauve text-white shadow-soft" },
];

/** Shared by Admin (all sections) and Teacher (assigned sections only — enforced by the service). */
export function AttendanceWorkspace({ area }: { area: "admin" | "teacher" }) {
  const params = useSearchParams();
  const opts = useAcademicOptions();
  const defaultDate = isSchoolDay(todayISO()) ? todayISO() : previousSchoolDay(todayISO());
  const [date, setDate] = useState(defaultDate);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState(params.get("section") ?? "");
  const overview = useQuery(() => services.attendance.getDailyOverview(date), [date]);

  // Pick a sensible default section once options load (teacher: their class-teacher section).
  useEffect(() => {
    if (sectionId || !overview.data) return;
    const first = overview.data.rows.find((r) => r.isClassTeacher) ?? overview.data.rows.find((r) => !r.marked) ?? overview.data.rows[0];
    if (first) setSectionId(first.sectionId);
  }, [overview.data, sectionId]);
  useEffect(() => {
    const s = opts.data?.sections.find((x) => x.id === sectionId);
    if (s) setClassId(s.classId);
  }, [sectionId, opts.data]);

  const sections = (opts.data?.sections ?? []).filter((s) => !classId || s.classId === classId);
  const year = opts.data?.years.find((y) => y.id === opts.data?.currentYearId);

  return (
    <div>
      <PageHeader
        title="Attendance"
        description={area === "admin" ? "Monitor daily attendance for every section. Registers are marked and corrected by each section's class teacher." : "Mark and correct attendance for the section where you are class teacher. Other classes you teach are view-only."}
      />
      <Card className="mb-5 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FormField label="Academic year"><Select value={year?.id ?? ""} disabled>{year && <option value={year.id}>{year.name}</option>}</Select></FormField>
          <FormField label="Class">
            <Select value={classId} onChange={(e) => { setClassId(e.target.value); const first = opts.data?.sections.find((s) => s.classId === e.target.value); setSectionId(first?.id ?? ""); }}>
              {(opts.data?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Section">
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Date"><Input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} /></FormField>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Tabs defaultValue="register">
          <TabsList items={[{ value: "register", label: "Register" }, { value: "history", label: "History" }]} />
          <TabsContent value="register">{sectionId ? <Register key={`${sectionId}-${date}`} sectionId={sectionId} date={date} /> : <Card><EmptyState title="No sections assigned" description="Classes assigned to you will appear here." /></Card>}</TabsContent>
          <TabsContent value="history">{sectionId && <SectionHistory sectionId={sectionId} />}</TabsContent>
        </Tabs>

        <GlassCard className="h-fit">
          <CardHeader title={area === "admin" ? "School overview" : "My sections"} description={formatLongDate(date)} />
          <div className="p-5">
            <QueryView query={overview} loading="inline">
              {(o) => (
                <>
                  {area === "admin" && (
                    <div className="mb-4 rounded-xl bg-white/70 p-3.5">
                      <div className="flex items-end justify-between"><p className="text-[13px] text-ink-muted">School attendance</p><p className="text-xl font-semibold text-sapphire">{formatPercent(o.percentage, 1)}</p></div>
                      <ProgressBar className="mt-2" value={(o.markedSections / Math.max(1, o.totalSections)) * 100} label="Sections marked" />
                      <p className="mt-1.5 text-[12px] text-ink-muted">{o.markedSections}/{o.totalSections} sections marked · {o.totals.absent} absent</p>
                    </div>
                  )}
                  <ul className="grid grid-cols-3 gap-2 xl:grid-cols-3">
                    {o.rows.map((r) => (
                      <li key={r.sectionId}>
                        <button
                          onClick={() => setSectionId(r.sectionId)}
                          aria-pressed={r.sectionId === sectionId}
                          className={cn("w-full rounded-xl border px-2 py-2 text-center transition-colors", r.sectionId === sectionId ? "border-lagoon bg-lagoon text-white" : r.marked ? "border-teal/30 bg-teal-soft/60 hover:bg-teal-soft" : "border-dashed border-mauve/60 bg-white/60 hover:bg-white")}
                        >
                          <span className="block text-sm font-semibold">{r.label}</span>
                          <span className={cn("block text-[11px]", r.sectionId === sectionId ? "text-white/80" : "text-ink-muted")}>{r.marked ? formatPercent(r.percentage) : "Not marked"}{area === "teacher" && !r.canMark && " · view"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </QueryView>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function Register({ sectionId, date }: { sectionId: string; date: string }) {
  const { toast } = useToast();
  const q = useQuery(() => services.attendance.getRegister(sectionId, date), [sectionId, date]);
  const [entries, setEntries] = useState<Record<string, AttendanceStatus>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data && !dirty) setEntries(q.data.entries ?? {});
  }, [q.data, dirty]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0 };
    Object.values(entries).forEach((v) => (c[v] += 1));
    return c;
  }, [entries]);

  return (
    <QueryView query={q} loading="table">
      {(r) => {
        const total = r.students.length;
        const writable = r.canMark || r.canEdit;
        const marked = Object.keys(entries).filter((id) => r.students.some((s) => s.id === id)).length;
        const setAll = (v: AttendanceStatus) => { setEntries(Object.fromEntries(r.students.map((s) => [s.id, v]))); setDirty(true); };
        const save = async () => {
          setSaving(true);
          try {
            const res = await services.attendance.saveRegister(sectionId, date, entries);
            setDirty(false);
            toast({ title: res.updated ? "Attendance updated" : "Attendance saved", description: `Class ${r.sectionLabel}: ${formatPercent(res.percentage, 1)} · ${res.absent} absent${res.absent ? " — guardians notified" : ""}.` });
          } catch (e) {
            toast({ title: "Could not save attendance", description: (e as Error).message, tone: "error" });
          }
          setSaving(false);
        };
        if (!r.isSchoolDay) {
          return <Card><EmptyState icon={<CalendarX2 className="h-6 w-6" />} title="No school on this day" description={`${formatLongDate(date)} is a weekend. Choose a school day to mark attendance.`} /></Card>;
        }
        return (
          <Card>
            <div className="flex flex-col gap-3 border-b border-line/60 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-sapphire">Class {r.sectionLabel} · {formatDate(date)}</h2>
                <p className="text-[13px] text-ink-muted">
                  {r.markedBy ? <>Last saved by {r.markedBy} · {formatDateTime(r.markedAt!)}</> : "Not marked yet"}
                  {dirty && <span className="ml-2 font-medium text-plum">· Unsaved changes</span>}
                </p>
              </div>
              {writable ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="soft" onClick={() => setAll("present")}><CheckCheck className="h-4 w-4" /> Mark all present</Button>
                  <Button size="sm" variant="outline" onClick={() => setAll("absent")}><UserX className="h-4 w-4" /> Mark all absent</Button>
                </div>
              ) : <Badge tone="outline"><Lock className="h-3 w-3" /> View only</Badge>}
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
              <Badge tone="outline">{total - marked} unmarked</Badge>
            </div>
            {total === 0 ? <EmptyState title="No students in this section" /> : (
              <ul className="divide-y divide-line/50 px-5 py-2">
                {r.students.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="w-6 shrink-0 text-right text-[12px] text-ink-muted">{s.rollNo}</span>
                      <Avatar name={s.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                        <p className={cn("text-[12px]", (s.attendancePct ?? 100) < 85 ? "text-plum" : "text-ink-muted")}>Overall {formatPercent(s.attendancePct, 1)}</p>
                      </div>
                    </div>
                    {writable ? (
                      <Segmented<AttendanceStatus>
                        label={`Attendance for ${s.name}`}
                        size="sm"
                        value={entries[s.id] ?? null}
                        onChange={(v) => { setEntries((e) => ({ ...e, [s.id]: v })); setDirty(true); }}
                        options={STATUS_OPTIONS}
                      />
                    ) : entries[s.id] ? <StatusBadge status={entries[s.id]} /> : <span className="text-[12.5px] text-ink-muted">Not marked</span>}
                  </li>
                ))}
              </ul>
            )}
            {writable && <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-2xl border-t border-line/60 bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-ink-muted">{marked === total ? <span className="inline-flex items-center gap-1 text-lagoon"><CheckCircle2 className="h-4 w-4" /> All {total} students marked</span> : `${total - marked} student(s) still to mark`}</p>
              <Button onClick={save} loading={saving} disabled={marked < total || (!dirty && !!r.entries)}><Save className="h-4 w-4" /> {r.entries ? "Update attendance" : "Save attendance"}</Button>
            </div>}
          </Card>
        );
      }}
    </QueryView>
  );
}

function SectionHistory({ sectionId }: { sectionId: string }) {
  const q = useQuery(() => services.attendance.getSectionHistory(sectionId, 20), [sectionId]);
  return (
    <Card>
      <CardHeader title="Recent registers" icon={<History className="h-4 w-4" />} />
      <div className="p-5">
        <QueryView query={q} loading="inline">
          {(rows) => rows.length === 0 ? <EmptyState title="No attendance history yet" /> : (
            <ul className="divide-y divide-line/60">
              {rows.map((h) => (
                <li key={h.date} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">{formatLongDate(h.date)}</p>
                    <p className="text-[12.5px] text-ink-muted">{h.absentees.length ? `Absent: ${h.absentees.join(", ")}` : "Full attendance"} · by {h.markedBy}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status="present" label={`${h.present} present`} />
                    <StatusBadge status="late" label={`${h.late} late`} />
                    <StatusBadge status="absent" label={`${h.absent} absent`} />
                    <span className="w-14 text-right text-sm font-semibold text-sapphire">{formatPercent(h.percentage)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </div>
    </Card>
  );
}

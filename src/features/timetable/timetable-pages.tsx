"use client";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Period, Weekday } from "@/types/academics";
import type { TimetableCell } from "@/lib/services/timetable.service";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import { Button, Card, EmptyState, FormField, Input, Modal, PageHeader, QueryView, Segmented, Select, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { WEEKDAY_NAMES, formatClock } from "@/lib/utils/dates";
import { WeekGrid } from "./week-grid";

// ------------------------------------------------------------------ Admin

export function AdminTimetable() {
  const opts = useAcademicOptions();
  const [mode, setMode] = useState<"section" | "teacher">("section");
  const [sectionId, setSectionId] = useState("sec_10a");
  const [teacherId, setTeacherId] = useState("");
  const [edit, setEdit] = useState<{ day: Weekday; period: Period; entry?: TimetableCell } | null>(null);
  useEffect(() => { if (opts.data && !teacherId) setTeacherId(opts.data.teachers[0]?.id ?? ""); }, [opts.data, teacherId]);
  const sectionQ = useQuery(() => services.timetable.getSectionTimetable(sectionId), [sectionId], { enabled: mode === "section" && !!sectionId });
  const teacherQ = useQuery(() => services.timetable.getTeacherTimetable(teacherId), [teacherId], { enabled: mode === "teacher" && !!teacherId });

  return (
    <div>
      <PageHeader
        title="Timetable"
        description="Build each section's weekly timetable. Teacher and room clashes are blocked; teachers and students see the same schedule."
        actions={<Segmented label="View by" value={mode} onChange={setMode} options={[{ value: "section", label: "By class" }, { value: "teacher", label: "By teacher" }]} />}
      />
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          {mode === "section" ? (
            <FormField label="Class & section" className="w-48">
              <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                {(opts.data?.sections ?? []).map((s) => <option key={s.id} value={s.id}>Class {s.label}</option>)}
              </Select>
            </FormField>
          ) : (
            <FormField label="Teacher" className="w-64">
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                {(opts.data?.teachers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </FormField>
          )}
          <p className="pb-2 text-[13px] text-ink-muted">{mode === "section" ? "Click any slot to add or change a lesson." : "Read-only view. Edit lessons from the class view."}</p>
        </div>
        {mode === "section" ? (
          <QueryView query={sectionQ} loading="table" wrapError={false}>
            {(t) => <WeekGrid periods={t.periods} entries={t.entries} mode="section" onCellClick={(day, period, entry) => setEdit({ day, period, entry })} />}
          </QueryView>
        ) : (
          <QueryView query={teacherQ} loading="table" wrapError={false}>
            {(t) => t.entries.length === 0 ? <EmptyState title="No lessons scheduled for this teacher" /> : <WeekGrid periods={t.periods} entries={t.entries} mode="teacher" />}
          </QueryView>
        )}
      </Card>
      {edit && <EditSlotModal sectionId={sectionId} slot={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditSlotModal({ sectionId, slot, onClose }: { sectionId: string; slot: { day: Weekday; period: Period; entry?: TimetableCell }; onClose: () => void }) {
  const { toast } = useToast();
  const opts = useAcademicOptions();
  const overview = useQuery(() => services.academics.getOverview(), []);
  const [subjectId, setSubjectId] = useState(slot.entry?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState(slot.entry?.teacherId ?? "");
  const [room, setRoom] = useState(slot.entry?.room ?? "");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const section = overview.data?.classes.flatMap((c) => c.sections).find((s) => s.id === sectionId);
  const cls = overview.data?.classes.find((c) => c.id === section?.classId);
  const assigned = section?.subjectCoverage.find((c) => c.subjectId === subjectId)?.teacherId;
  useEffect(() => { if (assigned && !slot.entry) setTeacherId(assigned); }, [assigned, slot.entry]);
  useEffect(() => { if (!room && section) setRoom(section.room); }, [section, room]);
  const qualified = (opts.data?.teachers ?? []).filter((t) => !subjectId || t.specializationIds.includes(subjectId));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await services.timetable.upsertEntry({ sectionId, day: slot.day, period: slot.period.index, subjectId, teacherId, room });
      toast({ title: "Timetable updated", description: `${WEEKDAY_NAMES[slot.day]} · ${slot.period.label}` });
      onClose();
    } catch (e) { setError(e as Error); }
    setBusy(false);
  };
  const remove = async () => {
    if (!slot.entry) return;
    setBusy(true);
    try { await services.timetable.deleteEntry(slot.entry.id); toast({ title: "Lesson removed" }); onClose(); } catch (e) { setError(e as Error); }
    setBusy(false);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Class ${section?.label ?? ""} · ${WEEKDAY_NAMES[slot.day]}`} description={`${slot.period.label} · ${formatClock(slot.period.startTime)} – ${formatClock(slot.period.endTime)}`} size="sm"
      footer={<>{slot.entry && <Button variant="ghost" className="mr-auto text-plum" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Remove</Button>}<Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!subjectId || !teacherId} onClick={save}>Save lesson</Button></>}>
      <div className="space-y-4">
        <FormField label="Subject" required>
          <Select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setTeacherId(""); }}>
            <option value="">Select subject</option>
            {(cls?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Teacher" required hint={assigned ? "Defaults to the teacher assigned to this subject in Academics." : "No teacher assigned yet — choosing one creates the assignment."}>
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} disabled={!subjectId}>
            <option value="">Select teacher</option>
            {qualified.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Room"><Input value={room} onChange={(e) => setRoom(e.target.value)} /></FormField>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Teacher

export function TeacherTimetable() {
  const { user } = useSession();
  const opts = useAcademicOptions();
  const [view, setView] = useState<string>("me");
  const mine = useQuery(() => services.timetable.getTeacherTimetable(user?.teacherId ?? undefined), [user?.teacherId], { enabled: view === "me" });
  const sec = useQuery(() => services.timetable.getSectionTimetable(view), [view], { enabled: view !== "me" });
  return (
    <div>
      <PageHeader
        title="My Timetable"
        description="Your weekly teaching schedule, plus the full timetable of any class you teach."
        actions={
          <Select aria-label="Timetable view" value={view} onChange={(e) => setView(e.target.value)} className="w-52">
            <option value="me">My week</option>
            {(opts.data?.sections ?? []).map((s) => <option key={s.id} value={s.id}>Class {s.label} timetable</option>)}
          </Select>
        }
      />
      <Card className="p-4 sm:p-5">
        {view === "me" ? (
          <QueryView query={mine} loading="table" wrapError={false}>
            {(t) => t.entries.length === 0 ? <EmptyState title="No lessons scheduled yet" /> : <WeekGrid periods={t.periods} entries={t.entries} mode="teacher" />}
          </QueryView>
        ) : (
          <QueryView query={sec} loading="table" wrapError={false}>{(t) => <WeekGrid periods={t.periods} entries={t.entries} mode="section" />}</QueryView>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Student

export function StudentTimetable() {
  const studentId = useActiveStudentId();
  const q = useQuery(() => services.timetable.getStudentTimetable(studentId!), [studentId], { enabled: !!studentId });
  return (
    <div>
      <PageHeader title="My Class Timetable" description={q.data ? `Class ${q.data.sectionLabel} · ${q.data.room ?? ""} · today is highlighted` : undefined} />
      <Card className="p-4 sm:p-5">
        <QueryView query={q} loading="table" wrapError={false}>{(t) => <WeekGrid periods={t.periods} entries={t.entries} mode="section" />}</QueryView>
      </Card>
    </div>
  );
}

"use client";
/**
 * LIVE timetable builder for school-created admins (timetable:manage):
 * the school's bell schedule (periods) and each section's weekly lessons.
 * convex/timetable.ts is the authority: curriculum, persisted subject-teacher
 * assignments, working days, breaks and teacher/room/section clashes are all
 * checked there; this screen shows its messages.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { TimetableGrid } from "./timetable-grid";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Period = FunctionReturnType<typeof api.timetable.listPeriods>[number];
type Week = FunctionReturnType<typeof api.timetable.sectionTimetable>;
type Lesson = Week["lessons"][number];

export function LiveTimetableBuilder() {
  const periods = useSchoolQuery(api.timetable.listPeriods, {});
  const school = useSchoolQuery(api.schools.current, {});
  const sections = useSchoolQuery(api.academics.listSections, {});
  const [sectionId, setSectionId] = useState("");
  useEffect(() => { if (sections && !sectionId && sections[0]) setSectionId(sections[0]._id); }, [sections, sectionId]);
  const [periodForm, setPeriodForm] = useState<Period | "new" | null>(null);
  if (periods === undefined || school === undefined || sections === undefined) return <LoadingState variant="table" label="Loading timetable" />;
  const sorted = [...periods].sort((a, b) => a.index - b.index);
  return (
    <div className="space-y-5" data-testid="live-timetable-builder">
      <PageHeader title="Timetable" description="Set the school's bell schedule, then place each section's lessons. Teachers and students see changes immediately." />
      <Card>
        <CardHeader title="Bell schedule" description="Periods are shared by every section. Breaks cannot hold lessons." action={<Button size="sm" onClick={() => setPeriodForm("new")}><Plus className="h-4 w-4" /> Add period</Button>} />
        <div className="p-5 pt-2">
          {sorted.length === 0 ? <EmptyState icon={<Clock className="h-6 w-6" />} title="No periods yet" description="Add the school day's periods (and breaks) before placing lessons." /> : (
            <ul className="divide-y divide-line/60">
              {sorted.map((p) => (
                <li key={p.periodId} className="flex items-center gap-3 py-2.5">
                  <span className="w-8 text-sm font-bold text-sapphire">{p.index}</span>
                  <span className="flex-1 font-medium text-ink">{p.label} {p.isBreak && <Badge tone="neutral">Break</Badge>}</span>
                  <span className="text-[13px] text-ink-soft">{p.startTime}–{p.endTime}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.label}`} onClick={() => setPeriodForm(p)}><Pencil className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      {sections.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No sections yet" description="Create classes and sections in Academics, then build their timetables here." /></Card>
      ) : (
        <Card>
          <CardHeader title="Weekly lessons" description="Click a slot to place or change a lesson. Only teachers assigned to the subject in the section can be chosen." action={<Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-44">{sections.map((s) => <option key={s._id} value={s._id}>Class {s.displayName}</option>)}</Select>} />
          {sectionId && <SectionWeek sectionId={sectionId as Id<"sections">} classId={sections.find((s) => s._id === sectionId)!.classId} workingDays={school.settings.workingDays} />}
        </Card>
      )}
      {periodForm && <PeriodModal period={periodForm === "new" ? undefined : periodForm} nextIndex={(sorted.at(-1)?.index ?? 0) + 1} onClose={() => setPeriodForm(null)} />}
    </div>
  );
}

function SectionWeek({ sectionId, classId, workingDays }: { sectionId: Id<"sections">; classId: Id<"classes">; workingDays: number[] }) {
  const week = useSchoolQuery(api.timetable.sectionTimetable, { sectionId });
  const [slot, setSlot] = useState<{ dayOfWeek: number; period: Week["periods"][number]; lesson?: Lesson } | null>(null);
  if (week === undefined) return <div className="p-5"><LoadingState variant="table" /></div>;
  const periods = [...week.periods].sort((a, b) => a.index - b.index);
  const days = [...workingDays].sort((a, b) => a - b);
  if (periods.length === 0) return <div className="p-5"><EmptyState title="Add periods first" description="The bell schedule above is empty." /></div>;
  const byId = new Map(periods.map((p) => [p.periodId as string, p]));
  const lessonOf = (d: number, periodId: string) => week.lessons.find((x) => x.dayOfWeek === d && x.periodId === periodId);
  return (
    <div className="p-5 pt-2">
      <TimetableGrid
        caption={`Weekly lessons for Class ${week.section.displayName}`}
        days={days}
        periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
        lessonAt={(d, gp) => {
          const l = lessonOf(d, gp.key);
          return l ? { subject: l.subject, detail: [l.room, l.teacher].filter(Boolean).join(" · ") } : undefined;
        }}
        onSlotClick={(d, gp) => setSlot({ dayOfWeek: d, period: byId.get(gp.key)!, lesson: lessonOf(d, gp.key) })}
        slotLabel={(d, gp) => {
          const l = lessonOf(d, gp.key);
          return `${WEEKDAYS[d]} ${gp.label}: ${l ? `${l.subject} with ${l.teacher}` : "empty"}`;
        }}
      />
      {slot && <LessonModal sectionId={sectionId} classId={classId} sectionName={week.section.displayName} slot={slot} onClose={() => setSlot(null)} />}
    </div>
  );
}

function LessonModal({ sectionId, classId, sectionName, slot, onClose }: { sectionId: Id<"sections">; classId: Id<"classes">; sectionName: string; slot: { dayOfWeek: number; period: { periodId: Id<"periods">; label: string }; lesson?: Lesson }; onClose: () => void }) {
  const { toast } = useToast();
  const subjects = useSchoolQuery(api.academics.listClassSubjects, { classId });
  const assignments = useSchoolQuery(api.academics.listTeacherAssignments, { sectionId });
  const setEntry = useSchoolMutation(api.timetable.setEntry);
  const removeEntry = useSchoolMutation(api.timetable.removeEntry);
  const [subjectId, setSubjectId] = useState<string>(slot.lesson?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState<string>(slot.lesson?.teacherId ?? "");
  const [room, setRoom] = useState(slot.lesson?.room ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teachers = useMemo(() => (assignments ?? []).filter((a) => a.subjectId === subjectId), [assignments, subjectId]);
  useEffect(() => { if (!teachers.some((t) => t.teacherId === teacherId)) setTeacherId(teachers[0]?.teacherId ?? ""); }, [teachers, teacherId]);
  const save = async () => {
    if (!subjectId || !teacherId) return setError("Choose a subject and one of its assigned teachers.");
    setBusy(true);
    setError(null);
    try {
      const r = await setEntry({ sectionId, dayOfWeek: slot.dayOfWeek, periodId: slot.period.periodId, subjectId: subjectId as Id<"subjects">, teacherId: teacherId as Id<"teachers">, ...(room.trim() ? { room: room.trim() } : {}) });
      toast({ title: r.replaced ? "Lesson replaced" : "Lesson added" });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const title = `Class ${sectionName} · ${WEEKDAYS[slot.dayOfWeek]} · ${slot.period.label}`;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={slot.lesson ? "Change lesson" : "Add lesson"} description={title} size="md"
      footer={<>
        {slot.lesson && <Button variant="ghost" className="mr-auto" onClick={() => setConfirmRemove(true)}><Trash2 className="h-4 w-4" /> Remove</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save lesson</Button>
      </>}>
      {subjects === undefined || assignments === undefined ? <LoadingState variant="inline" /> : (
        <div className="space-y-4">
          <FormField label="Subject" required hint={subjects.length === 0 ? "This class has no curriculum yet (Academics)." : undefined}>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Choose a subject</option>{subjects.map((s) => <option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}</Select>
          </FormField>
          <FormField label="Teacher" required hint={subjectId && teachers.length === 0 ? "No teacher is assigned to this subject in this section (Academics → assignments)." : undefined}>
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} disabled={teachers.length === 0}>{teachers.map((t) => <option key={t.teacherId} value={t.teacherId}>{t.teacherName ?? "Teacher"}</option>)}</Select>
          </FormField>
          <FormField label="Room" hint="Optional. A room can hold one section per slot."><Input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={40} /></FormField>
          {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
        </div>
      )}
      {confirmRemove && slot.lesson && (
        <ConfirmDialog open onOpenChange={setConfirmRemove} title="Remove lesson?" description={`${slot.lesson.subject} with ${slot.lesson.teacher} will be removed from this slot.`} confirmLabel="Remove" tone="danger" loading={busy}
          onConfirm={async () => { setBusy(true); try { await removeEntry({ entryId: slot.lesson!.entryId }); toast({ title: "Lesson removed" }); onClose(); } catch (e) { setError(errText(e)); setConfirmRemove(false); } finally { setBusy(false); } }} />
      )}
    </Modal>
  );
}

function PeriodModal({ period, nextIndex, onClose }: { period?: Period; nextIndex: number; onClose: () => void }) {
  const { toast } = useToast();
  const upsert = useSchoolMutation(api.timetable.upsertPeriod);
  const remove = useSchoolMutation(api.timetable.removePeriod);
  const [index, setIndex] = useState(String(period?.index ?? nextIndex));
  const [label, setLabel] = useState(period?.label ?? `Period ${nextIndex}`);
  const [startTime, setStart] = useState(period?.startTime ?? "09:00");
  const [endTime, setEnd] = useState(period?.endTime ?? "09:45");
  const [isBreak, setBreak] = useState(period?.isBreak ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const n = Number(index);
    if (!Number.isInteger(n) || n < 1 || n > 20) return setError("Position must be a whole number from 1 to 20.");
    if (!label.trim()) return setError("Give the period a name.");
    if (startTime >= endTime) return setError("A period must end after it starts.");
    setBusy(true);
    setError(null);
    try {
      await upsert({ ...(period ? { periodId: period.periodId } : {}), index: n, label: label.trim(), startTime, endTime, isBreak });
      toast({ title: period ? "Period updated" : "Period added" });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={period ? `Edit ${period.label}` : "Add period"} size="sm"
      footer={<>
        {period && <Button variant="ghost" className="mr-auto" loading={busy} onClick={async () => { setBusy(true); try { await remove({ periodId: period.periodId }); toast({ title: "Period removed" }); onClose(); } catch (e) { setError(errText(e)); } finally { setBusy(false); } }}><Trash2 className="h-4 w-4" /> Remove</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <FormField label="Position" required><Input type="number" min={1} max={20} value={index} onChange={(e) => setIndex(e.target.value)} /></FormField>
          <FormField label="Name" required><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Starts" required><Input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="Ends" required><Input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} /></FormField>
        </div>
        <Checkbox label="This is a break (no lessons)" checked={isBreak} onChange={(e) => setBreak(e.target.checked)} />
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

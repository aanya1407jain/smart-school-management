"use client";
/**
 * Timetable builder for admins (every admin session; school's Convex records).
 * Layout: "By class" / "By teacher" views over the shared TimetableGrid, bell
 * schedule in a dialog. Workflow: click a slot to add/change a lesson (with a
 * subject-repeat hint and free-slot suggestions), drag a lesson to a free slot
 * (timetable.moveEntry, one atomic server step). Teacher / room clashes are
 * refused by the server (convex/timetable.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, FormField, Input, LoadingState, Modal, PageHeader, Segmented, Select, useToast } from "@/components/ui";
import { TimetableGrid, daysWithLessons } from "./timetable-grid";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Period = FunctionReturnType<typeof api.timetable.listPeriods>[number];
type Week = FunctionReturnType<typeof api.timetable.sectionTimetable>;
type Lesson = Week["lessons"][number];

export function LiveTimetableBuilder() {
  const periods = useSchoolQuery(api.timetable.listPeriods, {});
  const school = useSchoolQuery(api.schools.current, {});
  const sections = useSchoolQuery(api.academics.listSections, {});
  const teachers = useSchoolQuery(api.academics.listTeachers, {});
  const [mode, setMode] = useState<"section" | "teacher">("section");
  const [sectionId, setSectionId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  useEffect(() => { if (sections && !sectionId && sections[0]) setSectionId(sections[0]._id); }, [sections, sectionId]);
  useEffect(() => { if (teachers && !teacherId && teachers[0]) setTeacherId(teachers[0].teacherId); }, [teachers, teacherId]);
  const [bellOpen, setBellOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState<Period | "new" | null>(null);

  if (periods === undefined || school === undefined || sections === undefined || teachers === undefined) return <LoadingState variant="table" label="Loading timetable" />;
  const sorted = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.index - b.index);
  const editPeriod = (p: Period | "new") => { setBellOpen(false); setPeriodForm(p); };

  return (
    <div data-testid="live-timetable-builder">
      <PageHeader
        title="Timetable"
        description="Build each section's weekly timetable. Teacher and room clashes are blocked; teachers and students see the same schedule."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setBellOpen(true)}><Clock className="h-4 w-4" /> Bell schedule</Button>
            <Segmented label="View by" value={mode} onChange={setMode} options={[{ value: "section", label: "By class" }, { value: "teacher", label: "By teacher" }]} />
          </div>
        }
      />
      {sections.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No sections yet" description="Create classes and sections in Academics, then build their timetables here." /></Card>
      ) : (
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            {mode === "section" ? (
              <FormField label="Class & section" className="w-48">
                <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  {sections.map((s) => <option key={s._id} value={s._id}>Class {s.displayName}</option>)}
                </Select>
              </FormField>
            ) : (
              <FormField label="Teacher" className="w-64">
                <Select aria-label="Teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                  {teachers.map((t) => <option key={t.teacherId} value={t.teacherId}>{t.name}</option>)}
                </Select>
              </FormField>
            )}
            <p className="pb-2 text-[13px] text-ink-muted">
              {mode === "section" ? "Click any slot to add or change a lesson, or drag a lesson to a free slot." : "Read-only view. Edit lessons from the class view."}
            </p>
          </div>
          {mode === "section"
            ? sectionId && <SectionWeek sectionId={sectionId as Id<"sections">} classId={sections.find((s) => s._id === sectionId)!.classId} workingDays={school.settings.workingDays} onOpenBell={() => setBellOpen(true)} />
            : teacherId && <TeacherWeek teacherId={teacherId as Id<"teachers">} />}
        </Card>
      )}
      {bellOpen && (
        <Modal open onOpenChange={(o) => !o && setBellOpen(false)} title="Bell schedule" description="Periods are shared by every section. Breaks cannot hold lessons." size="md"
          footer={<><Button variant="outline" onClick={() => setBellOpen(false)}>Close</Button><Button onClick={() => editPeriod("new")}><Plus className="h-4 w-4" /> Add period</Button></>}>
          {sorted.length === 0 ? <EmptyState icon={<Clock className="h-6 w-6" />} title="No periods yet" description="Add the school day's periods (and breaks) before placing lessons." /> : (
            <ul className="divide-y divide-line/60">
              {sorted.map((p) => (
                <li key={p.periodId} className="flex items-center gap-3 py-2.5">
                  <span className="w-8 text-sm font-bold text-sapphire">{p.index}</span>
                  <span className="flex-1 font-medium text-ink">{p.label} {p.isBreak && <Badge tone="neutral">Break</Badge>}</span>
                  <span className="text-[13px] text-ink-soft">{p.startTime}–{p.endTime}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.label}`} onClick={() => editPeriod(p)}><Pencil className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {periodForm && <PeriodModal period={periodForm === "new" ? undefined : periodForm} nextIndex={Math.max(0, ...sorted.map((p) => p.index)) + 1} onClose={() => { setPeriodForm(null); setBellOpen(true); }} />}
    </div>
  );
}

/** "By teacher": one teacher's week across sections (read-only; edit from the class view). */
function TeacherWeek({ teacherId }: { teacherId: Id<"teachers"> }) {
  const week = useSchoolQuery(api.timetable.teacherTimetable, { teacherId });
  if (week === undefined) return <LoadingState variant="table" />;
  if (week.lessons.length === 0) return <EmptyState title="No lessons scheduled for this teacher" />;
  const periods = [...week.periods].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.index - b.index);
  return (
    <TimetableGrid
      caption="Teacher's weekly timetable"
      days={daysWithLessons(week.lessons.map((l) => l.dayOfWeek))}
      periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
      lessonAt={(d, gp) => {
        const l = week.lessons.find((x) => x.dayOfWeek === d && x.periodId === gp.key);
        return l ? { subject: l.subject, detail: [`Class ${l.section}`, l.room].filter(Boolean).join(" · ") } : undefined;
      }}
    />
  );
}

function SectionWeek({ sectionId, classId, workingDays, onOpenBell }: { sectionId: Id<"sections">; classId: Id<"classes">; workingDays: number[]; onOpenBell: () => void }) {
  const { toast } = useToast();
  const week = useSchoolQuery(api.timetable.sectionTimetable, { sectionId });
  const moveEntry = useSchoolMutation(api.timetable.moveEntry);
  const [slot, setSlot] = useState<{ dayOfWeek: number; period: Week["periods"][number]; lesson?: Lesson } | null>(null);

  if (week === undefined) return <LoadingState variant="table" />;
  const periods = [...week.periods].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.index - b.index);
  const days = [...workingDays].sort((a, b) => a - b);
  if (periods.length === 0) return <EmptyState title="Add periods first" description="The bell schedule is empty." action={<Button size="sm" onClick={onOpenBell}><Clock className="h-4 w-4" /> Bell schedule</Button>} />;

  const byId = new Map(periods.map((p) => [p.periodId as string, p]));
  const lessonOf = (d: number, periodId: string) => week.lessons.find((x) => x.dayOfWeek === d && x.periodId === periodId);

  // Drag and drop: one atomic server move (timetable.moveEntry) — the target must be free, clashes are checked there.
  const handleMoveLesson = async (source: { day: number; periodKey: string }, target: { day: number; periodKey: string }) => {
    const srcLesson = lessonOf(source.day, source.periodKey);
    if (!srcLesson) return;

    const tgtPeriod = byId.get(target.periodKey);
    if (!tgtPeriod || tgtPeriod.isBreak) {
      toast({ title: "Cannot drop into break period", tone: "error" });
      return;
    }
    if (lessonOf(target.day, target.periodKey)) {
      toast({ title: "That slot already has a lesson", description: "Move or remove it first.", tone: "error" });
      return;
    }

    try {
      await moveEntry({ entryId: srcLesson.entryId, dayOfWeek: target.day, periodId: tgtPeriod.periodId });
      toast({ title: `Moved ${srcLesson.subject} to ${WEEKDAYS[target.day]} (${tgtPeriod.label})` });
    } catch (e) {
      toast({ title: "Cannot move lesson", description: errText(e), tone: "error" });
    }
  };

  return (
    <div>
      <TimetableGrid
        caption={`Weekly lessons for Class ${week.section.displayName}`}
        days={days}
        periods={periods.map((p) => ({ key: p.periodId, label: p.label, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))}
        lessonAt={(d, gp) => {
          const l = lessonOf(d, gp.key);
          if (!l) return undefined;

          // Teacher and room clashes with other sections are refused by the server (setEntry / moveEntry),
          // so a stored lesson never has one. The only flag here is a planning hint: a subject placed 3+ times in a day.
          const sameDaySubject = week.lessons.filter((x) => x.dayOfWeek === d && x.subjectId === l.subjectId).length;
          const hasConflict = sameDaySubject >= 3;
          const conflictReason = hasConflict ? `${sameDaySubject}× this subject today` : undefined;

          return {
            id: l.entryId,
            subject: l.subject,
            detail: [l.room, l.teacher].filter(Boolean).join(" · "),
            hasConflict,
            conflictReason,
          };
        }}
        draggable
        onMoveLesson={handleMoveLesson}
        onSlotClick={(d, gp) => setSlot({ dayOfWeek: d, period: byId.get(gp.key)!, lesson: lessonOf(d, gp.key) })}
        slotLabel={(d, gp) => {
          const l = lessonOf(d, gp.key);
          return `${WEEKDAYS[d]} ${gp.label}: ${l ? `${l.subject} with ${l.teacher}` : "empty"}`;
        }}
      />
      {slot && (
        <LessonModal
          sectionId={sectionId}
          classId={classId}
          sectionName={week.section.displayName}
          slot={slot}
          existingLessons={week.lessons}
          allPeriods={periods}
          workingDays={days}
          onClose={() => setSlot(null)}
        />
      )}
    </div>
  );
}

function LessonModal({
  sectionId,
  classId,
  sectionName,
  slot,
  existingLessons,
  allPeriods,
  workingDays,
  onClose,
}: {
  sectionId: Id<"sections">;
  classId: Id<"classes">;
  sectionName: string;
  slot: { dayOfWeek: number; period: { periodId: Id<"periods">; label: string }; lesson?: Lesson };
  existingLessons: Lesson[];
  allPeriods: Period[];
  workingDays: number[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const subjects = useSchoolQuery(api.subjects.listClassSubjects, { classId });
  const assignments = useSchoolQuery(api.subjects.listTeacherAssignments, { sectionId });
  const setEntry = useSchoolMutation(api.timetable.setEntry);
  const removeEntry = useSchoolMutation(api.timetable.removeEntry);

  const [subjectId, setSubjectId] = useState<string>(slot.lesson?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState<string>(slot.lesson?.teacherId ?? "");
  const [room, setRoom] = useState(slot.lesson?.room ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teachers = useMemo(() => (assignments ?? []).filter((a) => a.subjectId === subjectId), [assignments, subjectId]);

  useEffect(() => {
    if (!teachers.some((t) => t.teacherId === teacherId)) {
      setTeacherId(teachers[0]?.teacherId ?? "");
    }
  }, [teachers, teacherId]);

  // Planning hint only: the subject already appears twice or more this day in this section. Teacher and
  // room clashes involve OTHER sections and are checked by the server on save (its message is shown).
  const conflict = useMemo(() => {
    if (!subjectId) return null;
    const subjectRepeats = existingLessons.filter((l) => l.dayOfWeek === slot.dayOfWeek && l.entryId !== slot.lesson?.entryId && l.subjectId === subjectId);
    return subjectRepeats.length >= 2 ? { type: "subject_cap", message: `This subject is already placed ${subjectRepeats.length} times on ${WEEKDAYS[slot.dayOfWeek]}.` } : null;
  }, [existingLessons, subjectId, slot]);

  // Smart suggestions: Find free slots in the week for this subject
  const suggestions = useMemo(() => {
    if (!subjectId) return [];
    const validPeriods = allPeriods.filter((p) => !p.isBreak);
    const freeSlots: { day: number; period: Period }[] = [];

    for (const d of workingDays) {
      const dayLessons = existingLessons.filter((l) => l.dayOfWeek === d);
      const hasSubject = dayLessons.some((l) => l.subjectId === subjectId);
      if (!hasSubject) {
        for (const p of validPeriods) {
          const occupied = dayLessons.some((l) => l.periodId === p.periodId);
          if (!occupied) {
            freeSlots.push({ day: d, period: p });
            if (freeSlots.length >= 3) break;
          }
        }
      }
      if (freeSlots.length >= 3) break;
    }
    return freeSlots;
  }, [allPeriods, existingLessons, subjectId, workingDays]);

  const save = async () => {
    if (!subjectId || !teacherId) return setError("Choose a subject and one of its assigned teachers.");
    setBusy(true);
    setError(null);
    try {
      const r = await setEntry({
        sectionId,
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.period.periodId,
        subjectId: subjectId as Id<"subjects">,
        teacherId: teacherId as Id<"teachers">,
        ...(room.trim() ? { room: room.trim() } : {}),
      });
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
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={slot.lesson ? "Change lesson" : "Add lesson"}
      description={title}
      size="md"
      footer={
        <>
          {slot.lesson && (
            <Button variant="ghost" className="mr-auto" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save lesson</Button>
        </>
      }
    >
      {subjects === undefined || assignments === undefined ? (
        <LoadingState variant="inline" />
      ) : (
        <div className="space-y-4">
          <FormField label="Subject" required hint={subjects.length === 0 ? "This class has no curriculum yet (Academics)." : undefined}>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Choose a subject</option>
              {subjects.map((s) => <option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}
            </Select>
          </FormField>

          <FormField label="Teacher" required hint={subjectId && teachers.length === 0 ? "No teacher is assigned to this subject in this section (Academics → assignments)." : undefined}>
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} disabled={teachers.length === 0}>
              {teachers.map((t) => <option key={t.teacherId} value={t.teacherId}>{t.teacherName ?? "Teacher"}</option>)}
            </Select>
          </FormField>

          <FormField label="Room" hint="Optional. A room can hold one section per slot.">
            <Input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={40} placeholder="e.g. Lab 2 / Room 204" />
          </FormField>

          {conflict && (
            <div className="flex items-start gap-2 rounded-xl border border-blush bg-blush/30 p-3 text-xs text-plum">
              <AlertTriangle className="h-4 w-4 shrink-0 text-plum mt-0.5" />
              <div>
                <p className="font-semibold">Check the plan</p>
                <p>{conflict.message}</p>
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="rounded-xl border border-line/70 bg-alabaster/60 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <Sparkles className="h-3.5 w-3.5 text-sapphire" />
                <span>Suggested alternative slots:</span>
              </div>
              <ul className="mt-2 space-y-1 text-ink-muted">
                {suggestions.map((s, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-teal" />
                    <span>{WEEKDAYS[s.day]} — {s.period.label} ({s.period.startTime}–{s.period.endTime})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
        </div>
      )}

      {confirmRemove && slot.lesson && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmRemove}
          title="Remove lesson?"
          description={`${slot.lesson.subject} with ${slot.lesson.teacher} will be removed from this slot.`}
          confirmLabel="Remove"
          tone="danger"
          loading={busy}
          onConfirm={async () => {
            setBusy(true);
            try {
              await removeEntry({ entryId: slot.lesson!.entryId });
              toast({ title: "Lesson removed" });
              onClose();
            } catch (e) {
              setError(errText(e));
              setConfirmRemove(false);
            } finally {
              setBusy(false);
            }
          }}
        />
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
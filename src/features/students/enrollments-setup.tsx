"use client";
/** Students' part of the Academics setup workspace: enrolling students who have no section yet (contributed, see src/modules/students/contributions.tsx). */
import { useState } from "react";
import { Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, FormField, Select, useToast } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/utils/dates";
import { NeedYear, Spinner, errText, useSectionSelection, type Section, type Teacher, type Year } from "@/features/academics/workspace-kit";
import type { AcademicsSetupCtx } from "@/lib/contributions/types";

export function EnrollmentsSetupTab({ ctx }: { ctx: AcademicsSetupCtx }) {
  return ctx.year ? <EnrollmentsTab year={ctx.year} sections={ctx.sections} /> : <NeedYear />;
}

function EnrollmentsTab({ year, sections }: { year: Year; sections: Section[] }) {
  const { toast } = useToast();
  const [sectionId, setSectionId] = useSectionSelection(sections);
  const roster = useSchoolQuery(api.students.sectionRoster, sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip");
  const unenrolled = useSchoolQuery(api.students.listUnenrolledStudents, { academicYearId: year._id });
  const enroll = useSchoolMutation(api.students.enrollStudent);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  const startDate = today < year.startDate ? year.startDate : today > year.endDate ? year.endDate : today;

  const enrolSelected = async () => {
    if (!target || selected.size === 0) return;
    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const studentId of selected) {
      try {
        await enroll({ studentId: studentId as Id<"students">, sectionId: target as Id<"sections">, startDate });
        done++;
      } catch (e) {
        failed.push(errText(e));
      }
    }
    setBusy(false);
    setSelected(new Set());
    const section = sections.find((s) => s._id === target);
    if (done) toast({ title: `${done} student${done === 1 ? "" : "s"} enrolled in ${section?.displayName ?? "the section"}`, description: "Roll numbers were updated alphabetically." });
    if (failed.length) toast({ title: `${failed.length} could not be enrolled`, description: failed[0], tone: "error" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Section roster & roll numbers"
          description="Students in roll-number order. Roll numbers are assigned by the system alphabetically (first name, then last name)."
          action={
            <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-48" disabled={sections.length === 0}>
              {sections.map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
            </Select>
          }
        />
        <div className="p-5">
          {!sectionId ? <EmptyState title="No sections available" description="Create a section first." />
            : roster === undefined ? <Spinner />
            : roster.students.length === 0 ? <EmptyState title="No students in this section" description="Enroll students below to populate the roster." />
            : (
              // Server order = roll-number order; rendered as-is (never re-sorted on the client).
              <ul className="divide-y divide-line/60" data-testid="live-roster">
                {roster.students.map((s) => (
                  <li key={s.studentId} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-center text-sm font-bold text-sapphire">{s.rollNo ?? "—"}</span>
                      <div><p className="font-medium text-ink">{s.name}</p><p className="text-[12px] text-ink-muted">Adm: {s.admissionNo}</p></div>
                    </div>
                    <Badge tone="teal">Enrolled</Badge>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Not yet enrolled" description={`Active students with no section in ${year.name}.`} icon={<Users className="h-4 w-4" />} />
        <div className="p-5">
          {unenrolled === undefined ? <Spinner /> : unenrolled.students.length === 0 ? (
            <EmptyState title="Everyone is enrolled" description="Every active student has a section this year." />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Enroll selected into">
                  <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-48">
                    <option value="">Choose a section</option>
                    {sections.map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
                  </Select>
                </FormField>
                <Button loading={busy} disabled={!target || selected.size === 0} onClick={enrolSelected}>Enroll {selected.size || ""}</Button>
                <span className="text-[12.5px] text-ink-muted">Start date {formatDate(startDate)}</span>
              </div>
              {unenrolled.truncated && <p className="text-[12.5px] text-plum">Showing the first {unenrolled.students.length} of {unenrolled.total}.</p>}
              <ul className="grid gap-2 sm:grid-cols-2">
                {unenrolled.students.map((s) => (
                  <li key={s.studentId} className="rounded-xl border border-line/70 px-3 py-2">
                    <Checkbox label={`${s.name} · ${s.admissionNo}`} checked={selected.has(s.studentId)} onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(s.studentId);
                      else next.delete(s.studentId);
                      setSelected(next);
                    }} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Teacher assignments

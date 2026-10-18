"use client";
/**
 * LIVE homework oversight for administrators (homework:read:all): homework set
 * in a section, with submission counts, and a read-only view of submissions.
 * Admins do not set or review homework (only the subject teacher does).
 */
import { useEffect, useState } from "react";
import { ClipboardList, Layers } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolQuery } from "@/lib/convex/membership";
import { Badge, Card, DataTable, Drawer, EmptyState, LoadingState, PageHeader, Select, StatusBadge, Button } from "@/components/ui";
import { AttachmentList } from "@/features/shared/attachments";
import { formatDate, formatDateTime } from "@/lib/utils/dates";

export function LiveAdminHomework() {
  const sections = useSchoolQuery(api.academics.listSections, {});
  const [sectionId, setSectionId] = useState("");
  useEffect(() => { if (sections && !sectionId && sections[0]) setSectionId(sections[0]._id); }, [sections, sectionId]);
  const rows = useSchoolQuery(api.homework.listForSection, sectionId ? { sectionId: sectionId as Id<"sections"> } : "skip");
  const [viewId, setViewId] = useState<Id<"homework"> | null>(null);
  if (sections === undefined) return <LoadingState variant="table" label="Loading sections" />;
  return (
    <div>
      <PageHeader title="Homework & Assignments" description="Homework set in each section, with submission counts. Teachers set and review homework; this view is read-only." />
      {sections.length === 0 ? (
        <Card><EmptyState icon={<Layers className="h-6 w-6" />} title="No sections set up yet" description="Create classes and sections in Academics first." /></Card>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-56">
              {sections.map((s) => <option key={s._id} value={s._id}>Class {s.displayName}</option>)}
            </Select>
          </Card>
          <Card>
            {rows === undefined ? <LoadingState variant="table" /> : (
              <DataTable
                caption="Homework in this section"
                rows={rows}
                getRowId={(h) => h.homeworkId}
                empty={<EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No homework in this section" description="Homework set by the section's subject teachers appears here." />}
                columns={[
                  { key: "t", header: "Homework", primary: true, cell: (h) => <span className="font-semibold text-ink">{h.title}</span> },
                  { key: "s", header: "Subject · teacher", cell: (h) => `${h.subject} · ${h.teacher || "—"}` },
                  { key: "d", header: "Due", cell: (h) => formatDate(h.dueDate) },
                  { key: "n", header: "Submitted", cell: (h) => `${h.submitted}/${h.students}` },
                  { key: "st", header: "Status", cell: (h) => <StatusBadge status={h.status} /> },
                ]}
                rowActions={(h) => <Button size="sm" variant="outline" onClick={() => setViewId(h.homeworkId)}>Submissions</Button>}
              />
            )}
          </Card>
        </>
      )}
      <Drawer open={!!viewId} onOpenChange={(o) => !o && setViewId(null)} title="Submissions" className="w-[min(100vw,36rem)]">
        {viewId && <AdminSubmissions homeworkId={viewId} />}
      </Drawer>
    </div>
  );
}

function AdminSubmissions({ homeworkId }: { homeworkId: Id<"homework"> }) {
  const data = useSchoolQuery(api.homework.submissions, { homeworkId });
  if (data === undefined) return <LoadingState variant="table" />;
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold text-sapphire">{data.homework.title}</p>
        <p className="text-[12.5px] text-ink-muted">Class {data.homework.section} · {data.homework.subject} · due {formatDate(data.homework.dueDate)}</p>
      </div>
      <ul className="divide-y divide-line/60">
        {data.students.map((s) => (
          <li key={s.studentId} className="py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-7 text-sm font-bold text-sapphire">{s.rollNo ?? "—"}</span>
              <span className="font-medium text-ink">{s.name}</span>
              {s.submission ? <StatusBadge status={s.submission.status} /> : <Badge tone="neutral">Not submitted</Badge>}
            </div>
            {s.submission && (
              <div className="mt-1 space-y-1 pl-9 text-[13px] text-ink-soft">
                <p className="text-[12px] text-ink-muted">{formatDateTime(new Date(s.submission.submittedAt).toISOString())}</p>
                {s.submission.content && <p className="whitespace-pre-line">{s.submission.content}</p>}
                {s.submission.attachmentFileIds.length > 0 && <AttachmentList ownerType="submission" ownerId={s.submission.submissionId} compact />}
                {s.submission.feedback && <p className="text-lagoon">Feedback: {s.submission.feedback}</p>}
              </div>
            )}
          </li>
        ))}
        {data.students.length === 0 && <li className="py-4"><EmptyState title="No students in this section" /></li>}
      </ul>
    </div>
  );
}

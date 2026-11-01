"use client";
/**
 * LIVE student-record panels on the admin student profile:
 *  - StudentDocuments: certificates / ID proofs (files kind student_document).
 *    Upload and delete: administrators (students:write, audited). Read: the
 *    administrators and the student themself only (server rule).
 *  - EnrollmentHistory: every enrollment across years (academics.enrollmentHistory).
 *  - EnrollmentActions: withdraw / mark completed (academics.endEnrollment) or
 *    transfer to another section (academics.enrollStudent). History is kept and
 *    the affected sections are renumbered on the server.
 */
import { useState } from "react";
import { ArrowRightLeft, LogOut } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { Button, Card, CardHeader, DataTable, EmptyState, FormField, Input, LoadingState, Modal, Select, StatusBadge, useToast } from "@/components/ui";
import { AttachmentList, UploadButton } from "@/features/shared/attachments";
import { formatDate, todayISO } from "@/lib/utils/dates";

export function StudentDocuments({ studentId, canManage }: { studentId: string; canManage: boolean }) {
  return (
    <Card data-testid="student-documents">
      <CardHeader title="Documents" description="Birth certificate, transfer certificate, ID proofs. Visible to administrators and the student only." action={canManage ? <UploadButton ownerType="student" ownerId={studentId} kind="student_document" label="Upload document" /> : undefined} />
      <div className="p-5 pt-2"><AttachmentList ownerType="student" ownerId={studentId} canRemove={canManage} emptyText="No documents uploaded yet." /></div>
    </Card>
  );
}

export function EnrollmentHistory({ studentId }: { studentId: string }) {
  const rows = useSchoolQuery(api.students.enrollmentHistory, { studentId: studentId as Id<"students"> });
  return (
    <Card data-testid="enrollment-history">
      <CardHeader title="Enrollment history" description="Every class and section across academic years. Ended enrollments keep their last roll number." />
      <div className="p-5 pt-2">
        {rows === undefined ? <LoadingState variant="inline" /> : (
          <DataTable caption="Enrollment history" rows={rows} getRowId={(r) => r.enrollmentId} empty={<EmptyState title="No enrollments" />}
            columns={[
              { key: "y", header: "Year", primary: true, cell: (r) => r.academicYear },
              { key: "c", header: "Class", cell: (r) => `${r.className}${r.section ? ` · ${r.section}` : ""}` },
              { key: "r", header: "Roll", cell: (r) => r.rollNo ?? "—" },
              { key: "d", header: "Dates", cell: (r) => `${formatDate(r.startDate)}${r.endDate ? ` – ${formatDate(r.endDate)}` : " – now"}` },
              { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            ]} />
        )}
      </div>
    </Card>
  );
}

export function EnrollmentActions({ studentId, enrollmentId, sectionLabel, studentName }: { studentId: string; enrollmentId: string; sectionLabel: string; studentName: string }) {
  const [mode, setMode] = useState<"end" | "transfer" | null>(null);
  return (
    <div className="flex flex-wrap gap-2 border-t border-line/60 px-5 py-3">
      <Button size="sm" variant="outline" onClick={() => setMode("transfer")}><ArrowRightLeft className="h-4 w-4" /> Transfer section</Button>
      <Button size="sm" variant="ghost" onClick={() => setMode("end")}><LogOut className="h-4 w-4" /> Withdraw / complete</Button>
      {mode === "end" && <EndEnrollmentModal enrollmentId={enrollmentId} sectionLabel={sectionLabel} studentName={studentName} onClose={() => setMode(null)} />}
      {mode === "transfer" && <TransferModal studentId={studentId} sectionLabel={sectionLabel} studentName={studentName} onClose={() => setMode(null)} />}
    </div>
  );
}

function EndEnrollmentModal({ enrollmentId, sectionLabel, studentName, onClose }: { enrollmentId: string; sectionLabel: string; studentName: string; onClose: () => void }) {
  const { toast } = useToast();
  const end = useSchoolMutation(api.students.endEnrollment);
  const [status, setStatus] = useState<"withdrawn" | "completed">("withdrawn");
  const [endDate, setEndDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await end({ enrollmentId: enrollmentId as Id<"enrollments">, status, endDate });
      toast({ title: status === "withdrawn" ? "Student withdrawn" : "Enrollment completed", description: `${studentName} left ${sectionLabel}; the section was renumbered.` });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`End ${studentName}'s enrollment`} description={`Class ${sectionLabel}. The record is kept as history; fees, attendance and results are not deleted.`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>End enrollment</Button></>}>
      <div className="grid gap-4">
        <FormField label="Reason"><Select value={status} onChange={(e) => setStatus(e.target.value as "withdrawn" | "completed")}><option value="withdrawn">Withdrawn / left the school</option><option value="completed">Completed the year</option></Select></FormField>
        <FormField label="Last day" required><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

function TransferModal({ studentId, sectionLabel, studentName, onClose }: { studentId: string; sectionLabel: string; studentName: string; onClose: () => void }) {
  const { toast } = useToast();
  const sections = useSchoolQuery(api.academics.listSections, {});
  const enroll = useSchoolMutation(api.students.enrollStudent);
  const [sectionId, setSectionId] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!sectionId) return setError("Choose the new section.");
    setBusy(true);
    setError(null);
    try {
      await enroll({ studentId: studentId as Id<"students">, sectionId: sectionId as Id<"sections">, startDate });
      toast({ title: "Student transferred", description: `${studentName} moved out of ${sectionLabel}; both sections were renumbered.` });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Transfer ${studentName}`} description={`From ${sectionLabel}. The old enrollment is kept as "transferred".`} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Transfer</Button></>}>
      <div className="grid gap-4">
        <FormField label="New section" required>
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Choose…</option>
            {(sections ?? []).filter((s) => s.displayName !== sectionLabel).map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
          </Select>
        </FormField>
        <FormField label="From" required><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
      </div>
    </Modal>
  );
}

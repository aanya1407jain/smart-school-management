"use client";
/**
 * Manual entry of one student or teacher. Uses the same server pipeline as a
 * spreadsheet import with a single row, so manual and bulk onboarding share
 * one set of validation rules (convex/model/importers.ts).
 */
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, Checkbox, FormField, Input, Modal, Select, useToast } from "@/components/ui";
import { useSchoolAction, useSchoolMutation, useSchoolQueryRunner } from "@/lib/convex/membership";
import { errorMessage } from "@/lib/convex/errors";
import { STUDENT_IMPORT, TEACHER_IMPORT, type ImportFieldSpec } from "@convex/model/importSpecs";
import { todayISO } from "@/lib/utils/dates";
import type { IssuedCredential } from "./credentials-modal";

const STUDENT_FIELDS = ["firstName", "lastName", "className", "section", "admissionNo", "admissionDate", "gender", "dateOfBirth", "guardianName", "guardianPhone", "guardianRelation", "guardianEmail", "loginId"];
const TEACHER_FIELDS = ["title", "firstName", "lastName", "employeeId", "designation", "gender", "email", "phone", "subjects", "qualification", "joiningDate", "loginId"];
type Issue = { field: string; message: string };

export function AddPersonModal({
  kind, open, onClose, onIssued,
}: { kind: "student" | "teacher"; open: boolean; onClose: () => void; onIssued: (c: IssuedCredential[]) => void }) {
  const { toast } = useToast();
  const spec = kind === "student" ? STUDENT_IMPORT : TEACHER_IMPORT;
  const keys = kind === "student" ? STUDENT_FIELDS : TEACHER_FIELDS;
  const fields = keys.map((k) => spec.fields.find((f) => f.key === k)!).filter(Boolean);

  const previewStudents = useSchoolQueryRunner(api.imports.previewStudents);
  const previewTeachers = useSchoolQueryRunner(api.imports.previewTeachers);
  const commitStudents = useSchoolMutation(api.imports.commitStudentRows);
  const commitTeachers = useSchoolMutation(api.imports.commitTeacherRows);
  const issue = useSchoolAction(api.accounts.issuePendingCredentials);

  const [values, setValues] = useState<Record<string, string>>({});
  const [createAccount, setCreateAccount] = useState(true);
  const [errors, setErrors] = useState<Issue[]>([]);
  const [warnings, setWarnings] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);

  const reset = () => { setValues({}); setErrors([]); setWarnings([]); setCreateAccount(true); };
  const close = () => { reset(); onClose(); };
  const errorFor = (key: string) => errors.filter((e) => e.field === key || (key === "firstName" && e.field === "fullName")).map((e) => e.message).join("; ") || undefined;

  const save = async () => {
    setSaving(true);
    try {
      const args = { rows: [{ rowNumber: 1, values }], createAccounts: createAccount, today: todayISO() };
      const preview = kind === "student" ? await previewStudents(args) : await previewTeachers(args);
      const row = preview.results[0];
      setErrors(row?.errors ?? []);
      setWarnings(row?.warnings ?? []);
      if (!row || row.status === "invalid") return;
      const result = kind === "student" ? await commitStudents(args) : await commitTeachers(args);
      const created = result.created[0];
      if (createAccount && created?.membershipId) {
        const [issued] = await issue({ targetMembershipIds: [created.membershipId as Id<"schoolMemberships">] });
        if (issued?.ok) onIssued([{ loginId: issued.loginId, displayName: issued.displayName, temporaryPassword: issued.temporaryPassword }]);
        else toast({ tone: "error", title: "Saved, but the password was not issued", description: issued && !issued.ok ? issued.error : undefined });
      }
      toast({ title: `${kind === "student" ? "Student" : "Teacher"} added`, description: created?.name });
      close();
    } catch (e) {
      toast({ tone: "error", title: "Could not save", description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      title={`Add ${kind}`}
      description={kind === "student" ? "Class and section must already exist in Academics for the current academic year." : "Subjects are matched by code or name as set up in Academics."}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save {kind}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.filter((f) => f.key !== "loginId").map((f) => (
          <FieldInput key={f.key} field={f} value={values[f.key] ?? ""} error={errorFor(f.key)} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        ))}
      </div>
      <div className="mt-5 space-y-3 rounded-xl border border-line/80 bg-white/60 p-4">
        <Checkbox
          checked={createAccount}
          onChange={(e) => setCreateAccount(e.target.checked)}
          label="Create a sign-in account"
          description="Issues a Login ID and a one-time temporary password."
        />
        {createAccount && (
          <FieldInput field={spec.fields.find((f) => f.key === "loginId")!} value={values.loginId ?? ""} error={errorFor("loginId")} onChange={(v) => setValues((s) => ({ ...s, loginId: v }))} />
        )}
      </div>
      {errors.some((e) => !keys.includes(e.field) && e.field !== "fullName") && (
        <ul className="mt-4 list-disc space-y-0.5 pl-5 text-[13px] text-plum" role="alert">
          {errors.filter((e) => !keys.includes(e.field) && e.field !== "fullName").map((e, i) => <li key={i}>{e.message}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-0.5 pl-5 text-[13px] text-ink-soft">
          {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
    </Modal>
  );
}

function FieldInput({ field, value, error, onChange }: { field: ImportFieldSpec; value: string; error?: string; onChange: (v: string) => void }) {
  const required = field.required || field.key === "firstName" || field.key === "lastName";
  if (field.kind === "gender") {
    return (
      <FormField label={field.label} error={error}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not specified</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>
        </Select>
      </FormField>
    );
  }
  return (
    <FormField label={field.label} required={required} hint={field.help} error={error}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={field.kind === "date" ? "date" : field.kind === "email" ? "email" : "text"}
        inputMode={field.kind === "phone" ? "tel" : field.kind === "integer" ? "numeric" : undefined}
        placeholder={field.kind === "date" ? undefined : field.example || undefined}
        autoComplete="off"
      />
    </FormField>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, KeyRound } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { services, ServiceError } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";
import { Button, Card, FormField, FormSection, Input, LoadingState, Modal, PageHeader, Select, ErrorState, useToast, LinkButton } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { todayISO } from "@/lib/utils/dates";

const phone = z.string().trim().regex(/^[+\d\s-]{8,}$/, "Enter a valid phone number");
const schema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["male", "female", "other"]),
  dateOfBirth: z.string().min(1, "Date of birth is required").refine((v) => v < todayISO(), "Must be in the past"),
  bloodGroup: z.string(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
  phone: z.union([z.literal(""), phone]),
  address: z.string().trim().min(5, "Address is required"),
  admissionDate: z.string().min(1, "Admission date is required"),
  classId: z.string().min(1, "Select a class"),
  sectionId: z.string().min(1, "Select a section"),
  status: z.enum(["active", "inactive", "transferred", "alumni"]),
  guardian: z.object({
    name: z.string().trim().min(2, "Guardian name is required"),
    relation: z.enum(["Mother", "Father", "Guardian", "Grandparent"]),
    phone,
    email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
    occupation: z.string(),
  }),
  assignFees: z.boolean(),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  firstName: "", lastName: "", gender: "female", dateOfBirth: "", bloodGroup: "O+", email: "", phone: "", address: "",
  admissionDate: todayISO(), classId: "", sectionId: "", status: "active",
  guardian: { name: "", relation: "Mother", phone: "", email: "", occupation: "" }, assignFees: true,
};

export function StudentForm({ studentId }: { studentId?: string }) {
  const emailDomain = useSchoolProfile()?.emailDomain ?? "school.edu";
  const router = useRouter();
  const { toast } = useToast();
  // Editing still works on the demo dataset (services.students); a NEW student is admitted in Convex,
  // so its class/section choices come from the server's real records — never demo ids.
  const editing = !!studentId;
  const opts = useAcademicOptions();
  const liveClasses = useSchoolQuery(api.academics.listClasses, editing ? "skip" : {});
  const liveSections = useSchoolQuery(api.academics.listSections, editing ? "skip" : {});
  const editable = useQuery(() => services.students.getEditable(studentId!), [studentId], { enabled: !!studentId });
  const [serverError, setServerError] = useState<Error | null>(null);
  const [created, setCreated] = useState<{ studentId: Id<"students">; admissionNo: string; section: string; rollNo: number | null; classTeacher: string | null; warnings: string[] } | null>(null);

  const createStudentWithEnrollment = useSchoolMutation(api.academics.createStudentWithEnrollment);

  const { register, handleSubmit, watch, reset, setValue, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (editable.data && opts.data) {
      const sec = opts.data.sections.find((s) => s.id === editable.data!.sectionId);
      reset({ ...editable.data, email: editable.data.email, classId: sec?.classId ?? "", assignFees: false });
    }
  }, [editable.data, opts.data, reset]);

  const classId = watch("classId");
  const classOptions = editing
    ? (opts.data?.classes ?? []).map((c) => ({ id: c.id, name: c.name }))
    : (liveClasses ?? []).filter((c) => c.active && (liveSections ?? []).some((s) => s.classId === c._id)).sort((a, b) => a.level - b.level).map((c) => ({ id: c._id as string, name: c.name }));
  const sections = editing
    ? (opts.data?.sections ?? []).filter((s) => s.classId === classId).map((s) => ({ id: s.id, name: s.name, detail: s.room }))
    : (liveSections ?? []).filter((s) => s.classId === classId).map((s) => ({ id: s._id as string, name: s.name, detail: s.classTeacherName ? `Class teacher: ${s.classTeacherName}` : "No class teacher yet" }));

  const onSubmit = async (v: Values) => {
    setServerError(null);
    try {
      if (studentId) {
        await services.students.update(studentId, { ...v, guardian: { ...v.guardian } });
        toast({ title: "Student updated", description: `${v.firstName} ${v.lastName}'s details were saved.` });
        router.push(`/admin/students/${studentId}`);
      } else {
        // The ids come from the server's own lists; the server re-validates class ↔ section ↔ year.
        const cls = (liveClasses ?? []).find((c) => c._id === v.classId);
        const section = (liveSections ?? []).find((s) => s._id === v.sectionId && s.classId === v.classId);
        if (!cls || !section) {
          setError("sectionId", { message: "Choose a class and section from the list" });
          return;
        }
        const res = await createStudentWithEnrollment({
          firstName: v.firstName,
          lastName: v.lastName,
          gender: v.gender,
          dateOfBirth: v.dateOfBirth,
          admissionDate: v.admissionDate,
          email: v.email || undefined,
          phone: v.phone || undefined,
          address: v.address,
          bloodGroup: v.bloodGroup,
          classId: cls._id,
          sectionId: section._id,
          guardian: {
            name: v.guardian.name,
            relation: v.guardian.relation,
            phone: v.guardian.phone,
            email: v.guardian.email || undefined,
            occupation: v.guardian.occupation || undefined,
          },
        });
        toast({ title: "Student enrolled", description: `${v.firstName} ${v.lastName} is enrolled in ${res.section}.` });
        setCreated(res);
      }
    } catch (e: any) {
      const app = getAppError(e);
      setServerError(app ? new Error(app.message) : e instanceof Error ? e : new Error(String(e)));
      const fieldErrors = app?.fields ?? (e instanceof ServiceError ? e.fieldErrors : undefined);
      if (fieldErrors) {
        Object.entries(fieldErrors).forEach(([k, msg]) => setError(k as keyof Values, { message: msg }));
      }
    }
  };

  if (studentId && (editable.isLoading || opts.isLoading)) return <LoadingState variant="table" />;
  if (studentId && editable.error) return <div className="solid-card"><ErrorState error={editable.error} /></div>;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={studentId ? "Edit student" : "Add student"}
        description={studentId ? "Update personal, enrollment and guardian details." : "Create the student record, enroll them in a section of the current academic year and link a guardian. Sign-in accounts are created separately in Accounts & Import."}
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card className="space-y-7 p-5 sm:p-7">
          <FormSection title="Personal details" description="As recorded on the birth certificate.">
            <FormField label="First name" required error={errors.firstName?.message}><Input {...register("firstName")} placeholder="e.g. Ishita" /></FormField>
            <FormField label="Last name" required error={errors.lastName?.message}><Input {...register("lastName")} placeholder="e.g. Menon" /></FormField>
            <FormField label="Gender" required><Select {...register("gender")}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></FormField>
            <FormField label="Date of birth" required error={errors.dateOfBirth?.message}><Input type="date" max={todayISO()} {...register("dateOfBirth")} /></FormField>
            <FormField label="Blood group"><Select {...register("bloodGroup")}>{["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((b) => <option key={b}>{b}</option>)}</Select></FormField>
          </FormSection>

          <FormSection title="Contact" description="Contact details only — students sign in with a Login ID issued in Accounts & Import.">
            <FormField label="Student email" hint={editing ? undefined : "Optional"} error={errors.email?.message}><Input type="email" {...register("email")} placeholder={`e.g. name@${emailDomain}`} /></FormField>
            <FormField label="Phone" error={errors.phone?.message}><Input type="tel" {...register("phone")} placeholder="+91 98xxx xxxxx" /></FormField>
            <FormField label="Home address" required error={errors.address?.message} className="sm:col-span-2"><Input {...register("address")} placeholder="House no., street, locality, city" /></FormField>
          </FormSection>

          <FormSection title="Enrollment" description="Current academic year. Roll numbers are assigned automatically (alphabetical, whole section). Teachers of the chosen section will see this student immediately.">
            <FormField label="Class" required error={errors.classId?.message}>
              <Select {...register("classId", { onChange: () => setValue("sectionId", "") })}>
                <option value="">Select class</option>
                {classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Section" required error={errors.sectionId?.message}>
              <Select {...register("sectionId")} disabled={!classId}>
                <option value="">{classId ? "Select section" : "Choose a class first"}</option>
                {sections.map((s) => <option key={s.id} value={s.id}>Section {s.name}{s.detail ? ` · ${s.detail}` : ""}</option>)}
              </Select>
            </FormField>
            <FormField label="Admission date" required error={errors.admissionDate?.message}><Input type="date" {...register("admissionDate")} /></FormField>
            {editing && <FormField label="Status"><Select {...register("status")}><option value="active">Active</option><option value="inactive">Inactive</option><option value="transferred">Transferred</option><option value="alumni">Alumni</option></Select></FormField>}
          </FormSection>

          <FormSection title="Guardian" description="Guardians are linked to students — one guardian can be linked to siblings.">
            <FormField label="Guardian name" required error={errors.guardian?.name?.message}><Input {...register("guardian.name")} placeholder="e.g. Kavita Menon" /></FormField>
            <FormField label="Relation" required><Select {...register("guardian.relation")}><option>Mother</option><option>Father</option><option>Guardian</option><option>Grandparent</option></Select></FormField>
            <FormField label="Guardian phone" required error={errors.guardian?.phone?.message}><Input type="tel" {...register("guardian.phone")} placeholder="+91 98xxx xxxxx" /></FormField>
            <FormField label="Guardian email" error={errors.guardian?.email?.message}><Input type="email" {...register("guardian.email")} placeholder="Optional" /></FormField>
            <FormField label="Occupation"><Input {...register("guardian.occupation")} placeholder="Optional" /></FormField>
          </FormSection>


          <FormError error={serverError} />
          <div className="flex flex-col-reverse gap-2 border-t border-line/70 pt-5 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>{studentId ? "Save changes" : "Add student"}</Button>
          </div>
        </Card>
      </form>

      <Modal
        open={!!created}
        onOpenChange={(o) => {
          if (!o && created) router.push(`/admin/students/${created.studentId}`);
        }}
        title="Student enrolled"
        size="sm"
        footer={
          <>
            <LinkButton
              href="/admin/students/new"
              onClick={() => {
                setCreated(null);
                reset(EMPTY);
              }}
              variant="outline"
            >
              Add another
            </LinkButton>
            <Button onClick={() => created && router.push(`/admin/students/${created.studentId}`)}>Open profile</Button>
          </>
        }
      >
        {created && (
          <div className="space-y-4 text-sm" data-testid="student-created">
            <p className="flex items-center gap-2 text-ink-soft"><CheckCircle2 className="h-5 w-5 text-lagoon" /> The student appears in class lists, attendance registers and the teachers&apos; rosters.</p>
            <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-alabaster p-4">
              <div><dt className="text-[12px] text-ink-muted">Admission no.</dt><dd className="font-mono font-semibold text-ink" data-testid="created-admission">{created.admissionNo}</dd></div>
              <div><dt className="text-[12px] text-ink-muted">Class</dt><dd className="font-semibold text-ink" data-testid="created-section">{created.section}{created.rollNo != null ? ` · Roll ${created.rollNo}` : ""}</dd></div>
              <div className="col-span-2"><dt className="text-[12px] text-ink-muted">Class teacher</dt><dd className="font-semibold text-ink">{created.classTeacher ?? "Not assigned yet"}</dd></div>
            </dl>
            {created.warnings.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-blush bg-blush/30 px-4 py-3 text-[12.5px] text-plum" role="status">
                {created.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <p className="flex items-start gap-2 text-[12.5px] text-ink-muted"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Sign-in accounts (Login ID + temporary password) are created by an administrator in Accounts &amp; Import — no password is generated here.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { services, ServiceError } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";
import { Button, Card, Checkbox, FormField, FormSection, Input, LoadingState, Modal, PageHeader, Select, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { useAcademicOptions } from "@/features/shared/use-academic-options";
import { todayISO } from "@/lib/utils/dates";

const schema = z.object({
  title: z.enum(["Mr.", "Ms.", "Mrs.", "Dr."]),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["male", "female", "other"]),
  email: z.string().trim().email("Enter a valid email"),
  phone: z.string().trim().regex(/^[+\d\s-]{8,}$/, "Enter a valid phone number"),
  designation: z.string().trim().min(2, "Designation is required"),
  qualification: z.string().trim().min(2, "Qualification is required"),
  specializationIds: z.array(z.string()).min(1, "Select at least one subject"),
  joiningDate: z.string().min(1, "Joining date is required"),
  address: z.string().trim(),
  status: z.enum(["active", "on_leave", "inactive"]),
});
type Values = z.infer<typeof schema>;

export function TeacherForm({ teacherId }: { teacherId?: string }) {
  const emailDomain = useSchoolProfile()?.emailDomain ?? "school.edu";
  const router = useRouter();
  const { toast } = useToast();
  const opts = useAcademicOptions();
  const existing = useQuery(() => services.teachers.getProfile(teacherId!), [teacherId], { enabled: !!teacherId });
  const [serverError, setServerError] = useState<Error | null>(null);
  const [created, setCreated] = useState<{ id: string; email: string } | null>(null);
  const { register, handleSubmit, control, reset, setError, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { title: "Ms.", firstName: "", lastName: "", gender: "female", email: "", phone: "", designation: "Teacher (TGT)", qualification: "", specializationIds: [], joiningDate: todayISO(), address: "", status: "active" },
  });
  useEffect(() => {
    if (existing.data) {
      const t = existing.data.teacher;
      reset({ title: t.title, firstName: t.firstName, lastName: t.lastName, gender: t.gender, email: t.email, phone: t.phone, designation: t.designation, qualification: t.qualification, specializationIds: t.specializationIds, joiningDate: t.joiningDate, address: t.address, status: t.status });
    }
  }, [existing.data, reset]);

  const onSubmit = async (v: Values) => {
    setServerError(null);
    try {
      if (teacherId) {
        await services.teachers.update(teacherId, v);
        toast({ title: "Teacher updated" });
        router.push(`/admin/teachers/${teacherId}`);
      } else {
        const r = await services.teachers.create(v);
        toast({ title: "Teacher added", description: "Assign classes under Academics → Teacher assignments." });
        setCreated(r);
      }
    } catch (e) {
      setServerError(e as Error);
      if (e instanceof ServiceError && e.fieldErrors) Object.entries(e.fieldErrors).forEach(([k, m]) => setError(k as keyof Values, { message: m }));
    }
  };

  if (teacherId && existing.isLoading) return <LoadingState variant="table" />;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={teacherId ? "Edit teacher" : "Add teacher"} description="Staff record and portal login. Class and subject assignments are made in Academics." />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card className="space-y-7 p-5 sm:p-7">
          <FormSection title="Personal details">
            <div className="grid grid-cols-[96px_1fr] gap-3 sm:col-span-2">
              <FormField label="Title"><Select {...register("title")}><option>Mr.</option><option>Ms.</option><option>Mrs.</option><option>Dr.</option></Select></FormField>
              <FormField label="First name" required error={errors.firstName?.message}><Input {...register("firstName")} /></FormField>
            </div>
            <FormField label="Last name" required error={errors.lastName?.message}><Input {...register("lastName")} /></FormField>
            <FormField label="Gender"><Select {...register("gender")}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></FormField>
          </FormSection>
          <FormSection title="Contact" description="The email is used as the teacher's portal login.">
            <FormField label="Email" required error={errors.email?.message}><Input type="email" {...register("email")} placeholder={`name@${emailDomain}`} /></FormField>
            <FormField label="Phone" required error={errors.phone?.message}><Input type="tel" {...register("phone")} /></FormField>
            <FormField label="Address" className="sm:col-span-2"><Input {...register("address")} /></FormField>
          </FormSection>
          <FormSection title="Employment">
            <FormField label="Designation" required error={errors.designation?.message}><Input {...register("designation")} /></FormField>
            <FormField label="Qualification" required error={errors.qualification?.message}><Input {...register("qualification")} placeholder="e.g. M.Sc. Physics, B.Ed." /></FormField>
            <FormField label="Joining date" required error={errors.joiningDate?.message}><Input type="date" {...register("joiningDate")} /></FormField>
            <FormField label="Status"><Select {...register("status")}><option value="active">Active</option><option value="on_leave">On leave</option><option value="inactive">Inactive</option></Select></FormField>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-[13px] font-medium text-ink-soft">Subjects qualified to teach <span className="text-plum">*</span></legend>
              <Controller control={control} name="specializationIds" render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(opts.data?.subjects ?? []).map((s) => (
                    <Checkbox key={s.id} label={s.name} checked={field.value.includes(s.id)} onChange={(e) => field.onChange(e.target.checked ? [...field.value, s.id] : field.value.filter((x) => x !== s.id))} />
                  ))}
                </div>
              )} />
              {errors.specializationIds && <p className="mt-1.5 text-[12.5px] font-medium text-plum" role="alert">{errors.specializationIds.message}</p>}
            </fieldset>
          </FormSection>
          <FormError error={serverError} />
          <div className="flex flex-col-reverse gap-2 border-t border-line/70 pt-5 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>{teacherId ? "Save changes" : "Add teacher"}</Button>
          </div>
        </Card>
      </form>
      <Modal open={!!created} onOpenChange={(o) => { if (!o && created) router.push(`/admin/teachers/${created.id}`); }} title="Teacher added" size="sm"
        footer={<><Button variant="outline" onClick={() => router.push("/admin/academics?tab=assignments")}>Assign classes</Button><Button onClick={() => created && router.push(`/admin/teachers/${created.id}`)}>Open profile</Button></>}>
        {created && (
          <div className="space-y-3 text-sm text-ink-soft">
            <p>Their dashboard stays empty until you assign classes.</p>
            <div className="rounded-2xl border border-line bg-alabaster p-4">
              <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted"><KeyRound className="h-3.5 w-3.5" /> Contact email</p>
              <p className="mt-2 font-mono text-[13px] text-ink">{created.email}</p>
              <p className="mt-1 text-[12.5px] text-ink-muted">Sign-in accounts (Login ID + temporary password) are created by an administrator in Accounts &amp; Import — no password is generated here.</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

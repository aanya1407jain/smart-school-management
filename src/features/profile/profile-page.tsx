"use client";
import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { services, ServiceError } from "@/lib/services";
import { getAppError } from "@/lib/convex/errors";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import { Avatar, Badge, Button, Card, CardHeader, FormField, Input, PageHeader, QueryView, useToast } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { ROLE_LABELS } from "@/lib/permissions";
import { TeacherProfileView } from "@/features/teachers/teacher-profile";
import { StudentProfileView } from "@/features/students/student-profile";

export function ProfilePage() {
  const { user, viewer } = useSession();
  const studentId = useActiveStudentId();
  const q = useQuery(() => services.school.getMyProfile(studentId ?? undefined), [studentId]);
  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Your account details and sign-in settings." />
      <QueryView query={q}>
        {(p) => (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <AccountCard displayName={p.displayName} loginId={viewer?.loginId ?? "—"} email={p.email} phone={p.phone} roleLabel={user.guardianId ? "Guardian" : p.title ?? ROLE_LABELS[p.role]} canRename={p.role === "admin"} />
            <PasswordCard />
          </div>
        )}
      </QueryView>
      {user.role === "teacher" && user.teacherId && <TeacherProfileView teacherId={user.teacherId} self />}
      {user.role === "student" && studentId && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-sapphire">{user.guardianId ? "Student record" : "My school record"}</h2>
          <StudentProfileView studentId={studentId} />
        </div>
      )}
    </div>
  );
}

function AccountCard({ displayName, loginId, email, phone, roleLabel, canRename }: { displayName: string; loginId: string; email: string; phone: string; roleLabel: string; canRename: boolean }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ displayName, phone });
  useEffect(() => setForm({ displayName, phone }), [displayName, phone]);
  const m = useMutation(services.school.updateMyContact);
  return (
    <Card>
      <CardHeader title="Account" description="Profile photo upload will be available once file storage is connected." />
      <div className="space-y-5 p-5">
        <div className="flex items-center gap-4">
          <Avatar name={displayName} size="xl" />
          <div>
            <p className="text-lg font-semibold text-sapphire">{displayName}</p>
            <p className="font-mono text-sm text-ink-muted">{loginId}</p>
            <Badge tone="teal" className="mt-1.5"><ShieldCheck className="h-3 w-3" /> {roleLabel}</Badge>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Display name" hint={canRename ? undefined : "Managed by the school office."} error={m.fieldErrors.displayName}><Input value={form.displayName} disabled={!canRename} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></FormField>
          <FormField label="Phone" error={m.fieldErrors.phone}><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
          <FormField label="Login ID" hint="Issued by your school. Contact the office to change it." className="sm:col-span-2"><Input value={loginId} disabled className="font-mono" /></FormField>
          <FormField label="Contact email" hint="Contact the office to change it." className="sm:col-span-2"><Input value={email} disabled /></FormField>
        </div>
        <div className="flex justify-end"><Button loading={m.isPending} onClick={async () => { if (await m.mutate(form)) toast({ title: "Profile updated" }); }}><Save className="h-4 w-4" /> Save</Button></div>
      </div>
    </Card>
  );
}

export function PasswordCard() {
  const { toast } = useToast();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [mismatch, setMismatch] = useState(false);
  // Convex Auth verifies the current password and stores only the new hash.
  const changePasswordAction = useAction(api.account.changePassword);
  const changePassword = useCallback(async (input: { current: string; next: string }) => {
    try {
      return await changePasswordAction({ currentPassword: input.current, newPassword: input.next });
    } catch (e) {
      const app = getAppError(e);
      if (app) throw new ServiceError(app.code === "INVALID_ARGUMENT" ? "VALIDATION" : app.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", app.message, app.fields);
      throw new Error("We couldn't change your password. Please try again.");
    }
  }, [changePasswordAction]);
  const m = useMutation(changePassword);
  return (
    <Card className="h-fit">
      <CardHeader title="Password" icon={<KeyRound className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        <FormField label="Current password" error={m.fieldErrors.current}><Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></FormField>
        <FormField label="New password" hint="At least 8 characters, with a letter and a number" error={m.fieldErrors.next}><Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></FormField>
        <FormField label="Confirm new password" error={mismatch ? "Passwords don't match" : undefined}><Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></FormField>
        <FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} />
        <Button className="w-full" loading={m.isPending} onClick={async () => {
          setMismatch(form.next !== form.confirm);
          if (form.next !== form.confirm) return;
          if (await m.mutate({ current: form.current, next: form.next })) { toast({ title: "Password changed" }); setForm({ current: "", next: "", confirm: "" }); }
        }}>Change password</Button>
      </div>
    </Card>
  );
}

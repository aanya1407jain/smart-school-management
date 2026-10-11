"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Database, Upload } from "lucide-react";
import type { SchoolSettings } from "@/types/domain";
import type { SchoolInfoInput } from "@/lib/services/school.service";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import { useSession } from "@/features/auth/session-provider";
import { Button, Card, CardHeader, Checkbox, ConfirmDialog, FormField, FormSection, Input, LinkButton, PageHeader, QueryView, Tabs, TabsContent, TabsList, useToast, Badge } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { LogoMark } from "@/components/brand/logo";
import { formatDate } from "@/lib/utils/dates";

export function SettingsPage() {
  const q = useQuery(() => services.lookup.getSchool(), []);
  return (
    <div>
      <PageHeader title="Settings" description="School information, academic year, general rules and notification preferences." />
      <QueryView query={q}>
        {(d) => (
          <Tabs defaultValue="school">
            <TabsList items={[{ value: "school", label: "School information" }, { value: "year", label: "Academic year" }, { value: "general", label: "General" }, { value: "notifications", label: "Notifications" }, { value: "data", label: "Demo data" }]} />
            <TabsContent value="school"><SchoolInfo initial={d.school} /></TabsContent>
            <TabsContent value="year">
              <Card className="p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-soft text-lagoon"><CalendarRange className="h-6 w-6" /></span>
                    <div><p className="text-[13px] text-ink-muted">Current academic year</p><p className="text-xl font-semibold text-sapphire">{d.currentYear.name}</p><p className="text-sm text-ink-muted">{formatDate(d.currentYear.startDate)} – {formatDate(d.currentYear.endDate)}</p></div>
                  </div>
                  <LinkButton href="/admin/academics?tab=years" variant="outline">Manage academic years</LinkButton>
                </div>
              </Card>
            </TabsContent>
            <TabsContent value="general"><GeneralSettings initial={d.school.settings} /></TabsContent>
            <TabsContent value="notifications"><NotificationSettings initial={d.school.settings} /></TabsContent>
            <TabsContent value="data"><DemoData /></TabsContent>
          </Tabs>
        )}
      </QueryView>
    </div>
  );
}

function SchoolInfo({ initial }: { initial: SchoolInfoInput }) {
  const { toast } = useToast();
  const [form, setForm] = useState<SchoolInfoInput>({ name: initial.name, tagline: initial.tagline, address: initial.address, phone: initial.phone, email: initial.email, website: initial.website, affiliation: initial.affiliation, principalName: initial.principalName });
  const m = useMutation(services.school.updateInfo);
  const field = (k: keyof SchoolInfoInput, label: string, wide?: boolean) => (
    <FormField label={label} error={m.fieldErrors[k]} className={wide ? "sm:col-span-2" : undefined}><Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></FormField>
  );
  return (
    <Card className="space-y-7 p-5 sm:p-7">
      <FormSection title="School logo" description="Shown on the splash screen, login, sidebar and receipts.">
        <div className="flex items-center gap-4 sm:col-span-2">
          <div className="grid h-20 w-20 place-items-center rounded-2xl border border-line bg-alabaster"><LogoMark size={56} /></div>
          <div>
            <Button variant="outline" disabled title="Available once file storage is connected"><Upload className="h-4 w-4" /> Upload new logo</Button>
            <p className="mt-1.5 text-[12.5px] text-ink-muted">Logo upload will be enabled with file storage in the next stage.</p>
          </div>
        </div>
      </FormSection>
      <FormSection title="Identity">
        {field("name", "School name")}
        {field("tagline", "Tagline")}
        {field("principalName", "Principal")}
        {field("affiliation", "Board affiliation")}
      </FormSection>
      <FormSection title="Contact">
        {field("address", "Address", true)}
        {field("phone", "Phone")}
        {field("email", "Email")}
        {field("website", "Website")}
      </FormSection>
      <FormError error={m.error && !Object.keys(m.fieldErrors).length ? m.error : null} />
      <div className="flex justify-end border-t border-line/70 pt-5"><Button loading={m.isPending} onClick={async () => { if (await m.mutate(form)) toast({ title: "School information saved" }); }}>Save changes</Button></div>
    </Card>
  );
}

function GeneralSettings({ initial }: { initial: SchoolSettings }) {
  const { toast } = useToast();
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const m = useMutation(services.school.updateSettings);
  return (
    <Card className="space-y-7 p-5 sm:p-7">
      <FormSection title="Attendance" description="These rules change every attendance percentage in the app immediately.">
        <FormField label="Low attendance threshold (%)" error={m.fieldErrors.lowAttendanceThreshold} hint="Students below this are flagged."><Input type="number" min={50} max={100} value={s.lowAttendanceThreshold} onChange={(e) => setS({ ...s, lowAttendanceThreshold: Number(e.target.value) })} /></FormField>
        <div className="flex items-end pb-2"><Checkbox label="Count late arrivals as present" checked={s.attendanceLateCountsAsPresent} onChange={(e) => setS({ ...s, attendanceLateCountsAsPresent: e.target.checked })} /></div>
      </FormSection>
      <FormSection title="Examinations" description="Applied to newly created exam papers.">
        <FormField label="Pass percentage"><Input type="number" min={1} max={100} value={s.passPercentage} onChange={(e) => setS({ ...s, passPercentage: Number(e.target.value) })} /></FormField>
        <FormField label="Currency"><Input value="Indian Rupee (₹)" disabled /></FormField>
      </FormSection>
      <div className="flex justify-end border-t border-line/70 pt-5"><Button loading={m.isPending} onClick={async () => { if (await m.mutate(s)) toast({ title: "Settings saved" }); }}>Save settings</Button></div>
    </Card>
  );
}

function NotificationSettings({ initial }: { initial: SchoolSettings }) {
  const { toast } = useToast();
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const m = useMutation(services.school.updateSettings);
  const items: { key: keyof SchoolSettings["notifications"]; label: string; desc: string }[] = [
    { key: "attendanceAlerts", label: "Attendance alerts", desc: "Notify students & guardians when marked absent or late." },
    { key: "feeReminders", label: "Fee notifications", desc: "Payment receipts, new fee assignments and concessions." },
    { key: "homeworkAlerts", label: "Homework alerts", desc: "New homework, submissions and reviews." },
    { key: "examAlerts", label: "Examination alerts", desc: "Date sheets, marks entry and published results." },
    { key: "noticeAlerts", label: "Notice alerts", desc: "Newly published notices for each audience." },
  ];
  return (
    <Card>
      <CardHeader title="In-app notifications" description="Email, SMS and push delivery will be added with the backend." />
      <ul className="divide-y divide-line/60 px-5">
        {items.map((i) => (
          <li key={i.key} className="py-4"><Checkbox label={i.label} description={i.desc} checked={s.notifications[i.key]} onChange={(e) => setS({ ...s, notifications: { ...s.notifications, [i.key]: e.target.checked } })} /></li>
        ))}
      </ul>
      <div className="flex justify-end border-t border-line/70 p-5"><Button loading={m.isPending} onClick={async () => { if (await m.mutate(s)) toast({ title: "Notification preferences saved" }); }}>Save preferences</Button></div>
    </Card>
  );
}

function DemoData() {
  const { toast } = useToast();
  const router = useRouter();
  const { logout } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-lavender/30 text-plum"><Database className="h-6 w-6" /></span>
          <div>
            <p className="font-semibold text-sapphire">Reset demo data <Badge tone="lavender" className="ml-1">Stage 1 only</Badge></p>
            <p className="max-w-xl text-sm text-ink-muted">Everything in this build is stored in your browser. Resetting restores the original demo dataset (the fictional Aster Academy) (students, fees, marks, attendance…) and signs you out.</p>
          </div>
        </div>
        <Button variant="danger" onClick={() => setOpen(true)}>Reset data</Button>
      </div>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="Reset all demo data?" description="All changes made in this browser will be lost." tone="danger" confirmLabel="Reset & sign out"
        onConfirm={async () => { await services.school.resetDemoData(); await logout(); toast({ title: "Demo data restored" }); router.replace("/login"); }} />
    </Card>
  );
}

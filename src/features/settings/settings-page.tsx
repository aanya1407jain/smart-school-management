"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Database, Upload } from "lucide-react";
import type { SchoolSettings } from "@/types/core";
import { requireDemo, type SchoolInfoInput } from "@/lib/demo/runtime";
import { useQuery, type QueryState } from "@/lib/hooks/use-query";
import { useMutation } from "@/lib/hooks/use-mutation";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { api } from "@convex/_generated/api";
import { useSession } from "@/features/auth/session-provider";
import { Button, Card, CardHeader, Checkbox, ConfirmDialog, FormField, FormSection, Input, LinkButton, PageHeader, QueryView, Tabs, TabsContent, TabsList, useToast, Badge } from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { LogoMark } from "@/components/brand/logo";
import { formatDate } from "@/lib/utils/dates";
import { useMemo } from "react";

// Demo-dataset edits (internal demo personas only; live schools use the Convex settings below).
const demoUpdateInfo = (input: SchoolInfoInput) => requireDemo().school.updateInfo(input);
const demoUpdateSettings = (settings: SchoolSettings) => requireDemo().school.updateSettings(settings);

export function SettingsPage() {
  const { dataSource } = useSession();
  const live = dataSource === "live";

  // Live Convex queries
  const liveCurrent = useSchoolQuery(api.schools.current, live ? {} : "skip");
  const liveYears = useSchoolQuery(api.academics.listAcademicYears, live ? {} : "skip");

  // Demo data
  const q = useQuery(() => requireDemo().school.getSchool(), [live], { enabled: !live });

  const adaptedLive = useMemo(() => {
    if (!liveCurrent) return undefined;
    if (!liveYears) return undefined;
    // No invented year: when the school has not set one, the Academic year tab says so.
    const currentYear = liveYears.find((y) => y.isCurrent) ?? null;

    const settingsObj: SchoolSettings = {
      attendanceLateCountsAsPresent: liveCurrent.settings.attendance.lateCountsAsPresent,
      lowAttendanceThreshold: liveCurrent.settings.attendance.lowAttendanceThreshold,
      passPercentage: liveCurrent.settings.grading.passPercentage,
      currency: "INR" as const,
      weekStartsOn: 1 as const,
      notifications: {
        attendanceAlerts: liveCurrent.settings.notifications.attendanceAlerts,
        feeReminders: liveCurrent.settings.notifications.feeReminders,
        homeworkAlerts: liveCurrent.settings.notifications.homeworkAlerts,
        examAlerts: liveCurrent.settings.notifications.examAlerts,
        noticeAlerts: liveCurrent.settings.notifications.noticeAlerts,
      },
    };

    return {
      school: {
        id: liveCurrent.school._id,
        name: liveCurrent.school.name,
        shortName: liveCurrent.school.shortName,
        code: liveCurrent.school.code,
        tagline: liveCurrent.school.tagline ?? "",
        address: liveCurrent.school.address ?? "",
        phone: liveCurrent.school.phone ?? "",
        email: liveCurrent.school.email ?? "",
        website: liveCurrent.school.website ?? "",
        affiliation: liveCurrent.school.affiliation ?? "",
        principalName: "",
        currentAcademicYearId: (currentYear?._id as string) ?? "",
        settings: settingsObj,
      },
      currentYear: currentYear ? { id: currentYear._id as string, name: currentYear.name, startDate: currentYear.startDate, endDate: currentYear.endDate } : null,
      gradingScheme: liveCurrent.settings.grading.scheme,
    };
  }, [liveCurrent, liveYears]);

  const queryState = useMemo<QueryState<any>>(
    () => (live ? { isLoading: adaptedLive === undefined, isRefreshing: false, data: adaptedLive, error: null, refetch: () => {} } : q),
    [live, adaptedLive, q],
  );

  return (
    <div>
      <PageHeader title="Settings" description="School information, academic year, general rules and notification preferences." />
      <QueryView query={queryState}>
        {(d) => (
          <Tabs defaultValue="school">
            <TabsList items={[{ value: "school", label: "School information" }, { value: "year", label: "Academic year" }, { value: "general", label: "General" }, { value: "notifications", label: "Notifications" }, { value: "data", label: live ? "System status" : "Demo data" }]} />
            <TabsContent value="school"><SchoolInfo initial={d.school} /></TabsContent>
            <TabsContent value="year">
              <Card className="p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-soft text-lagoon"><CalendarRange className="h-6 w-6" /></span>
                    <div><p className="text-[13px] text-ink-muted">Current academic year</p>{d.currentYear ? <><p className="text-xl font-semibold text-sapphire">{d.currentYear.name}</p><p className="text-sm text-ink-muted">{formatDate(d.currentYear.startDate)} – {formatDate(d.currentYear.endDate)}</p></> : <p className="text-xl font-semibold text-plum">Not set</p>}</div>
                  </div>
                  <LinkButton href="/admin/academics?tab=years" variant="outline">Manage academic years</LinkButton>
                </div>
              </Card>
            </TabsContent>
            <TabsContent value="general"><GeneralSettings initial={d.school.settings} gradingScheme={d.gradingScheme} /></TabsContent>
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
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const [form, setForm] = useState<SchoolInfoInput>({ name: initial.name, tagline: initial.tagline, address: initial.address, phone: initial.phone, email: initial.email, website: initial.website, affiliation: initial.affiliation, principalName: initial.principalName });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProfileMutation = useSchoolMutation(api.schools.updateProfile);
  const m = useMutation(demoUpdateInfo);

  const field = (k: keyof SchoolInfoInput, label: string, wide?: boolean) => (
    <FormField label={label} error={m.fieldErrors[k]} className={wide ? "sm:col-span-2" : undefined}><Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></FormField>
  );

  const handleSubmit = async () => {
    setError(null);
    setPending(true);
    try {
      if (live) {
        await updateProfileMutation({
          name: form.name.trim() || undefined,
          tagline: form.tagline.trim() || undefined,
          address: form.address.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          website: form.website.trim() || undefined,
          affiliation: form.affiliation.trim() || undefined,
        });
        toast({ title: "School information saved" });
      } else {
        if (await m.mutate(form)) toast({ title: "School information saved" });
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to save profile");
    } finally {
      setPending(false);
    }
  };

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
        {live ? (
          <FormField label="Principal" hint="Not stored for live schools yet."><Input value="" disabled placeholder="—" /></FormField>
        ) : field("principalName", "Principal")}
        {field("affiliation", "Board affiliation")}
      </FormSection>
      <FormSection title="Contact">
        {field("address", "Address", true)}
        {field("phone", "Phone")}
        {field("email", "Email")}
        {field("website", "Website")}
      </FormSection>
      <FormError error={error ? new Error(error) : (m.error && !Object.keys(m.fieldErrors).length ? m.error : null)} />
      <div className="flex justify-end border-t border-line/70 pt-5"><Button loading={pending || m.isPending} onClick={handleSubmit}>Save changes</Button></div>
    </Card>
  );
}

function GeneralSettings({ initial, gradingScheme }: { initial: SchoolSettings; gradingScheme?: string }) {
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const [s, setS] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setS(initial), [initial]);
  const updateSettingsMutation = useSchoolMutation(api.schools.updateSettings);
  const m = useMutation(demoUpdateSettings);

  const handleSubmit = async () => {
    setError(null);
    setPending(true);
    try {
      if (live) {
        await updateSettingsMutation({
          attendance: {
            lateCountsAsPresent: s.attendanceLateCountsAsPresent,
            lowAttendanceThreshold: s.lowAttendanceThreshold,
          },
          // Keep the school's grading scheme; only the pass percentage is edited here.
          grading: {
            scheme: gradingScheme ?? "percentage",
            passPercentage: s.passPercentage,
          },
        });
        toast({ title: "Settings saved" });
      } else {
        if (await m.mutate(s)) toast({ title: "Settings saved" });
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to save settings");
    } finally {
      setPending(false);
    }
  };

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
      <FormError error={error ? new Error(error) : null} />
      <div className="flex justify-end border-t border-line/70 pt-5"><Button loading={pending || m.isPending} onClick={handleSubmit}>Save settings</Button></div>
    </Card>
  );
}

function NotificationSettings({ initial }: { initial: SchoolSettings }) {
  const { toast } = useToast();
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const [s, setS] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setS(initial), [initial]);
  const updateSettingsMutation = useSchoolMutation(api.schools.updateSettings);
  const m = useMutation(demoUpdateSettings);

  const handleSubmit = async () => {
    setError(null);
    setPending(true);
    try {
      if (live) {
        await updateSettingsMutation({
          notifications: s.notifications,
        });
        toast({ title: "Notification preferences saved" });
      } else {
        if (await m.mutate(s)) toast({ title: "Notification preferences saved" });
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to save notification preferences");
    } finally {
      setPending(false);
    }
  };

  const items: { key: keyof SchoolSettings["notifications"]; label: string; desc: string }[] = [
    { key: "attendanceAlerts", label: "Attendance alerts", desc: "Notify students when marked absent or late." },
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
      <FormError error={error ? new Error(error) : null} />
      <div className="flex justify-end border-t border-line/70 p-5"><Button loading={pending || m.isPending} onClick={handleSubmit}>Save preferences</Button></div>
    </Card>
  );
}

function DemoData() {
  const { toast } = useToast();
  const router = useRouter();
  const { logout, dataSource, viewer } = useSession();
  const [open, setOpen] = useState(false);

  if (dataSource === "live") {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-soft text-lagoon"><Database className="h-6 w-6" /></span>
          <div>
            <p className="font-semibold text-sapphire">School records <Badge tone="teal" className="ml-1">Live</Badge></p>
            <p className="max-w-xl text-sm text-ink-muted">You are signed in to <strong>{viewer?.school.name ?? "your school"}</strong>&apos;s live records. Changes made on connected pages are saved to the school&apos;s database; there is no demo data to reset here.</p>
          </div>
        </div>
      </Card>
    );
  }

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
        onConfirm={async () => { await requireDemo().school.resetDemoData(); await logout(); toast({ title: "Demo data restored" }); router.replace("/login"); }} />
    </Card>
  );
}

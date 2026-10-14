"use client";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Cake, Droplet, FileText, Mail, MapPin, Pencil, Phone, UserRound, Wallet, CalendarDays, Download } from "lucide-react";
import type { StudentProfile as Profile } from "@/lib/services/students.service";
import { useSession } from "@/features/auth/session-provider";
import {
  Avatar, Badge, Card, CardHeader, EmptyState, GlassCard, LinkButton, ProgressRing, StatusBadge, Tabs, TabsContent, TabsList,
} from "@/components/ui";
import { ChartTooltip, axisProps } from "@/components/charts/chart-card";
import { CHART, CHART_GRID } from "@/lib/constants/theme";
import { formatCurrency, formatPercent, titleCase } from "@/lib/utils/format";
import { formatDate, formatShortDate, formatWeekday, daysBetween, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { FeeObligationsTable, PaymentsTable } from "@/features/fees/fee-tables";
import { ResultCard } from "@/features/examinations/result-card";

/**
 * DEMO-mode student profile: the in-browser demo dataset (services.students),
 * used only for demo personas viewing demo records (ids such as "stu_aarav").
 * Real records use the Convex-backed view in ./student-profile.tsx.
 */
export function DemoStudentProfileBody({ p, backHref }: { p: Profile; backHref?: string }) {
  const { can } = useSession();
  const s = p.student;
  const name = `${s.firstName} ${s.lastName}`;
  const age = Math.floor(daysBetween(s.dateOfBirth, todayISO()) / 365.25);
  const isAdmin = can("students:write");
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "academic", label: "Academic" },
    { value: "attendance", label: "Attendance" },
    ...(p.fees ? [{ value: "fees", label: "Fees" }] : []),
    { value: "exams", label: "Examinations", count: p.results.length },
    { value: "homework", label: "Homework", count: p.homework.length },
    { value: "documents", label: "Documents", count: s.documents.length },
    { value: "guardian", label: "Guardian" },
  ];
  const pendingHw = p.homework.filter((h) => h.status === "pending" || h.status === "overdue").length;

  return (
    <div className="space-y-6">
      <GlassCard className="relative overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-lavender/35 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={name} size="xl" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-sapphire">{name}</h1>
                <StatusBadge status={s.status} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                <span className="font-mono">{s.admissionNo}</span> · {p.classInfo.longLabel}{p.enrollment && ` · Roll ${p.enrollment.rollNo}`}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">Class teacher: <span className="text-ink">{p.classInfo.classTeacher ?? "—"}</span></p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {backHref && <LinkButton href={backHref} variant="ghost">Back</LinkButton>}
            {isAdmin && <LinkButton href={`/admin/fees/${s.id}`} variant="outline"><Wallet className="h-4 w-4" /> Fee ledger</LinkButton>}
            {isAdmin && <LinkButton href={`/admin/students/${s.id}/edit`}><Pencil className="h-4 w-4" /> Edit</LinkButton>}
          </div>
        </div>
        <dl className="relative mt-6 grid grid-cols-2 gap-4 border-t border-white/70 pt-5 sm:grid-cols-4">
          <Metric label="Attendance" value={formatPercent(p.attendance.stats.percentage, 1)} tone={(p.attendance.stats.percentage ?? 100) < 85 ? "warn" : undefined} />
          <Metric label="Latest result" value={p.results[0]?.percentage != null ? `${formatPercent(p.results[0].percentage, 1)} · ${p.results[0].grade}` : "—"} />
          <Metric label="Pending homework" value={String(pendingHw)} />
          <Metric label="Fee balance" value={p.fees ? (p.fees.totals.outstanding ? formatCurrency(p.fees.totals.outstanding) : "Paid") : "Restricted"} tone={p.fees?.standing === "overdue" ? "warn" : undefined} />
        </dl>
      </GlassCard>

      <Tabs defaultValue="overview">
        <TabsList items={tabs} />

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Personal information" />
              <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
                <Info icon={<Cake />} label="Date of birth" value={`${formatDate(s.dateOfBirth)} (${age} yrs)`} />
                <Info icon={<UserRound />} label="Gender" value={titleCase(s.gender)} />
                <Info icon={<Droplet />} label="Blood group" value={s.bloodGroup} />
                <Info icon={<CalendarDays />} label="Admitted on" value={formatDate(s.admissionDate)} />
                <Info icon={<Mail />} label="Email" value={s.email} />
                <Info icon={<Phone />} label="Phone" value={s.phone || "—"} />
                <Info icon={<MapPin />} label="Address" value={s.address} className="sm:col-span-2" />
              </dl>
            </Card>
            <Card>
              <CardHeader title="Primary guardian" />
              <div className="p-5">
                {p.guardians[0] ? (
                  <div className="flex items-start gap-3">
                    <Avatar name={p.guardians[0].name} />
                    <div className="text-sm">
                      <p className="font-semibold text-ink">{p.guardians[0].name}</p>
                      <p className="text-ink-muted">{p.guardians[0].relation} · {p.guardians[0].occupation}</p>
                      <p className="mt-2 text-ink-soft">{p.guardians[0].phone}</p>
                      <p className="text-ink-soft">{p.guardians[0].email}</p>
                    </div>
                  </div>
                ) : <EmptyState title="No guardian linked" />}
              </div>
              {p.account && <p className="border-t border-line/60 px-5 py-3 text-[12.5px] text-ink-muted">Portal login: <span className="font-mono text-ink-soft">{p.account.email}</span></p>}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="academic">
          <Card>
            <CardHeader title="Subjects & teachers" description={`${p.classInfo.longLabel} · ${p.classInfo.room ?? ""}`} />
            <ul className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {p.teachers.map((t) => (
                <li key={t.subjectId} className="rounded-xl border border-line/70 bg-alabaster/60 px-4 py-3">
                  <p className="text-sm font-semibold text-ink">{t.subject}</p>
                  <p className="text-[12.5px] text-ink-muted">{t.teacher}</p>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="attendance">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="flex flex-col items-center justify-center p-6 text-center">
              <ProgressRing value={p.attendance.stats.percentage} size={132} stroke={11} sublabel="this year" />
              <dl className="mt-5 grid w-full grid-cols-3 gap-2 text-sm">
                <div><dt className="text-ink-muted">Present</dt><dd className="font-semibold text-ink">{p.attendance.stats.present}</dd></div>
                <div><dt className="text-ink-muted">Late</dt><dd className="font-semibold text-ink">{p.attendance.stats.late}</dd></div>
                <div><dt className="text-ink-muted">Absent</dt><dd className="font-semibold text-ink">{p.attendance.stats.absent}</dd></div>
              </dl>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Monthly attendance" description="Days present vs absent" />
              <div className="h-60 px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={p.attendance.monthly.map((m) => ({ ...m, label: new Date(`${m.month}-01T00:00:00`).toLocaleString("en-IN", { month: "short" }), attended: m.present + m.late }))} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART_GRID} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} width={30} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(188,197,204,0.18)" }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="attended" name="Present (incl. late)" stackId="a" fill={CHART.primary} maxBarSize={34} stroke="#fff" strokeWidth={1} />
                    <Bar dataKey="absent" name="Absent" stackId="a" fill={CHART.secondary} radius={[4, 4, 0, 0]} maxBarSize={34} stroke="#fff" strokeWidth={1} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader title="Recent days" />
              <ul className="flex flex-wrap gap-2 p-5">
                {p.attendance.recent.map((r) => (
                  <li key={r.date} className={cn("w-[74px] rounded-xl border px-2 py-2 text-center", r.status === "absent" ? "border-purple/30 bg-blush/40" : r.status === "late" ? "border-mauve/30 bg-lavender/20" : "border-line/70 bg-white")}>
                    <p className="text-[11px] text-ink-muted">{formatWeekday(r.date)}</p>
                    <p className="text-sm font-semibold text-ink">{formatShortDate(r.date)}</p>
                    <p className={cn("text-[11px] font-semibold capitalize", r.status === "absent" ? "text-plum" : r.status === "late" ? "text-plum" : "text-lagoon")}>{r.status}</p>
                  </li>
                ))}
                {p.attendance.recent.length === 0 && <EmptyState title="No attendance records yet" />}
              </ul>
            </Card>
          </div>
        </TabsContent>

        {p.fees && (
          <TabsContent value="fees">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <Metric boxed label="Total fees" value={formatCurrency(p.fees.totals.gross)} />
                <Metric boxed label="Concession" value={formatCurrency(p.fees.totals.concession)} />
                <Metric boxed label="Paid" value={formatCurrency(p.fees.totals.paid)} />
                <Metric boxed label="Outstanding" value={formatCurrency(p.fees.totals.outstanding)} tone={p.fees.totals.overdue > 0 ? "warn" : undefined} />
              </div>
              <Card><CardHeader title="Installments" /><div className="p-5"><FeeObligationsTable obligations={p.fees.obligations} /></div></Card>
              <Card><CardHeader title="Payment history" /><div className="p-5"><PaymentsTable payments={p.fees.payments.map((x) => ({ ...x, receiptNo: p.fees!.receipts.find((r) => r.id === x.receiptId)?.receiptNo ?? "" }))} /></div></Card>
            </div>
          </TabsContent>
        )}

        <TabsContent value="exams">
          {p.results.length === 0 ? <Card><EmptyState title="No examination results" description="Results appear here once marks are entered." /></Card> : (
            <div className="grid gap-4 lg:grid-cols-2">{p.results.map((r) => r && <ResultCard key={r.examId} result={r} />)}</div>
          )}
        </TabsContent>

        <TabsContent value="homework">
          <Card>
            {p.homework.length === 0 ? <EmptyState title="No homework assigned yet" /> : (
              <ul className="divide-y divide-line/60">
                {p.homework.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{h.title}</p>
                      <p className="text-[12.5px] text-ink-muted">{h.subject} · due {formatDate(h.dueDate)}</p>
                    </div>
                    <StatusBadge status={h.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            {s.documents.length === 0 ? <EmptyState title="No documents uploaded" description="Document upload will be available once file storage is connected." icon={<FileText className="h-6 w-6" />} /> : (
              <ul className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {s.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line/70 bg-alabaster/50 p-3.5">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-lagoon shadow-soft"><FileText className="h-5 w-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                      <p className="text-[12px] text-ink-muted">{titleCase(d.kind)} · {d.sizeKb} KB · {formatShortDate(d.uploadedAt)}</p>
                    </div>
                    <button className="rounded-lg p-2 text-ink-muted hover:bg-white hover:text-ink" aria-label={`Download ${d.name} (demo)`} title="File storage arrives with the backend"><Download className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="guardian">
          <div className="grid gap-4 md:grid-cols-2">
            {p.guardians.map((g) => (
              <Card key={g.id} className="p-5">
                <div className="flex items-start gap-3">
                  <Avatar name={g.name} size="lg" />
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2"><p className="text-base font-semibold text-ink">{g.name}</p>{g.isPrimary && <Badge tone="teal">Primary</Badge>}</div>
                    <p className="text-ink-muted">{g.relation} · {g.occupation}</p>
                    <dl className="mt-3 space-y-1.5 text-ink-soft">
                      <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-ink-muted" aria-hidden />{g.phone}</div>
                      <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-ink-muted" aria-hidden />{g.email}</div>
                      <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-ink-muted" aria-hidden />{g.address}</div>
                    </dl>
                  </div>
                </div>
                {g.otherChildren.length > 0 && (
                  <div className="mt-4 rounded-xl bg-alabaster p-3 text-sm">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Also guardian of</p>
                    {g.otherChildren.map((c) => (
                      <p key={c.id} className="mt-1">
                        {isAdmin ? <Link href={`/admin/students/${c.id}`} className="font-medium text-lagoon hover:underline">{c.name}</Link> : <span className="font-medium text-ink">{c.name}</span>}
                        <span className="text-ink-muted"> · Class {c.classLabel}</span>
                      </p>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value, tone, boxed }: { label: string; value: string; tone?: "warn"; boxed?: boolean }) {
  return (
    <div className={cn(boxed && "solid-card p-4")}>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={cn("mt-1 text-lg font-semibold", tone === "warn" ? "text-plum" : "text-sapphire")}>{value}</dd>
    </div>
  );
}

function Info({ icon, label, value, className }: { icon: React.ReactElement; label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-soft text-lagoon [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="text-[12px] text-ink-muted">{label}</dt>
        <dd className="break-words text-sm font-medium text-ink">{value}</dd>
      </div>
    </div>
  );
}

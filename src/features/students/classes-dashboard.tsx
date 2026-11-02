"use client";
/**
 * Teacher → My Classes dashboard (shared by the demo and live workspaces).
 *
 * Presentational only: callers map their data into `TeacherClassCard`s. The
 * advisory (class-teacher) section is the hero — it is the one section whose
 * attendance this teacher marks — and subject sections follow as cards with
 * metrics, a status banner and quick actions.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight, BookOpen, CalendarCheck2, CalendarDays, CheckCircle2, ClipboardList, Clock, DoorOpen, Presentation, Star, Users,
} from "lucide-react";
import { Avatar, Card, EmptyState, FilterPills, LinkButton, PageHeader, ProgressRing, SearchInput } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { isRouteShipped } from "@/lib/permissions/routes";

export type TeacherClassCard = {
  sectionId: string;
  /** "10-B" */
  label: string;
  room: string | null;
  /** Subjects this teacher teaches in the section. */
  subjects: string[];
  students: number | null;
  /** A few names for the avatar stack. */
  studentNames: string[];
  /** Average attendance %, null when not available. */
  attendancePct: number | null;
  /** This teacher's active homework in the section, null when not available. */
  activeHomework: number | null;
  isClassTeacher: boolean;
  /** Today's register marked (class-teacher sections only); null when attendance is off. */
  markedToday: boolean | null;
};

type Filter = "all" | "advisory" | "subject";

// Category colour per subject (stable hash → one of a few calm tints).
const SUBJECT_TINTS = [
  "bg-teal-soft text-lagoon ring-teal/25",
  "bg-sapphire/[0.07] text-sapphire ring-sapphire/15",
  "bg-violet-50 text-violet-700 ring-violet-500/20",
  "bg-amber-50 text-amber-800 ring-amber-500/25",
  "bg-blush/50 text-plum ring-purple/25",
  "bg-cyan/10 text-cyan-800 ring-cyan/25",
];
const tintFor = (subject: string) => SUBJECT_TINTS[[...subject].reduce((a, c) => a + c.charCodeAt(0), 0) % SUBJECT_TINTS.length];

export function SubjectPill({ subject }: { subject: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset", tintFor(subject))}><BookOpen className="h-3 w-3" aria-hidden />{subject}</span>;
}

const attendanceHref = (c: TeacherClassCard) => `/teacher/attendance?section=${encodeURIComponent(c.label)}`;
const homeworkHref = "/teacher/homework?action=new";
const detailHref = (c: TeacherClassCard) => `/teacher/classes/${c.sectionId}`;

export function ClassesDashboard({ classes, liveNote }: { classes: TeacherClassCard[]; liveNote?: ReactNode }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const stats = useMemo(() => {
    const students = classes.reduce((a, c) => a + (c.students ?? 0), 0);
    const withAtt = classes.filter((c) => c.attendancePct !== null);
    const avg = withAtt.length ? withAtt.reduce((a, c) => a + (c.attendancePct ?? 0), 0) / withAtt.length : null;
    const toMark = classes.filter((c) => c.isClassTeacher && c.markedToday === false).length;
    const homework = classes.reduce((a, c) => a + (c.activeHomework ?? 0), 0);
    return { students, sections: classes.length, avg, toMark, homework };
  }, [classes]);

  const q = search.trim().toLowerCase();
  const shown = classes.filter((c) =>
    (filter === "all" || (filter === "advisory" ? c.isClassTeacher : !c.isClassTeacher)) &&
    (!q || `class ${c.label}`.toLowerCase().includes(q) || c.subjects.some((s) => s.toLowerCase().includes(q))),
  );
  const advisory = shown.filter((c) => c.isClassTeacher);
  const subject = shown.filter((c) => !c.isClassTeacher);

  return (
    <div className="space-y-5">
      <PageHeader title="My Classes" description="Your advisory section and the subject classes you teach this year — with today's tasks at a glance." />

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Users className="h-5 w-5" />} label="Students taught" value={stats.students} hint="Across all your sections" />
        <Metric icon={<Presentation className="h-5 w-5" />} label="Sections assigned" value={stats.sections} hint={`${classes.filter((c) => c.isClassTeacher).length} advisory · ${classes.filter((c) => !c.isClassTeacher).length} subject`} />
        <Metric
          icon={<CalendarCheck2 className="h-5 w-5" />}
          label="Attendance average"
          value={stats.avg === null ? "—" : `${stats.avg.toFixed(1)}%`}
          hint={stats.avg === null ? "Not available yet" : undefined}
          extra={stats.avg !== null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white ring-1 ring-inset ring-line/70" role="progressbar" aria-valuenow={Math.round(stats.avg)} aria-valuemin={0} aria-valuemax={100} aria-label="Attendance average">
              <div className={cn("h-full rounded-full", stats.avg >= 85 ? "bg-teal" : "bg-amber-500")} style={{ width: `${stats.avg}%` }} />
            </div>
          )}
        />
        <Metric
          icon={<Clock className="h-5 w-5" />}
          label="Pending tasks"
          value={stats.toMark + stats.homework}
          tone={stats.toMark ? "amber" : "default"}
          hint={<>{stats.toMark ? <span className="font-semibold text-amber-700">{stats.toMark} attendance to mark today</span> : "Attendance up to date"} · {stats.homework} active homework</>}
        />
      </div>

      {liveNote}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterPills<Filter> label="Show sections" value={filter} onChange={setFilter} items={[
          { value: "all", label: "All sections", count: classes.length },
          { value: "advisory", label: "My advisory", count: classes.filter((c) => c.isClassTeacher).length },
          { value: "subject", label: "Subject classes", count: classes.filter((c) => !c.isClassTeacher).length },
        ]} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search class or subject" label="Search classes" className="sm:w-72" />
      </div>

      {classes.length === 0 ? (
        <Card><EmptyState icon={<Presentation className="h-6 w-6" />} title="No classes assigned yet" description="The school office assigns your advisory section and subject classes in Academics." /></Card>
      ) : shown.length === 0 ? (
        <Card><EmptyState title="No classes match" description="Try another search or filter." className="py-8" /></Card>
      ) : (
        <>
          {advisory.map((c) => <AdvisoryHero key={c.sectionId} c={c} />)}
          {subject.length > 0 && (
            <section aria-label="Subject classes">
              {advisory.length > 0 && <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Subject classes</h2>}
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {subject.map((c, i) => <li key={c.sectionId} className="stagger" style={{ "--stagger-i": i } as CSSProperties}><ClassCard c={c} /></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value, hint, extra, tone = "default" }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; extra?: ReactNode; tone?: "default" | "amber" }) {
  return (
    <div className="spatial rounded-2xl border border-line bg-white p-4 transition-transform duration-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
          <p className="figures mt-1 text-2xl font-bold text-sapphire">{value}</p>
        </div>
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset", tone === "amber" ? "bg-amber-50 text-amber-700 ring-amber-500/25" : "bg-teal-soft text-lagoon ring-teal/20")}>{icon}</span>
      </div>
      {extra}
      {hint && <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p>}
    </div>
  );
}

function AvatarStack({ names, total }: { names: string[]; total: number | null }) {
  const extra = total !== null ? Math.max(0, total - names.length) : 0;
  return (
    <span className="flex items-center" aria-hidden>
      {names.slice(0, 4).map((n, i) => <Avatar key={`${n}-${i}`} name={n} size="xs" className={cn("ring-2 ring-white", i > 0 && "-ml-1.5")} />)}
      {extra > 0 && <span className="figures -ml-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-heather/40 px-1 text-[10px] font-bold text-ink-soft ring-2 ring-white">+{extra}</span>}
    </span>
  );
}

function RoomBadge({ room }: { room: string | null }) {
  if (!room) return null;
  return <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] font-medium text-ink-soft ring-1 ring-inset ring-line/70"><DoorOpen className="h-3 w-3" aria-hidden />{room}</span>;
}

function MetricTiles({ c }: { c: TeacherClassCard }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      <div className="rounded-xl bg-white p-2.5 ring-1 ring-inset ring-line/60">
        <dt className="flex items-center gap-1 text-[11px] font-medium text-ink-muted"><Users className="h-3 w-3" aria-hidden /> Students</dt>
        <dd className="mt-1 flex flex-col items-start gap-1"><span className="figures text-lg font-bold leading-none text-ink">{c.students ?? "—"}</span><AvatarStack names={c.studentNames.slice(0, 3)} total={c.students} /></dd>
      </div>
      <div className="rounded-xl bg-white p-2.5 ring-1 ring-inset ring-line/60">
        <dt className="flex items-center gap-1 text-[11px] font-medium text-ink-muted"><CalendarCheck2 className="h-3 w-3" aria-hidden /> Attendance</dt>
        <dd className="mt-1 flex items-center gap-2">
          {c.attendancePct === null ? <span className="text-[12px] text-ink-muted">Not available</span> : (
            <><ProgressRing value={c.attendancePct} size={30} stroke={4} label=" " tone={c.attendancePct >= 85 ? "teal" : "plum"} /><span className="figures font-mono text-sm font-bold text-ink">{Math.round(c.attendancePct)}%</span></>
          )}
        </dd>
      </div>
      <div className="rounded-xl bg-white p-2.5 ring-1 ring-inset ring-line/60">
        <dt className="flex items-center gap-1 text-[11px] font-medium text-ink-muted"><ClipboardList className="h-3 w-3" aria-hidden /> Homework</dt>
        <dd className="mt-1">
          {c.activeHomework === null ? <span className="text-[12px] text-ink-muted">—</span> : (
            <span className={cn("figures inline-flex rounded-full px-2 py-0.5 text-[12px] font-bold ring-1 ring-inset", c.activeHomework ? "bg-violet-50 text-violet-700 ring-violet-500/20" : "bg-heather/25 text-ink-soft ring-line/70")}>{c.activeHomework} active</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function StatusBanner({ c }: { c: TeacherClassCard }) {
  if (!c.isClassTeacher) {
    return <p className="flex items-center gap-2 rounded-xl bg-heather/15 px-3 py-2 text-[12.5px] text-ink-muted ring-1 ring-inset ring-line/60"><Users className="h-3.5 w-3.5 shrink-0" aria-hidden /> Subject teacher · attendance is handled by the advisory teacher</p>;
  }
  if (c.markedToday === null) return null;
  return c.markedToday
    ? <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20"><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Today&apos;s attendance is marked</p>
    : (
      <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/30">
        <span className="relative grid h-2 w-2 place-items-center" aria-hidden><span className="absolute h-2 w-2 animate-ping rounded-full bg-amber-500 opacity-60 motion-reduce:hidden" /><span className="h-2 w-2 rounded-full bg-amber-500" /></span>
        Attendance pending today
      </p>
    );
}

/** The advisory (class-teacher) section: wide hero with the urgent register action. */
function AdvisoryHero({ c }: { c: TeacherClassCard }) {
  const pending = c.markedToday === false;
  return (
    <section aria-label={`Advisory section ${c.label}`} className="gradient-border spatial relative overflow-hidden rounded-3xl p-5 sm:p-6">
      <div className="relative grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-sapphire px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wide text-white"><Star className="h-3 w-3" aria-hidden /> My advisory · Class teacher</span>
            <RoomBadge room={c.room} />
            {c.subjects.map((s) => <SubjectPill key={s} subject={s} />)}
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-sapphire">Class {c.label}</h2>
            <p className="text-[13px] text-ink-muted">You mark and correct this section&apos;s daily register and are the first contact for its parents.</p>
          </div>
          <MetricTiles c={c} />
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-2xl bg-bg p-4 ring-1 ring-inset ring-line">
          <StatusBanner c={c} />
          {isRouteShipped(attendanceHref(c)) && <LinkButton href={attendanceHref(c)} size="lg" className={cn("w-full justify-center", pending ? "bg-sapphire hover:bg-sapphire/90" : "")} variant={pending ? "primary" : "outline"}>
            <CalendarCheck2 className="h-4 w-4" /> {pending ? "Mark attendance now" : "Edit today's attendance"}
          </LinkButton>}
          <div className="grid grid-cols-3 gap-2">
            <QuickLink href={homeworkHref} icon={<ClipboardList className="h-4 w-4" />} label="Homework" />
            <QuickLink href={`${detailHref(c)}#roster`} icon={<Users className="h-4 w-4" />} label="Roster" />
            <QuickLink href="/teacher/timetable" icon={<CalendarDays className="h-4 w-4" />} label="Timetable" />
          </div>
          <Link href={detailHref(c)} className="inline-flex items-center justify-center gap-1 text-[13px] font-semibold text-lagoon hover:underline">Enter class details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </div>
      </div>
    </section>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  if (!isRouteShipped(href)) return null; // the module is not part of this build
  return (
    <Link href={href} className="flex flex-col items-center gap-1 rounded-xl bg-white px-2 py-2 text-[12px] font-semibold text-ink-soft ring-1 ring-inset ring-line/70 transition-all hover:bg-white hover:text-lagoon active:scale-95 focus-visible:outline-none focus-visible:shadow-focus">
      <span className="text-lagoon">{icon}</span>{label}
    </Link>
  );
}

function ClassCard({ c }: { c: TeacherClassCard }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-sm transition-all duration-200 ease-out hover:shadow-ambient-lg">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xl font-bold tracking-tight text-sapphire">Class {c.label}</h3>
        <RoomBadge room={c.room} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">{c.subjects.length ? c.subjects.map((s) => <SubjectPill key={s} subject={s} />) : <span className="text-[12px] text-ink-muted">No subject assigned</span>}</div>
      <div className="mt-3.5"><MetricTiles c={c} /></div>
      <div className="mt-3"><StatusBanner c={c} /></div>
      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line/60 pt-3">
        {isRouteShipped(attendanceHref(c)) && <LinkButton href={attendanceHref(c)} size="sm" variant="outline" className="justify-center"><CalendarCheck2 className="h-3.5 w-3.5" /> View attendance</LinkButton>}
        {isRouteShipped(homeworkHref) && <LinkButton href={homeworkHref} size="sm" variant="outline" className="justify-center"><ClipboardList className="h-3.5 w-3.5" /> Assign homework</LinkButton>}
        <LinkButton href={`${detailHref(c)}#roster`} size="sm" variant="ghost" className="justify-center"><Users className="h-3.5 w-3.5" /> Roster</LinkButton>
        <LinkButton href={detailHref(c)} size="sm" variant="ghost" className="justify-center">Class details <ArrowUpRight className="h-3.5 w-3.5" /></LinkButton>
      </div>
    </article>
  );
}


"use client";
/**
 * Student management backed by the school's Convex records: the students list
 * (roster order, server-side pagination and search) with the school's student
 * totals, and the profile edit form (academics.updateStudentProfile; a name
 * change renumbers the student's section on the server).
 *
 * The list is used for EVERY admin session, including the demo school's
 * persona accounts: "Admit student" always writes to Convex
 * (academics.createStudentWithEnrollment), so the list and its totals must read
 * the same records — Accounts & Import and Attendance already do. Totals come
 * from academics.studentCounts (one shared counting rule, also used by the
 * admin dashboard), independent of pagination and search, and are reactive: a
 * new admission shows up in the list and the totals without a page refresh.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, UserPlus, Users } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolPaginatedQuery, useSchoolQuery } from "@/lib/convex/membership";
import { Avatar, Button, Card, EmptyState, FormField, Input, LinkButton, LoadingState, PageHeader, SearchInput, Select, StatCard, Textarea, useToast } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";

export function LiveStudentsList() {
  const { can } = useSession();
  const canWrite = can("students:write");
  const sections = useSchoolQuery(api.academics.listSections, {});
  const [sectionId, setSectionId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const list = useSchoolPaginatedQuery(
    api.accounts.listPeople,
    { kind: "student", ...(sectionId ? { sectionId: sectionId as Id<"sections"> } : {}), ...(debounced ? { search: debounced } : {}) },
    { initialNumItems: 50 },
  );
  const counts = useSchoolQuery(api.academics.studentCounts, sectionId ? { sectionId: sectionId as Id<"sections"> } : {});
  return (
    <div>
      <PageHeader title="Students" description="Active students in roll-number order (first name, then last name)." actions={canWrite ? <LinkButton href="/admin/students/new"><UserPlus className="h-4 w-4" /> Admit student</LinkButton> : undefined} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3" data-testid="student-totals">
        <StatCard label={counts ? `Enrolled in ${counts.academicYear.name}` : "Enrolled this year"} value={<span data-testid="students-enrolled">{counts?.enrolled ?? "—"}</span>} icon={<GraduationCap className="h-5 w-5" />} hint="Distinct students with an active class enrollment" />
        <StatCard label="Active student records" value={<span data-testid="students-active-records">{counts?.activeRecords ?? "—"}</span>} icon={<Users className="h-5 w-5" />} tone="sapphire" hint={counts ? `${counts.notEnrolled} not yet enrolled in a class` : undefined} />
        {counts?.section && <StatCard label={`Enrolled in ${counts.section.label}`} value={<span data-testid="students-section">{counts.section.enrolled}</span>} icon={<GraduationCap className="h-5 w-5" />} tone="lavender" />}
      </div>
      <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row">
        <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="w-56">
          <option value="">All sections</option>
          {(sections ?? []).map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or admission no." label="Filter students by name or admission no." className="sm:w-72" />
      </Card>
      <Card>
        {list.status === "LoadingFirstPage" ? <LoadingState variant="table" /> : list.results.length === 0 ? (
          <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No students" description={debounced ? "No students match this search." : sectionId ? "No active students in this section." : "Admit students or import them in Accounts & Import."} />
        ) : (
          <ul className="divide-y divide-line/60" data-testid="live-students">
            {list.results.map((p) => (
              <li key={p.personId} className="flex items-center gap-3 px-5 py-3">
                {sectionId && <span className="w-8 text-center text-sm font-bold text-sapphire">{p.rollNo ?? "—"}</span>}
                <Avatar name={p.name} size="sm" />
                <Link href={`/admin/students/${p.personId}`} className="min-w-0 flex-1 hover:text-lagoon">
                  <span className="block font-semibold text-ink">{p.name}</span>
                  <span className="block text-[12px] text-ink-muted">{p.number} · {p.detail}</span>
                </Link>
                {canWrite && <Link href={`/admin/students/${p.personId}/edit`} className="text-[13px] font-medium text-lagoon hover:underline">Edit</Link>}
              </li>
            ))}
          </ul>
        )}
        {list.status === "CanLoadMore" && <div className="border-t border-line/60 p-3 text-center"><Button variant="outline" size="sm" onClick={() => list.loadMore(50)}>Load more</Button></div>}
      </Card>
    </div>
  );
}

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function LiveStudentEdit({ studentId }: { studentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const profile = useSchoolQuery(api.academics.getStudentProfile, { studentId });
  const update = useSchoolMutation(api.academics.updateStudentProfile);
  const [form, setForm] = useState<null | { firstName: string; lastName: string; gender: string; dateOfBirth: string; email: string; phone: string; address: string; bloodGroup: string }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (profile && !form) {
      const s = profile.student;
      setForm({ firstName: s.firstName, lastName: s.lastName, gender: s.gender ?? "", dateOfBirth: s.dateOfBirth ?? "", email: s.email ?? "", phone: s.phone ?? "", address: s.address ?? "", bloodGroup: s.bloodGroup ?? "" });
    }
  }, [profile, form]);
  if (profile === undefined || (profile && !form)) return <LoadingState label="Loading student" />;
  if (profile === null || !form) return <Card><EmptyState title="Student not found" /></Card>;
  const s = profile.student;
  const save = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return setError("First and last name are required.");
    setBusy(true);
    setError(null);
    try {
      // Only changed fields are sent; the server validates every one (dates in the past, phone format, blood group).
      const was = { firstName: s.firstName, lastName: s.lastName, gender: s.gender ?? "", dateOfBirth: s.dateOfBirth ?? "", email: s.email ?? "", phone: s.phone ?? "", address: s.address ?? "", bloodGroup: s.bloodGroup ?? "" };
      const changed = (k: keyof typeof was) => form[k].trim() !== was[k];
      const args = {
        studentId: s.studentId,
        ...(changed("firstName") ? { firstName: form.firstName.trim() } : {}),
        ...(changed("lastName") ? { lastName: form.lastName.trim() } : {}),
        ...(changed("gender") && form.gender ? { gender: form.gender as "male" | "female" | "other" } : {}),
        ...(changed("dateOfBirth") ? { dateOfBirth: form.dateOfBirth } : {}),
        ...(changed("email") ? { email: form.email.trim() } : {}),
        ...(changed("phone") ? { phone: form.phone.trim() } : {}),
        ...(changed("address") ? { address: form.address.trim() } : {}),
        ...(changed("bloodGroup") ? { bloodGroup: form.bloodGroup } : {}),
      };
      if (Object.keys(args).length === 1) return router.push(`/admin/students/${s.studentId}`);
      const r = await update(args);
      toast({ title: "Student updated", description: r.renumberedSections ? "Roll numbers were updated for the new name." : undefined });
      router.push(`/admin/students/${s.studentId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${s.firstName} ${s.lastName}`} description={`Admission no. ${s.admissionNo}. Class, admission number and status are changed through enrollment and accounts, not here.`} />
      <Card className="space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="First name" required><Input value={form.firstName} onChange={set("firstName")} /></FormField>
          <FormField label="Last name" required><Input value={form.lastName} onChange={set("lastName")} /></FormField>
          <FormField label="Gender"><Select value={form.gender} onChange={set("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></FormField>
          <FormField label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></FormField>
          <FormField label="Email"><Input type="email" value={form.email} onChange={set("email")} /></FormField>
          <FormField label="Phone"><Input value={form.phone} onChange={set("phone")} /></FormField>
          <FormField label="Blood group"><Select value={form.bloodGroup} onChange={set("bloodGroup")}>{BLOOD.map((b) => <option key={b} value={b}>{b || "—"}</option>)}</Select></FormField>
        </div>
        <FormField label="Address"><Textarea rows={2} value={form.address} onChange={set("address")} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line/70 pt-4">
          <Button variant="outline" onClick={() => router.push(`/admin/students/${s.studentId}`)}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save changes</Button>
        </div>
      </Card>
    </div>
  );
}

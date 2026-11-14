"use client";
/**
 * Student management backed by the school's Convex records: the students list
 * (roster order, server-side pagination and search) with the school's student
 * totals, and the profile edit form (academics.updateStudentProfile; a name
 * change renumbers the student's section on the server).
 *
 * BUG-002: Load more pagination remains reachable even when filtered list yields empty current slice.
 * BUG-006: Gender field clearing supported cleanly.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, LayoutGrid, Pencil, Rows3, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { buttonClass } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolPaginatedQuery, useSchoolQuery } from "@/lib/convex/membership";
import { Avatar, Button, Card, EmptyState, FormField, Input, LinkButton, LoadingState, PageHeader, SearchInput, Select, StatCard, Tabs, TabsContent, TabsList, Textarea, useToast } from "@/components/ui";
import { useSession } from "@/features/auth/session-provider";
import { errorMessage } from "@/lib/convex/errors";
import { AdmissionRegisterPanel } from "./admission-register";

export function LiveStudentsList() {
  const reduceMotion = useReducedMotion();
  const { can } = useSession();
  const canWrite = can("students:write");
  const sections = useSchoolQuery(api.academics.listSections, {});
  const [sectionId, setSectionId] = useState("");
  const [search, setSearch] = useState("");
  // Card grid by default; the dense list is one click away (remembered on this device).
  const [view, setViewState] = useState<"grid" | "list">("grid");
  useEffect(() => { try { const v = window.localStorage.getItem("ssms-students-view"); if (v === "list" || v === "grid") setViewState(v); } catch { /* ignore */ } }, []);
  const setView = (v: "grid" | "list") => { setViewState(v); try { window.localStorage.setItem("ssms-students-view", v); } catch { /* ignore */ } };
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const list = useSchoolPaginatedQuery(
    api.accounts.listPeople,
    { kind: "student", ...(sectionId ? { sectionId: sectionId as Id<"sections"> } : {}), ...(debounced ? { search: debounced } : {}) },
    { initialNumItems: 50 },
  );
  const counts = useSchoolQuery(api.students.studentCounts, sectionId ? { sectionId: sectionId as Id<"sections"> } : {});

  return (
    <div>
      <PageHeader title="Students" actions={canWrite ? <LinkButton href="/admin/students/new"><UserPlus className="h-4 w-4" /> Admit student</LinkButton> : undefined} />
      <Tabs defaultValue="roster">
        <TabsList
          items={[
            { value: "roster", label: "Active roster" },
            { value: "register", label: "Admission register (CSR)" },
          ]}
        />
        <TabsContent value="roster">
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]" data-testid="student-totals">
            <StatCard label={counts ? `Enrolled in ${counts.academicYear.name}` : "Enrolled this year"} value={<span data-testid="students-enrolled">{counts?.enrolled ?? "—"}</span>} accent="students" icon={<GraduationCap className="h-5 w-5" />} hint="With an active class" />
            <StatCard label="Active student records" value={<span data-testid="students-active-records">{counts?.activeRecords ?? "—"}</span>} accent="classes" icon={<Users className="h-5 w-5" />} tone="sapphire" hint={counts ? `${counts.notEnrolled} not in a class yet` : undefined} />
            {counts?.section && <StatCard label={`Enrolled in ${counts.section.label}`} value={<span data-testid="students-section">{counts.section.enrolled}</span>} icon={<GraduationCap className="h-5 w-5" />} tone="lavender" />}
          </div>
          <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name or scholar no." label="Filter students by name or scholar no." className="sm:w-80" />
            <Select aria-label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="sm:w-52">
              <option value="">All sections</option>
              {(sections ?? []).map((s) => <option key={s._id} value={s._id}>{s.displayName}</option>)}
            </Select>
            <div role="radiogroup" aria-label="Layout" className="flex shrink-0 gap-0.5 rounded-[11px] bg-ink/[0.05] p-0.5 sm:ml-auto">
              {(["grid", "list"] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)} aria-label={v === "grid" ? "Cards" : "List"} className={cn("grid h-8 w-9 place-items-center rounded-[9px] text-ink-muted transition-[background-color,color] duration-150", view === v && "bg-surface text-ink shadow-card")}>
                  {v === "grid" ? <LayoutGrid className="h-4 w-4" aria-hidden /> : <Rows3 className="h-4 w-4" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          <div>
            {list.status === "LoadingFirstPage" ? (
              <Card><LoadingState variant="table" /></Card>
            ) : list.results.length === 0 ? (
              <Card><EmptyState
                icon={<GraduationCap className="h-6 w-6" />}
                title="No students"
                description={debounced ? "No students match this search on current page." : sectionId ? "No active students in this section." : "Admit students or import them in Accounts & Import."}
              /></Card>
            ) : view === "grid" ? (
              <motion.ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-testid="live-students" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: reduceMotion ? 0 : 0.025 } } }}>
                {list.results.map((p) => (
                  <motion.li key={p.personId} variants={{ hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 420, damping: 32 } } }} className="group lift relative flex flex-col rounded-[20px] bg-surface p-4 shadow-card">
                    <div className="flex items-start gap-3">
                      <Avatar name={p.name} size="lg" className="transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-105" />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <Link href={`/admin/students/${p.personId}`} className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink after:absolute after:inset-0 after:rounded-[20px] focus-visible:outline-none">{p.name}</Link>
                        <p className={cn("mono-id mt-0.5 truncate", /^no /i.test(p.number) ? "text-ink-faint" : "text-ink-muted")}>{p.number}</p>
                      </div>
                      {sectionId && <span className="figures rounded-lg bg-bg px-2 py-1 text-[12px] font-semibold text-ink-soft" title="Roll number">#{p.rollNo ?? "—"}</span>}
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium", classTone(p.detail))}>{p.detail}</span>
                      {canWrite && (
                        <Link href={`/admin/students/${p.personId}/edit`} className="relative z-10 grid h-8 w-8 place-items-center rounded-lg text-ink-muted opacity-0 transition-[opacity,background-color] duration-150 hover:bg-bg hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100" aria-label={`Edit ${p.name}`}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </motion.li>
                ))}
              </motion.ul>
            ) : (
              <Card className="p-2"><motion.ul className="space-y-0.5" data-testid="live-students" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: reduceMotion ? 0 : 0.02 } } }}>
                {list.results.map((p) => (
                  <motion.li
                    key={p.personId}
                    variants={{ hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 32 } } }}
                    className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors duration-150 hover:bg-bg/80"
                  >
                    {sectionId && <span className="figures w-9 text-center text-[12px] font-semibold text-ink-muted" title="Roll number">{p.rollNo ?? "—"}</span>}
                    <Avatar name={p.name} size="sm" />
                    <Link href={`/admin/students/${p.personId}`} className="min-w-0 flex-1 truncate rounded-lg font-medium text-ink focus-visible:outline-none focus-visible:shadow-focus">{p.name}</Link>
                    <span className="mono-id hidden w-40 truncate text-ink-muted sm:block">{p.number}</span>
                    <span className={cn("hidden rounded-full px-2.5 py-0.5 text-[12px] font-medium md:inline-block", classTone(p.detail))}>{p.detail}</span>
                    {canWrite && (
                      <Link href={`/admin/students/${p.personId}/edit`} className={buttonClass("ghost", "icon-sm", "opacity-60 group-hover:opacity-100")} aria-label={`Edit ${p.name}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    )}
                  </motion.li>
                ))}
              </motion.ul></Card>
            )}

            {/* BUG-002 Fix: Load more button sits outside the results empty-check */}
            {list.status === "CanLoadMore" && (
              <div className="mt-2 border-t border-line/60 pt-3 text-center">
                <Button variant="outline" size="sm" onClick={() => list.loadMore(50)}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="register">
          <AdmissionRegisterPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function LiveStudentEdit({ studentId }: { studentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const profile = useSchoolQuery(api.students.getStudentProfile, { studentId });
  const update = useSchoolMutation(api.students.updateStudentProfile);
  const [form, setForm] = useState<null | { firstName: string; lastName: string; gender: string; dateOfBirth: string; email: string; phone: string; address: string; bloodGroup: string; scholarNo: string }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !form) {
      const s = profile.student;
      setForm({
        firstName: s.firstName,
        lastName: s.lastName,
        gender: s.gender ?? "",
        dateOfBirth: s.dateOfBirth ?? "",
        email: s.email ?? "",
        phone: s.phone ?? "",
        address: s.address ?? "",
        bloodGroup: s.bloodGroup ?? "",
        scholarNo: s.scholarNo ?? "",
      });
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
      const was = {
        firstName: s.firstName,
        lastName: s.lastName,
        gender: s.gender ?? "",
        dateOfBirth: s.dateOfBirth ?? "",
        email: s.email ?? "",
        phone: s.phone ?? "",
        address: s.address ?? "",
        bloodGroup: s.bloodGroup ?? "",
        scholarNo: s.scholarNo ?? "",
      };
      const changed = (k: keyof typeof was) => form[k].trim() !== was[k];

      const args = {
        studentId: s.studentId,
        ...(changed("firstName") ? { firstName: form.firstName.trim() } : {}),
        ...(changed("lastName") ? { lastName: form.lastName.trim() } : {}),
        // BUG-006 Fix: allow clearing gender cleanly by passing empty string / target value
        ...(changed("gender") ? { gender: (form.gender ? form.gender : "") as any } : {}),
        ...(changed("dateOfBirth") ? { dateOfBirth: form.dateOfBirth } : {}),
        ...(changed("email") ? { email: form.email.trim() } : {}),
        ...(changed("phone") ? { phone: form.phone.trim() } : {}),
        ...(changed("address") ? { address: form.address.trim() } : {}),
        ...(changed("bloodGroup") ? { bloodGroup: form.bloodGroup } : {}),
        ...(changed("scholarNo") ? { scholarNo: form.scholarNo.trim() } : {}),
      };

      if (Object.keys(args).length === 1) return router.push(`/admin/students/${s.studentId}`);
      const r = await update(args);
      toast({ title: "Student updated", description: r.renumberedSections ? "Roll numbers were updated for the new name." : undefined });
      router.push(`/admin/students/${s.studentId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${s.firstName} ${s.lastName}`} description={`${s.scholarNo ? `Scholar No: ${s.scholarNo}. ` : ""}Class and status are changed through enrollment and accounts, not here.`} />
      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="First name" required><Input value={form.firstName} onChange={set("firstName")} /></FormField>
          <FormField label="Last name" required><Input value={form.lastName} onChange={set("lastName")} /></FormField>
          <FormField label="Gender"><Select value={form.gender} onChange={set("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></FormField>
          <FormField label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} /></FormField>
          <FormField label="Email"><Input type="email" value={form.email} onChange={set("email")} /></FormField>
          <FormField label="Phone"><Input value={form.phone} onChange={set("phone")} /></FormField>
          <FormField label="Blood group"><Select value={form.bloodGroup} onChange={set("bloodGroup")}>{BLOOD.map((b) => <option key={b} value={b}>{b || "—"}</option>)}</Select></FormField>
          <FormField label="Scholar number" hint="The school's register number and the student's sign-in Login ID. Must be unique; changing it changes how the student signs in."><Input value={form.scholarNo} onChange={set("scholarNo")} maxLength={30} /></FormField>
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
/** A colour per grade for class chips ("Class 10-B" → green), so classes are recognisable at a glance. */
function classTone(detail: string): string {
  const g = Number(detail.match(/(\d{1,2})/)?.[1] ?? NaN);
  const tones: Record<number, string> = {
    6: "bg-[#FCE6F1] text-[#BE185D]", 7: "bg-[#FFEBD9] text-[#C2410C]", 8: "bg-[#EEE9FF] text-[#6D4AE0]", 9: "bg-[#DFF1FD] text-[#0369A1]",
    10: "bg-[#E1F5E7] text-[#15803D]", 11: "bg-[#FFF0D3] text-[#B26A00]", 12: "bg-[#E7E8FF] text-[#4338CA]",
  };
  return tones[g] ?? "bg-bg text-ink-soft";
}

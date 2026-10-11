"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock, Save } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Badge, Button, Card, Checkbox, EmptyState, Input, LinkButton, PageHeader, QueryView, useToast, Avatar } from "@/components/ui";
import { gradeFor, percentOf } from "@/lib/utils/grades";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Row = { marks: string; absent: boolean };

/** Marks entry for one paper × section. Admin: any. Teacher: only assigned subject/section (service-enforced). */
export function MarksEntry({ area }: { area: "admin" | "teacher" }) {
  const params = useSearchParams();
  const paperId = params.get("paper") ?? "";
  const sectionId = params.get("section") ?? "";
  const { toast } = useToast();
  const q = useQuery(() => services.exams.getMarksSheet(paperId, sectionId), [paperId, sectionId], { enabled: !!paperId && !!sectionId });
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data) setRows(Object.fromEntries(q.data.students.map((s) => [s.id, { marks: s.marks === null ? "" : String(s.marks), absent: s.absent }])));
  }, [q.data]);

  const stats = useMemo(() => {
    const max = q.data?.paper.maxMarks ?? 100;
    const vals = Object.values(rows).filter((r) => !r.absent && r.marks !== "").map((r) => Number(r.marks)).filter((n) => !Number.isNaN(n));
    return { entered: Object.values(rows).filter((r) => r.absent || r.marks !== "").length, avg: vals.length ? percentOf(vals.reduce((a, b) => a + b, 0) / vals.length, max) : null };
  }, [rows, q.data]);

  if (!paperId || !sectionId) return <Card><EmptyState title="Choose a paper" description="Open marks entry from an examination's date sheet." action={<LinkButton href={`/${area}/examinations`}>Go to examinations</LinkButton>} /></Card>;

  return (
    <QueryView query={q}>
      {(d) => {
        const max = d.paper.maxMarks;
        const validate = () => {
          const e: Record<string, string> = {};
          for (const [id, r] of Object.entries(rows)) {
            if (r.absent || r.marks === "") continue;
            const n = Number(r.marks);
            if (Number.isNaN(n) || n < 0 || n > max) e[id] = `0–${max}`;
            else if (Math.round(n * 2) !== n * 2) e[id] = "Use .5 steps";
          }
          setErrors(e);
          return Object.keys(e).length === 0;
        };
        const save = async () => {
          if (!validate()) { toast({ title: "Check highlighted marks", description: `Marks must be between 0 and ${max}.`, tone: "error" }); return; }
          setSaving(true);
          try {
            const payload = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, { marks: r.marks === "" ? null : Number(r.marks), absent: r.absent }]));
            const res = await services.exams.saveMarks(paperId, sectionId, payload);
            toast({ title: "Marks saved", description: res.complete ? "All students entered — grades are calculated automatically." : `${res.entered}/${res.total} students entered.` });
          } catch (e) {
            toast({ title: "Could not save marks", description: (e as Error).message, tone: "error" });
          }
          setSaving(false);
        };
        return (
          <div>
            <PageHeader
              eyebrow={`${d.exam.name} · ${formatDate(d.paper.date)}`}
              title={`${d.paper.subject} · Class ${d.sectionLabel}`}
              description={`Maximum ${max} marks · pass mark ${d.paper.passMarks}. Grades are calculated from the percentage.`}
              actions={<LinkButton href={area === "admin" ? `/admin/examinations/${d.exam.id}` : "/teacher/examinations"} variant="outline">Back to exam</LinkButton>}
            />
            {d.locked && (
              <div className="mb-4 flex items-center gap-2 rounded-2xl border border-mauve/40 bg-lavender/15 px-4 py-3 text-sm text-plum"><Lock className="h-4 w-4" /> {d.lockReason}</div>
            )}
            <Card>
              <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-5 py-3.5 text-[13px]">
                <Badge tone="sapphire">{stats.entered}/{d.students.length} entered</Badge>
                <Badge tone="teal">Average {stats.avg === null ? "—" : `${stats.avg.toFixed(1)}%`}</Badge>
              </div>
              <ul className="divide-y divide-line/50 px-5">
                {d.students.map((s) => {
                  const r = rows[s.id] ?? { marks: "", absent: false };
                  const n = Number(r.marks);
                  const valid = !r.absent && r.marks !== "" && !Number.isNaN(n) && n >= 0 && n <= max;
                  const pct = valid ? percentOf(n, max) : null;
                  return (
                    <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-right text-[12px] text-ink-muted">{s.rollNo}</span>
                        <Avatar name={s.name} size="sm" />
                        <div><p className="text-sm font-semibold text-ink">{s.name}</p><p className="font-mono text-[11.5px] text-ink-muted">{s.admissionNo}</p></div>
                      </div>
                      <div className="flex items-center gap-3 pl-9 sm:pl-0">
                        <Checkbox label="Absent" checked={r.absent} disabled={d.locked} onChange={(e) => setRows((x) => ({ ...x, [s.id]: { marks: e.target.checked ? "" : r.marks, absent: e.target.checked } }))} />
                        <div className="w-24">
                          <Input
                            aria-label={`Marks for ${s.name}`}
                            inputMode="decimal"
                            value={r.marks}
                            disabled={d.locked || r.absent}
                            invalid={!!errors[s.id]}
                            placeholder={`/ ${max}`}
                            onChange={(e) => { setRows((x) => ({ ...x, [s.id]: { ...r, marks: e.target.value } })); setErrors((x) => { const c = { ...x }; delete c[s.id]; return c; }); }}
                            className="h-9 text-right"
                          />
                        </div>
                        <span className={cn("w-16 text-right text-[13px] font-semibold", pct === null ? "text-ink-muted" : n < d.paper.passMarks ? "text-plum underline decoration-dotted" : "text-sapphire")}>
                          {errors[s.id] ?? (r.absent ? "AB" : pct === null ? "—" : `${gradeFor(pct).grade} · ${Math.round(pct)}%`)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="sticky bottom-0 flex justify-end rounded-b-2xl border-t border-line/60 bg-white/95 p-4 backdrop-blur">
                <Button onClick={save} loading={saving} disabled={d.locked}><Save className="h-4 w-4" /> Save marks</Button>
              </div>
            </Card>
          </div>
        );
      }}
    </QueryView>
  );
}

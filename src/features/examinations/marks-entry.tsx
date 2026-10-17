"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Lock, Save } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, Input, LinkButton, PageHeader, useToast } from "@/components/ui";
import { gradeFor, percentOf } from "@/lib/utils/grades";
import { cn } from "@/lib/utils/cn";

type Row = { marks: string; absent: boolean };
type Area = "admin" | "teacher";

const LOCK_MESSAGE = "Only authorized subject teacher can enter marks during active marks entry window";

/** Readable message from a Convex error (ConvexError data or a plain Error). */
function errorMessage(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  if (e instanceof Error) return e.message.replace(/^\[CONVEX [^\]]+\]\s*/, "").replace(/^(Uncaught )?(Server Error\s*)?/, "") || "Unexpected error";
  return String(e);
}

/** Parses a marks input. Returns null for blank, NaN for unparseable. */
function parseMarks(value: string): number | null {
  const t = value.trim();
  if (t === "") return null;
  return Number(t);
}

/** Validation message for one row, or null when valid. Mirrors the backend rules. */
function validateRow(r: Row, max: number): string | null {
  if (r.absent) return null;
  const n = parseMarks(r.marks);
  if (n === null) return null; // blank = not entered yet
  if (Number.isNaN(n) || n < 0 || n > max) return `0–${max}`;
  if (Math.round(n * 2) !== n * 2) return "Use .5 steps";
  return null;
}

/**
 * Marks entry for one paper × section.
 * The server decides who may enter marks (`canEnter`); this page only reflects it.
 */
export function MarksEntry({ area }: { area: Area }) {
  const params = useSearchParams();
  const paperId = params.get("paper") ?? "";
  const sectionId = params.get("section") ?? "";

  if (!paperId || !sectionId) {
    return (
      <Card>
        <EmptyState
          title="Choose a paper"
          description="Open marks entry from an examination's date sheet."
          action={<LinkButton href={`/${area}/examinations`}>Go to examinations</LinkButton>}
        />
      </Card>
    );
  }

  // Convex useQuery throws server errors during render; the boundary turns them into a clean state.
  return (
    <MarksErrorBoundary key={`${paperId}:${sectionId}`} area={area}>
      <MarksSheet area={area} paperId={paperId} sectionId={sectionId} />
    </MarksErrorBoundary>
  );
}

function MarksSheet({ area, paperId, sectionId }: { area: Area; paperId: string; sectionId: string }) {
  const { toast } = useToast();
  const sheet = useQuery(api.exams.marksSheet, {
    examSubjectId: paperId as Id<"examSubjects">,
    sectionId: sectionId as Id<"sections">,
  });
  const enterMarks = useMutation(api.exams.enterMarks);

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Seed the form once per paper × section. Convex re-sends the sheet whenever
  // the data changes (including after our own save); re-seeding then would wipe
  // edits in progress, so later updates only add rows for newly listed students.
  const seededKey = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet) return;
    const key = `${paperId}:${sectionId}`;
    const fromServer = (s: (typeof sheet.students)[number]): Row => ({
      marks: s.isAbsent || s.marks === null || s.marks === undefined ? "" : String(s.marks),
      absent: !!s.isAbsent,
    });
    if (seededKey.current !== key) {
      seededKey.current = key;
      setRows(Object.fromEntries(sheet.students.map((s) => [s.studentId, fromServer(s)])));
      setErrors({});
      return;
    }
    setRows((current) => {
      const missing = sheet.students.filter((s) => !(s.studentId in current));
      if (missing.length === 0) return current;
      return { ...current, ...Object.fromEntries(missing.map((s) => [s.studentId, fromServer(s)])) };
    });
  }, [sheet, paperId, sectionId]);

  const max = sheet?.paper.maxMarks ?? 100;

  const stats = useMemo(() => {
    const list = Object.values(rows);
    const vals = list
      .filter((r) => !r.absent)
      .map((r) => parseMarks(r.marks))
      .filter((n): n is number => n !== null && !Number.isNaN(n) && n >= 0 && n <= max);
    return {
      entered: list.filter((r) => r.absent || r.marks.trim() !== "").length,
      avg: vals.length ? percentOf(vals.reduce((a, b) => a + b, 0) / vals.length, max) : null,
    };
  }, [rows, max]);

  if (sheet === undefined) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ink-muted" aria-label="Loading marks sheet" />
      </div>
    );
  }

  if (sheet === null) {
    return (
      <Card>
        <EmptyState
          title="Marks sheet not found"
          description="This paper or section no longer exists, or you don't have access to it."
          action={<LinkButton href={`/${area}/examinations`}>Go to examinations</LinkButton>}
        />
      </Card>
    );
  }

  const { exam, paper, section, canEnter, students } = sheet;
  const locked = !canEnter;
  const backHref = area === "admin" ? `/admin/examinations/${exam.examId}` : "/teacher/examinations";

  const validate = () => {
    const e: Record<string, string> = {};
    for (const [id, r] of Object.entries(rows)) {
      const msg = validateRow(r, max);
      if (msg) e[id] = msg;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (locked) return;
    if (!validate()) {
      toast({ title: "Check highlighted marks", description: `Marks must be between 0 and ${max}, in steps of 0.5.`, tone: "error" });
      return;
    }

    // Absent → no marks. Present with marks → marks. Blank rows are not sent (not entered yet).
    const entries: { studentId: Id<"students">; marks?: number; isAbsent: boolean }[] = [];
    for (const s of students) {
      const r = rows[s.studentId];
      if (!r) continue;
      if (r.absent) {
        entries.push({ studentId: s.studentId as Id<"students">, isAbsent: true });
        continue;
      }
      const n = parseMarks(r.marks);
      if (n === null) continue;
      entries.push({ studentId: s.studentId as Id<"students">, marks: n, isAbsent: false });
    }

    if (entries.length === 0) {
      toast({ title: "Nothing to save", description: "Enter marks or mark students absent first.", tone: "error" });
      return;
    }

    setSaving(true);
    try {
      await enterMarks({
        examSubjectId: paperId as Id<"examSubjects">,
        sectionId: sectionId as Id<"sections">,
        entries,
      });
      const complete = entries.length === students.length;
      toast({
        title: "Marks saved",
        description: complete
          ? "All students entered — grades are calculated automatically."
          : `${entries.length}/${students.length} students entered.`,
      });
    } catch (e) {
      toast({ title: "Could not save marks", description: errorMessage(e), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={exam.term ? `${exam.name} · ${exam.term}` : exam.name}
        title={`${paper.subject} · Class ${section.displayName}`}
        description={`Maximum ${max} marks · pass mark ${paper.passMarks}. Grades are calculated from the percentage.`}
        actions={<LinkButton href={backHref} variant="outline">Back to exam</LinkButton>}
      />

      {locked && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2 rounded-2xl border border-mauve/40 bg-lavender/15 px-4 py-3 text-sm text-plum"
        >
          <Lock className="h-4 w-4 shrink-0" /> {LOCK_MESSAGE}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-5 py-3.5 text-[13px]">
          <Badge tone="sapphire">{stats.entered}/{students.length} entered</Badge>
          <Badge tone="teal">Average {stats.avg === null ? "—" : `${stats.avg.toFixed(1)}%`}</Badge>
          {locked && (
            <Badge tone="mauve">
              <Lock className="h-3 w-3" /> Locked
            </Badge>
          )}
        </div>

        {students.length === 0 ? (
          <EmptyState
            title="No students in this section"
            description="Enroll students in this section before entering marks."
          />
        ) : (
          <ul className="divide-y divide-line/50 px-5">
            {students.map((s) => {
              const id = s.studentId;
              const r = rows[id] ?? { marks: "", absent: false };
              const n = parseMarks(r.marks);
              const valid = !r.absent && n !== null && !Number.isNaN(n) && n >= 0 && n <= max;
              const pct = valid ? percentOf(n as number, max) : null;
              return (
                <li key={id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-right text-[12px] text-ink-muted">{s.rollNo ?? "—"}</span>
                    <Avatar name={s.name} size="sm" />
                    <p className="text-sm font-semibold text-ink">{s.name}</p>
                  </div>
                  <div className="flex items-center gap-3 pl-9 sm:pl-0">
                    <Checkbox
                      label="Absent"
                      checked={r.absent}
                      disabled={locked}
                      onChange={(e) => {
                        const absent = e.target.checked;
                        setRows((x) => ({ ...x, [id]: { marks: absent ? "" : (x[id]?.marks ?? ""), absent } }));
                        setErrors((x) => {
                          const c = { ...x };
                          delete c[id];
                          return c;
                        });
                      }}
                    />
                    <div className="w-24">
                      <Input
                        aria-label={`Marks for ${s.name}`}
                        inputMode="decimal"
                        value={r.marks}
                        disabled={locked || r.absent}
                        invalid={!!errors[id]}
                        placeholder={`/ ${max}`}
                        onChange={(e) => {
                          const marks = e.target.value;
                          setRows((x) => ({ ...x, [id]: { absent: x[id]?.absent ?? false, marks } }));
                          setErrors((x) => {
                            const c = { ...x };
                            delete c[id];
                            return c;
                          });
                        }}
                        className="h-9 text-right"
                      />
                    </div>
                    <span
                      className={cn(
                        "w-16 text-right text-[13px] font-semibold",
                        errors[id]
                          ? "text-plum"
                          : pct === null
                            ? "text-ink-muted"
                            : (n as number) < paper.passMarks
                              ? "text-plum underline decoration-dotted"
                              : "text-sapphire"
                      )}
                    >
                      {errors[id] ?? (r.absent ? "AB" : pct === null ? "—" : `${gradeFor(pct).grade} · ${Math.round(pct)}%`)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="sticky bottom-0 flex justify-end rounded-b-2xl border-t border-line/60 bg-white/95 p-4 backdrop-blur">
          <Button onClick={save} loading={saving} disabled={locked || students.length === 0}>
            {locked ? <Lock className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save marks
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Error boundary

class MarksErrorBoundary extends Component<{ area: Area; children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <EmptyState
            title="Could not load marks sheet"
            description={errorMessage(this.state.error)}
            action={<LinkButton href={`/${this.props.area}/examinations`}>Go to examinations</LinkButton>}
          />
        </Card>
      );
    }
    return this.props.children;
  }
}

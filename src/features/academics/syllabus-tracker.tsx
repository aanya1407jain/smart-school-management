"use client";

import { useMemo, useState } from "react";
import { BookOpen, Calendar, CheckCircle2, ChevronRight, Filter } from "lucide-react";
import { Badge, Card, CardHeader, Select } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export interface SyllabusSubject {
  id: string;
  className: string; // e.g. "Class 10-A"
  subject: string;
  teacher: string;
  totalChapters: number;
  completedChapters: number;
  startDate: string; // ISO
  targetDate: string; // ISO
}

const SAMPLE_SUBJECTS: SyllabusSubject[] = [
  {
    id: "1",
    className: "Class 10-A",
    subject: "Mathematics",
    teacher: "Ramesh Sharma",
    totalChapters: 15,
    completedChapters: 9,
    startDate: "2026-04-01",
    targetDate: "2027-02-15",
  },
  {
    id: "2",
    className: "Class 10-A",
    subject: "Science",
    teacher: "Pooja Verma",
    totalChapters: 16,
    completedChapters: 6,
    startDate: "2026-04-01",
    targetDate: "2027-02-15",
  },
  {
    id: "3",
    className: "Class 9-B",
    subject: "English",
    teacher: "Anjali Gupta",
    totalChapters: 12,
    completedChapters: 8,
    startDate: "2026-04-01",
    targetDate: "2027-02-15",
  },
  {
    id: "4",
    className: "Class 9-B",
    subject: "Social Science",
    teacher: "Vikram Malhotra",
    totalChapters: 18,
    completedChapters: 7,
    startDate: "2026-04-01",
    targetDate: "2027-02-15",
  },
  {
    id: "5",
    className: "Class 8-A",
    subject: "Hindi",
    teacher: "Sunita Mishra",
    totalChapters: 14,
    completedChapters: 11,
    startDate: "2026-04-01",
    targetDate: "2027-02-15",
  },
];

export function SyllabusProgressTracker({
  subjects = SAMPLE_SUBJECTS,
  readOnly = true, // Principal / Admin dashboard ke liye default view-only
  onChapterComplete,
}: {
  subjects?: SyllabusSubject[];
  readOnly?: boolean;
  onChapterComplete?: (subjectId: string, newCompleted: number) => void;
}) {
  const [data, setData] = useState<SyllabusSubject[]>(subjects);
  const [selectedClass, setSelectedClass] = useState<string>("all");

  // Classes list nikaalna filter ke liye
  const classList = useMemo(() => {
    return Array.from(new Set(data.map((s) => s.className))).sort();
  }, [data]);

  // Selected class ke hisaab se filter
  const filteredSubjects = useMemo(() => {
    if (selectedClass === "all") return data;
    return data.filter((s) => s.className === selectedClass);
  }, [data, selectedClass]);

  // Overall school / class progress stats
  const overallStats = useMemo(() => {
    const total = filteredSubjects.reduce((acc, s) => acc + s.totalChapters, 0);
    const completed = filteredSubjects.reduce((acc, s) => acc + s.completedChapters, 0);
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pct };
  }, [filteredSubjects]);

  const handleIncrement = (id: string) => {
    if (readOnly) return;
    setData((prev) =>
      prev.map((item) => {
        if (item.id === id && item.completedChapters < item.totalChapters) {
          const updated = item.completedChapters + 1;
          onChapterComplete?.(id, updated);
          return { ...item, completedChapters: updated };
        }
        return item;
      })
    );
  };

  return (
    <Card className="overflow-hidden border border-line/70 shadow-sm">
      <CardHeader
        title="Syllabus Progress & Course Pacing"
        description={
          readOnly
            ? "Principal View (Read Only) · Course coverage and completion pacing overview."
            : "Teacher View · Update chapter progress for your assigned classes."
        }
        action={
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-ink-muted" />
            <Select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="h-8 w-40 text-xs font-medium"
            >
              <option value="all">All Classes</option>
              {classList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {/* Aggregate Overview Graph Bar */}
      <div className="border-b border-line/60 bg-alabaster/40 px-5 py-3.5">
        <div className="flex items-center justify-between text-xs font-semibold text-ink">
          <span>
            {selectedClass === "all" ? "Whole School Curriculum Progress" : `${selectedClass} Curriculum Progress`}
          </span>
          <span className="font-mono text-sapphire">{overallStats.pct}% Completed</span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-line/60">
          <div
            className="h-full rounded-full bg-sapphire transition-all duration-500"
            style={{ width: `${overallStats.pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11.5px] text-ink-muted">
          <span>Total Chapters: <b>{overallStats.total}</b></span>
          <span>Completed: <b>{overallStats.completed}</b></span>
          <span>Pending: <b>{overallStats.total - overallStats.completed}</b></span>
          {readOnly && (
            <Badge tone="neutral" className="ml-auto text-[10px]">
              View Only
            </Badge>
          )}
        </div>
      </div>

      {/* Subject Pacing Bars List */}
      <div className="divide-y divide-line/50 p-5">
        {filteredSubjects.map((sub) => {
          const pct = Math.round((sub.completedChapters / sub.totalChapters) * 100);
          const isComplete = sub.completedChapters === sub.totalChapters;
          const isBehind = pct < 45; // pacing indicator

          return (
            <div key={sub.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-lavender/30 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-plum">
                    {sub.className}
                  </span>
                  <span className="text-sm font-semibold text-ink">{sub.subject}</span>
                  <span className="text-xs text-ink-muted">({sub.teacher})</span>
                </div>

                <div className="flex items-center gap-3">
                  <Badge tone={isComplete ? "teal" : isBehind ? "plum" : "sapphire"}>
                    {isComplete ? "Completed" : isBehind ? "Behind Pacing" : "On Schedule"}
                  </Badge>
                  <span className="font-mono text-xs font-bold text-ink">
                    {sub.completedChapters}/{sub.totalChapters} Ch ({pct}%)
                  </span>

                  {!readOnly && (
                    <button
                      type="button"
                      disabled={isComplete}
                      onClick={() => handleIncrement(sub.id)}
                      className="rounded-md border border-line bg-white px-2 py-0.5 text-xs font-semibold text-ink hover:bg-slate-50 disabled:opacity-40"
                    >
                      +1 Ch
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar line */}
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line/50">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    isComplete ? "bg-teal" : isBehind ? "bg-plum" : "bg-sapphire"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
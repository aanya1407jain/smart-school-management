"use client";
/**
 * Homework of a REAL (Convex) student record with the student's own submission. Used by the Homework section of the staff student profile.
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import { dueLabel, formatDate, todayISO } from "@/lib/utils/dates";

type Ok<T> = Extract<T, { state: "ok" }>;
export type LiveHomework = Ok<FunctionReturnType<typeof api.homework.myHomework>>["homework"][number];

export function homeworkState(h: LiveHomework, today = todayISO()): "pending" | "overdue" | "submitted" | "late" | "reviewed" {
  if (h.submission) return h.submission.status;
  return h.dueDate < today ? "overdue" : "pending";
}

export function LiveHomeworkList({ homework, today = todayISO() }: { homework: LiveHomework[]; today?: string }) {
  if (homework.length === 0) return <Card><EmptyState title="No homework set" description="Homework set for this class appears here." /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line/60" data-testid="live-homework">
        {homework.map((h) => {
          const st = homeworkState(h, today);
          return (
            <li key={h.homeworkId} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{h.title}</p>
                <p className="text-[12.5px] text-ink-muted">{h.subject}{h.teacher ? ` · ${h.teacher}` : ""} · set {formatDate(h.assignedOn)} · {st === "pending" || st === "overdue" ? dueLabel(h.dueDate, today) : `due ${formatDate(h.dueDate)}`}</p>
                {h.description && <p className="mt-1 text-[13px] text-ink-soft">{h.description}</p>}
                {h.submission?.feedback && <p className="mt-1 text-[12.5px] text-lagoon">Feedback: {h.submission.feedback}</p>}
              </div>
              <StatusBadge status={st} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

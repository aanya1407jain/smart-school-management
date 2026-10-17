"use client";

import { Component, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ClipboardList, GraduationCap, MessageSquare, Paperclip, Send, UserX } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import {
  Badge, Button, Card, EmptyState, FilterBar, FilterSelect, FormField, LoadingState, Modal, PageHeader, Segmented, StatusBadge, Textarea, useToast,
} from "@/components/ui";
import { FormError } from "@/features/shared/form-error";
import { dueLabel, formatDate, formatDateTime, todayISO } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type Filter = "todo" | "submitted" | "reviewed" | "all";

type Submission = {
  submissionId: Id<"homeworkSubmissions">;
  status: "submitted" | "late" | "reviewed";
  submittedAt: number;
  content: string | null;
  feedback: string | null;
};

type HomeworkRow = {
  homeworkId: Id<"homework">;
  title: string;
  description: string;
  assignedOn: string;
  dueDate: string;
  status: "active" | "closed";
  subject: string;
  teacher: string;
  attachmentFileIds: string[];
  submission: Submission | null;
};

/** What the student sees as the item's status badge. */
type DisplayStatus = "pending" | "overdue" | "closed" | Submission["status"];

type Item = HomeworkRow & { displayStatus: DisplayStatus; isOverdue: boolean };

// ------------------------------------------------------------------ Helpers

/** Readable message from a Convex error (ConvexError data or a plain Error). */
function errorMessage(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  if (e instanceof Error) {
    return e.message.replace(/^\[CONVEX [^\]]+\]\s*/, "").replace(/^(Uncaught )?(Server Error\s*)?/, "").trim() || "Unexpected error";
  }
  return String(e);
}

function toItem(h: HomeworkRow, today: string): Item {
  const isOverdue = h.status === "active" && !h.submission && !!h.dueDate && h.dueDate < today;
  const displayStatus: DisplayStatus = h.submission
    ? h.submission.status
    : h.status === "closed"
      ? "closed"
      : isOverdue
        ? "overdue"
        : "pending";
  return { ...h, displayStatus, isOverdue };
}

function matchesStatus(h: Item, f: Filter) {
  switch (f) {
    case "todo":
      return h.status === "active" && !h.submission;
    case "submitted":
      return !!h.submission && (h.submission.status === "submitted" || h.submission.status === "late");
    case "reviewed":
      return h.submission?.status === "reviewed";
    default:
      return true;
  }
}

const EMPTY_TITLES: Record<Filter, string> = {
  todo: "Nothing due — you're all caught up",
  submitted: "No submissions waiting for review",
  reviewed: "No reviewed homework yet",
  all: "No homework assigned yet",
};

/** Convex useQuery throws server errors during render; this turns them into a clean card. */
class QueryBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <EmptyState title="Could not load homework" description={errorMessage(this.state.error)} />
        </Card>
      );
    }
    return this.props.children;
  }
}

// ------------------------------------------------------------------ Page

export function MyHomework() {
  const studentId = useActiveStudentId();
  return (
    <QueryBoundary key={studentId ?? "self"}>
      <MyHomeworkInner studentId={studentId ?? null} />
    </QueryBoundary>
  );
}

function MyHomeworkInner({ studentId }: { studentId: string | null }) {
  const { user } = useSession();
  const isGuardian = !!user?.guardianId;

  const [status, setStatus] = useState<Filter>("todo");
  const [subject, setSubject] = useState("");
  const [submitId, setSubmitId] = useState<string | null>(null);

  // The server resolves the student from the session; studentId only chooses
  // among students already linked to this membership (guardians with several children).
  const data = useQuery(
    api.studentPortal.myHomework,
    studentId ? { studentId: studentId as Id<"students"> } : {}
  );

  const today = todayISO();

  const items = useMemo<Item[]>(() => {
    if (!data || data.state !== "ok") return [];
    return (data.homework as HomeworkRow[]).map((h) => toItem(h, today));
  }, [data, today]);

  const subjectOptions = useMemo(
    () =>
      [...new Set(items.map((h) => h.subject).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
        .map((s) => ({ value: s, label: s })),
    [items]
  );

  const rows = useMemo(() => {
    const list = items.filter((h) => matchesStatus(h, status) && (!subject || h.subject === subject));
    // To do: soonest deadline first. Everything else: most recent first.
    return list.sort((a, b) =>
      status === "todo" ? a.dueDate.localeCompare(b.dueDate) : b.dueDate.localeCompare(a.dueDate)
    );
  }, [items, status, subject]);

  const target = items.find((h) => h.homeworkId === submitId);
  const section = data && data.state === "ok" ? data.section : undefined;

  let body: ReactNode;
  if (data === undefined) {
    body = <LoadingState variant="table" label="Loading homework" />;
  } else if (data.state === "no_student_record") {
    body = (
      <Card>
        <EmptyState
          icon={<UserX className="h-6 w-6" />}
          title="No student record linked to this account"
          description="Your sign-in isn't connected to a student record yet. Please ask the school office to link your account."
        />
      </Card>
    );
  } else if (data.state === "not_enrolled") {
    body = (
      <Card>
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title="Not enrolled in a class this year"
          description="Homework appears once you're placed in a section for the current academic year. Please check with the school office."
        />
      </Card>
    );
  } else if (rows.length === 0) {
    const filteredOut = items.length > 0 && (subject || status !== "all");
    body = (
      <Card>
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title={items.length === 0 ? EMPTY_TITLES.all : EMPTY_TITLES[status]}
          description={filteredOut && subject ? `Nothing here for ${subject}. Try another subject or status.` : undefined}
          action={
            filteredOut && status !== "all" ? (
              <Button variant="outline" onClick={() => { setStatus("all"); setSubject(""); }}>Show all homework</Button>
            ) : undefined
          }
        />
      </Card>
    );
  } else {
    body = (
      <ul className="space-y-3">
        {rows.map((h) => (
          <li key={h.homeworkId}>
            <HomeworkCard
              h={h}
              canSubmit={!isGuardian && h.status === "active" && h.submission?.status !== "reviewed"}
              onSubmit={() => setSubmitId(h.homeworkId)}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <PageHeader
        title="My Homework"
        description={
          section
            ? `Homework set for Class ${section}. Submit before the deadline — your teacher is notified instantly.`
            : "Homework set for your class. Submit before the deadline — your teacher is notified instantly."
        }
      />
      <Card className="mb-5 p-4">
        <FilterBar>
          <Segmented<Filter>
            label="Status"
            value={status}
            onChange={setStatus}
            className="col-span-2 sm:col-span-1"
            options={[
              { value: "todo", label: "To do" },
              { value: "submitted", label: "Submitted" },
              { value: "reviewed", label: "Reviewed" },
              { value: "all", label: "All" },
            ]}
          />
          <FilterSelect label="Subject" value={subject} onChange={setSubject} allLabel="All subjects" options={subjectOptions} />
        </FilterBar>
      </Card>

      {body}

      {target && (
        <SubmitModal
          key={target.homeworkId}
          homeworkId={target.homeworkId}
          title={target.title}
          initialContent={target.submission?.content ?? ""}
          resubmit={!!target.submission}
          late={target.dueDate < today}
          onClose={() => setSubmitId(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Card

function HomeworkCard({ h, canSubmit, onSubmit }: { h: Item; canSubmit: boolean; onSubmit: () => void }) {
  const attachments = h.attachmentFileIds?.length ?? 0;
  return (
    <Card className={cn("p-5", h.isOverdue && "border-purple/30")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">{h.subject}</Badge>
            <StatusBadge status={h.displayStatus} />
          </div>
          <h2 className="mt-2 font-semibold text-sapphire">{h.title}</h2>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{h.description}</p>
          <p className="mt-2 text-[12.5px] text-ink-muted">
            {h.teacher && <>{h.teacher} · </>}set {formatDate(h.assignedOn)} · deadline {formatDate(h.dueDate)}
          </p>
          {attachments > 0 && (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-muted">
              <Paperclip className="h-3.5 w-3.5" /> {attachments} attachment{attachments === 1 ? "" : "s"} from your teacher
            </p>
          )}
          {h.submission && (
            <div className="mt-3 rounded-xl bg-alabaster p-3 text-[13px]">
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <CheckCircle2 className="h-4 w-4 text-lagoon" />
                {h.submission.status === "late" ? "Submitted late" : "Submitted"} {formatDateTime(new Date(h.submission.submittedAt).toISOString())}
              </p>
              {h.submission.content && <p className="mt-1 whitespace-pre-line text-ink-soft">{h.submission.content}</p>}
              {h.submission.feedback && (
                <p className="mt-2 flex items-start gap-1.5 text-lagoon">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {h.submission.feedback}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <span className={cn("text-sm font-semibold", h.isOverdue ? "text-plum" : "text-ink-soft")}>
            {h.submission ? "Done" : h.status === "closed" ? "Closed" : dueLabel(h.dueDate)}
          </span>
          {canSubmit && (
            <Button size="sm" variant={h.submission ? "outline" : "primary"} onClick={onSubmit}>
              <Send className="h-4 w-4" /> {h.submission ? "Resubmit" : "Submit"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Submit modal

function SubmitModal({
  homeworkId,
  title,
  initialContent,
  resubmit,
  late,
  onClose,
}: {
  homeworkId: Id<"homework">;
  title: string;
  initialContent: string;
  resubmit: boolean;
  late: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const submitHomework = useMutation(api.homework.submit);
  const [content, setContent] = useState(initialContent);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = content.trim();
      // The server derives the student from the session — never send a studentId.
      await submitHomework({ homeworkId, ...(trimmed ? { content: trimmed } : {}) });
      toast({
        title: late ? "Submitted late" : resubmit ? "Homework resubmitted" : "Homework submitted",
        description: "Your teacher has been notified.",
      });
      onClose();
    } catch (e) {
      setError(new Error(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={resubmit ? "Resubmit homework" : "Submit homework"}
      description={title}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={submit}><Send className="h-4 w-4" /> {resubmit ? "Resubmit" : "Submit"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {late && (
          <p className="rounded-xl bg-blush/40 px-3 py-2 text-[13px] text-plum">
            The deadline has passed — this will be marked as a late submission.
          </p>
        )}
        {resubmit && (
          <p className="rounded-xl bg-alabaster px-3 py-2 text-[13px] text-ink-soft">
            Your new answer replaces the one you submitted earlier.
          </p>
        )}
        <FormField label="Your answer or note" hint="Describe what you've done, or paste your answer.">
          <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
        </FormField>
        <FormError error={error} />
      </div>
    </Modal>
  );
}

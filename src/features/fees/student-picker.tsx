"use client";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import { demoCall } from "@/lib/demo/runtime";
import { useQuery } from "@/lib/hooks/use-query";
import { useSchoolQuery } from "@/lib/convex/membership";
import { useSession } from "@/features/auth/session-provider";
import { Avatar, EmptyState, Modal, SearchInput } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/format";

type PickRow = { id: string; name: string; admissionNo: string; classLabel: string; outstanding: number };

export function StudentPickerModal({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (studentId: string) => void }) {
  const { dataSource } = useSession();
  const live = dataSource === "live";
  const [term, setTerm] = useState("");
  const search = term.trim();
  // Live: real students of the school with their real balance (server-side search).
  const liveRows = useSchoolQuery(api.fees.listBalances, live && open && search.length >= 2 ? { search } : "skip");
  const q = useQuery(() => demoCall("fees.searchStudents")(term), [term], { enabled: open && !live });
  const rows: PickRow[] | undefined = useMemo(
    () => (live
      ? liveRows?.rows.slice(0, 20).map((r) => ({ id: r.studentId as string, name: r.name, admissionNo: r.admissionNo, classLabel: r.classLabel, outstanding: r.outstandingMinor / 100 }))
      : q.data),
    [live, liveRows, q.data],
  );
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Collect fee" description="Find the student whose payment you are recording." size="md">
      <SearchInput value={term} onChange={setTerm} placeholder="Type at least 2 letters of a name or admission no." label="Search student" />
      <ul className="mt-3 space-y-1">
        {search.length < 2 && <li className="py-6 text-center text-sm text-ink-muted">Search by student name or admission number.</li>}
        {search.length >= 2 && rows === undefined && <li className="py-6 text-center text-sm text-ink-muted">Searching…</li>}
        {search.length >= 2 && rows?.length === 0 && <EmptyState title="No students found" className="py-6" />}
        {search.length >= 2 && (rows ?? []).map((s) => (
          <li key={s.id}>
            <button onClick={() => { onOpenChange(false); onPick(s.id); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-teal-soft/60">
              <Avatar name={s.name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{s.name}</span><span className="block text-[12px] text-ink-muted">{s.admissionNo} · Class {s.classLabel}</span></span>
              <span className={s.outstanding ? "text-sm font-semibold text-sapphire" : "text-[12.5px] text-lagoon"}>{s.outstanding ? `${formatCurrency(s.outstanding)} due` : "Paid up"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

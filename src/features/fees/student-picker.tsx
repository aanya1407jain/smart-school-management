"use client";
import { useState } from "react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { Avatar, EmptyState, Modal, SearchInput } from "@/components/ui";
import { formatCurrency } from "@/lib/utils/format";

export function StudentPickerModal({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (studentId: string) => void }) {
  const [term, setTerm] = useState("");
  const q = useQuery(() => services.fees.searchStudents(term), [term], { enabled: open });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Collect fee" description="Find the student whose payment you are recording." size="md">
      <SearchInput value={term} onChange={setTerm} placeholder="Type at least 2 letters of a name or admission no." label="Search student" />
      <ul className="mt-3 space-y-1">
        {term.trim().length < 2 && <li className="py-6 text-center text-sm text-ink-muted">Search by student name or admission number.</li>}
        {term.trim().length >= 2 && q.data?.length === 0 && <EmptyState title="No students found" className="py-6" />}
        {(q.data ?? []).map((s) => (
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

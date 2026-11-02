"use client";
/**
 * LIVE school calendar (convex/events.ts): upcoming events, holidays, exam
 * days and meetings addressed to the signed-in member. Managers
 * (notices:manage) can add, edit and remove them. A holiday always applies to
 * the whole school and cannot cover a date whose attendance register is
 * already marked — the server refuses it and the message is shown here.
 */
import { useState } from "react";
import { CalendarRange, Pencil, Plus, Trash2 } from "lucide-react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useSchoolMutation, useSchoolQuery } from "@/lib/convex/membership";
import { getAppError } from "@/lib/convex/errors";
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, FormField, Input, LoadingState, Modal, Select, Textarea, useToast } from "@/components/ui";
import { addDays, formatDate, todayISO } from "@/lib/utils/dates";

const errText = (e: unknown) => getAppError(e)?.message ?? (e instanceof Error ? e.message : String(e));
type EventRow = FunctionReturnType<typeof api.events.list>[number];
type Kind = FunctionArgs<typeof api.events.create>["kind"];
type Audience = FunctionArgs<typeof api.events.create>["audience"];
const KIND_LABEL: Record<Kind, string> = { event: "Event", holiday: "Holiday", exam: "Exam day", meeting: "Meeting" };
const KIND_TONE: Record<Kind, "teal" | "lavender" | "sapphire" | "neutral"> = { event: "teal", holiday: "lavender", exam: "sapphire", meeting: "neutral" };

function audienceText(a: Audience) {
  if (a.kind === "all") return "Whole school";
  if (a.kind === "roles") return a.roles.map((r) => (r === "teacher" ? "Teachers" : r === "student" ? "Students" : "Administrators")).join(", ");
  if (a.kind === "classes") return `${a.classIds.length} class${a.classIds.length === 1 ? "" : "es"}`;
  return `${a.sectionIds.length} section${a.sectionIds.length === 1 ? "" : "s"}`;
}

export function LiveEventsPanel({ manage = false }: { manage?: boolean }) {
  const today = todayISO();
  const events = useSchoolQuery(api.events.list, { from: today, to: addDays(today, 180) });
  const remove = useSchoolMutation(api.events.remove);
  const { toast } = useToast();
  const [form, setForm] = useState<EventRow | "new" | null>(null);
  const [del, setDel] = useState<EventRow | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mb-5" data-testid="live-events">
      <CardHeader title="Calendar: events & holidays" description="The next six months." action={manage ? <Button size="sm" onClick={() => setForm("new")}><Plus className="h-4 w-4" /> Add event</Button> : undefined} />
      <div className="p-5 pt-2">
        {events === undefined ? <LoadingState variant="inline" /> : events.length === 0 ? (
          <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="Nothing on the calendar" description={manage ? "Add holidays, events, exam days and meetings." : "Upcoming events and holidays appear here."} />
        ) : (
          <ul className="divide-y divide-line/60">
            {events.map((e) => (
              <li key={e.eventId} className="flex flex-wrap items-center gap-3 py-2.5">
                <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{e.title}</p>
                  <p className="text-[12px] text-ink-muted">{e.startDate === e.endDate ? formatDate(e.startDate) : `${formatDate(e.startDate)} – ${formatDate(e.endDate)}`} · {audienceText(e.audience)}{e.description ? ` · ${e.description}` : ""}</p>
                </div>
                {manage && (
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${e.title}`} onClick={() => setForm(e)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${e.title}`} onClick={() => setDel(e)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {form && <EventModal event={form === "new" ? undefined : form} onClose={() => setForm(null)} />}
      {del && (
        <ConfirmDialog open onOpenChange={(o) => !o && setDel(null)} title="Remove from calendar?" description={`"${del.title}" will be removed. This is recorded in the audit log.`} confirmLabel="Remove" tone="danger" loading={busy}
          onConfirm={async () => { setBusy(true); try { await remove({ eventId: del.eventId }); toast({ title: "Removed from the calendar" }); setDel(null); } catch (e) { toast({ title: "Could not remove", description: errText(e), tone: "error" }); } finally { setBusy(false); } }} />
      )}
    </Card>
  );
}

function EventModal({ event, onClose }: { event?: EventRow; onClose: () => void }) {
  const { toast } = useToast();
  const create = useSchoolMutation(api.events.create);
  const update = useSchoolMutation(api.events.update);
  const classes = useSchoolQuery(api.academics.listClasses, {});
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [kind, setKind] = useState<Kind>(event?.kind ?? "event");
  const [startDate, setStart] = useState(event?.startDate ?? todayISO());
  const [endDate, setEnd] = useState(event?.endDate ?? todayISO());
  const initialScope = event ? (event.audience.kind === "roles" ? `role:${event.audience.roles[0]}` : event.audience.kind) : "all";
  const [scope, setScope] = useState<string>(initialScope);
  const [classIds, setClassIds] = useState<string[]>(event?.audience.kind === "classes" ? event.audience.classIds : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audience = (): Audience => {
    if (kind === "holiday" || scope === "all") return { kind: "all" };
    if (scope === "role:teacher") return { kind: "roles", roles: ["teacher"] };
    if (scope === "role:student") return { kind: "roles", roles: ["student"] };
    return { kind: "classes", classIds: classIds as Id<"classes">[] };
  };
  const save = async () => {
    if (!title.trim()) return setError("Give the event a title.");
    if (!startDate || !endDate || endDate < startDate) return setError("Choose a start date and an end date on or after it.");
    if (kind !== "holiday" && scope === "classes" && classIds.length === 0) return setError("Choose at least one class.");
    setBusy(true);
    setError(null);
    try {
      if (event) await update({ eventId: event.eventId, title: title.trim(), description: description.trim(), startDate, endDate, audience: audience() });
      else await create({ title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}), kind, startDate, endDate, audience: audience() });
      toast({ title: event ? "Calendar updated" : `${KIND_LABEL[kind]} added` });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={event ? `Edit ${KIND_LABEL[event.kind].toLowerCase()}` : "Add to calendar"} size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Title" required className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></FormField>
        <FormField label="Type" hint={kind === "holiday" ? "Holidays apply to the whole school and are not school days for attendance." : undefined}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} disabled={!!event}>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
        </FormField>
        <FormField label="Audience">
          <Select value={kind === "holiday" ? "all" : scope} onChange={(e) => setScope(e.target.value)} disabled={kind === "holiday"}>
            <option value="all">Whole school</option><option value="role:teacher">Teachers only</option><option value="role:student">Students</option><option value="classes">Specific classes</option>
          </Select>
        </FormField>
        <FormField label="Starts" required><Input type="date" value={startDate} onChange={(e) => { setStart(e.target.value); if (endDate < e.target.value) setEnd(e.target.value); }} /></FormField>
        <FormField label="Ends" required><Input type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></FormField>
        {kind !== "holiday" && scope === "classes" && (
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-3">
            {(classes ?? []).map((c) => <Checkbox key={c._id} label={c.name} checked={classIds.includes(c._id)} onChange={(e) => setClassIds(e.target.checked ? [...classIds, c._id] : classIds.filter((x) => x !== c._id))} />)}
          </div>
        )}
        <FormField label="Details" hint="Optional" className="sm:col-span-2"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></FormField>
        {error && <p role="alert" className="text-[13px] text-plum sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}

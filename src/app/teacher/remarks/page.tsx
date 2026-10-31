"use client";

import { useState } from "react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  Textarea,
  Badge,
  DataTable,
  EmptyState,
  useToast,
} from "@/components/ui";
import { MessageSquarePlus } from "lucide-react";

type Incident = {
  id: string;
  studentName: string;
  className: string;
  category: "Appreciation" | "Discipline" | "Academic" | "Attendance";
  severity: "Positive" | "Minor" | "Critical";
  note: string;
  date: string;
};

const INITIAL_INCIDENTS: Incident[] = [
  {
    id: "1",
    studentName: "Aarav Sharma",
    className: "10-A",
    category: "Appreciation",
    severity: "Positive",
    note: "Outstanding leadership in the Science exhibition project.",
    date: "2026-10-28",
  },
  {
    id: "2",
    studentName: "Rohan Verma",
    className: "9-B",
    category: "Discipline",
    severity: "Minor",
    note: "Repeated disruption during math lecture after two verbal warnings.",
    date: "2026-10-30",
  },
];

export default function TeacherRemarksPage() {
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<Incident[]>(INITIAL_INCIDENTS);
  const [open, setOpen] = useState(false);

  const [studentName, setStudentName] = useState("");
  const [className, setClassName] = useState("10-A");
  const [category, setCategory] = useState<Incident["category"]>("Appreciation");
  const [severity, setSeverity] = useState<Incident["severity"]>("Positive");
  const [note, setNote] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !note.trim()) return;

    const newEntry: Incident = {
      id: String(Date.now()),
      studentName: studentName.trim(),
      className,
      category,
      severity,
      note: note.trim(),
      date: new Date().toISOString().split("T")[0],
    };

    setIncidents([newEntry, ...incidents]);
    toast({
      title: "Remark logged",
      description: `Record added for ${studentName}.`,
    });
    setStudentName("");
    setNote("");
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Remarks & Incidents"
        description="Log student appreciation, conduct reports, disciplinary warnings and classroom observations."
        actions={
          <Button onClick={() => setOpen(!open)}>
            <MessageSquarePlus className="h-4 w-4 mr-1.5" />
            {open ? "Close form" : "Log remark"}
          </Button>
        }
      />

      {open && (
        <Card className="p-5 border-line bg-paper-soft/40">
          <form onSubmit={handleCreate} className="space-y-4">
            <h3 className="text-sm font-semibold text-sapphire">
              New Student Observation / Incident
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-semibold text-ink-muted">
                  Student Name
                </label>
                <Input
                  required
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="e.g. Ishita Menon"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-muted">
                  Class
                </label>
                <Select
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                >
                  <option value="10-A">Class 10-A</option>
                  <option value="10-B">Class 10-B</option>
                  <option value="9-A">Class 9-A</option>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-muted">
                  Category
                </label>
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                >
                  <option value="Appreciation">Appreciation</option>
                  <option value="Discipline">Discipline</option>
                  <option value="Academic">Academic</option>
                  <option value="Attendance">Attendance</option>
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-muted">
                  Tag / Severity
                </label>
                <Select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                >
                  <option value="Positive">Positive Note</option>
                  <option value="Minor">Minor Warning</option>
                  <option value="Critical">Critical Issue</option>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-muted">
                Remark / Incident Details
              </label>
              <Textarea
                rows={3}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Provide concrete observations and any actions taken..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save Remark</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-4 sm:p-5">
        <DataTable
          caption="Behavioral & Appreciation Log"
          rows={incidents}
          getRowId={(r) => r.id}
          empty={
            <EmptyState
              title="No remarks logged yet"
              description="All logged student remarks will appear here."
            />
          }
          columns={[
            {
              key: "student",
              header: "Student",
              primary: true,
              cell: (r) => (
                <div>
                  <p className="font-semibold text-ink">{r.studentName}</p>
                  <p className="text-xs text-ink-muted">
                    Class {r.className} · {r.date}
                  </p>
                </div>
              ),
            },
            {
              key: "cat",
              header: "Category",
              cell: (r) => (
                <Badge
                  tone={
                    r.category === "Appreciation"
                      ? "teal"
                      : r.category === "Discipline"
                        ? "lavender"
                        : "neutral"
                  }
                >
                  {r.category}
                </Badge>
              ),
            },
            {
              key: "tag",
              header: "Severity",
              cell: (r) => (
                <span
                  className={`text-xs font-semibold ${
                    r.severity === "Positive"
                      ? "text-lagoon"
                      : r.severity === "Critical"
                        ? "text-plum"
                        : "text-ink-soft"
                  }`}
                >
                  {r.severity}
                </span>
              ),
            },
            {
              key: "note",
              header: "Observation",
              cell: (r) => (
                <p className="text-sm text-ink-soft line-clamp-2">{r.note}</p>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
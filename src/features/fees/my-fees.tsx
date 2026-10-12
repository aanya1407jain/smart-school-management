"use client";
import { BadgePercent, CalendarClock, Check, ChevronDown, Info, Layers, UserRound } from "lucide-react";
import { services } from "@/lib/services";
import { useQuery } from "@/lib/hooks/use-query";
import { useActiveStudentId, useSession } from "@/features/auth/session-provider";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownTrigger,
  EmptyState,
  GlassCard,
  PageHeader,
  ProgressRing,
  QueryView,
  StatusBadge,
} from "@/components/ui";
import { formatCurrency } from "@/lib/utils/format";
import { formatLongDate, formatDate, dueLabel } from "@/lib/utils/dates";
import { FeeObligationsTable, PaymentsTable } from "./fee-tables";

export function MyFees() {
  const studentId = useActiveStudentId();
  const { user, setActiveStudent } = useSession();
  const isGuardian = !!user?.guardianId;
  const hasMultipleChildren = (user?.studentIds?.length ?? 0) > 1;

  const linked = useQuery(
    () => services.dashboard.getLinkedStudents(),
    [user?.id],
    { enabled: isGuardian && hasMultipleChildren }
  );

  const q = useQuery(
    () => services.fees.getStudentLedger(studentId!),
    [studentId],
    { enabled: !!studentId }
  );

  return (
    <div>
      <PageHeader
        title={isGuardian ? "Student Fees" : "My Fees"}
        description={
          isGuardian
            ? "Fee schedule, installments, concession records, and receipts for your linked child."
            : "Your fee summary, installments, payment history and receipts."
        }
      />
      <QueryView query={q}>
        {(l) => (
          <div className="space-y-5">
            {isGuardian && (
              <GlassCard className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <Avatar name={l.student.name} size="md" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-plum">
                        Guardian View
                      </span>
                      <Badge tone="lavender">Linked Student</Badge>
                    </div>
                    <p className="text-base font-semibold text-sapphire">{l.student.name}</p>
                    <p className="text-xs text-ink-muted">
                      <span className="font-mono">{l.student.admissionNo}</span> · {l.student.classLabel}
                    </p>
                  </div>
                </div>

                {hasMultipleChildren && linked.data && linked.data.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-muted">Switch student:</span>
                    <DropdownMenu>
                      <DropdownTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2" aria-label="Switch student">
                          <UserRound className="h-3.5 w-3.5 text-lagoon" />
                          <span>{l.student.name}</span>
                          <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent align="end">
                        <DropdownLabel>Linked children</DropdownLabel>
                        {linked.data.map((c) => (
                          <DropdownItem
                            key={c.id}
                            onSelect={() => setActiveStudent(c.id)}
                            className={c.id === l.student.id ? "bg-teal-soft font-semibold text-lagoon" : undefined}
                          >
                            <Avatar name={c.name} size="xs" />
                            <span className="flex-1">
                              {c.name}
                              <span className="block text-[11px] font-normal text-ink-muted">Class {c.classLabel}</span>
                            </span>
                            {c.id === l.student.id && <Check className="ml-2 h-3.5 w-3.5 text-lagoon" />}
                          </DropdownItem>
                        ))}
                      </DropdownContent>
                    </DropdownMenu>
                  </div>
                )}
              </GlassCard>
            )}

            {l.assignments.length === 0 ? (
              <Card className="p-8">
                <EmptyState
                  icon={<Layers className="h-8 w-8 text-ink-muted" />}
                  title="No fee structure assigned"
                  description={`No fee structure has been assigned for ${
                    isGuardian ? l.student.name : "you"
                  } for the current academic year. Please contact the school accounts office for any inquiries.`}
                />
              </Card>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  <GlassCard className="flex items-center gap-5 p-6 lg:col-span-2">
                    <ProgressRing
                      value={l.totals.net ? (l.totals.paid / l.totals.net) * 100 : 0}
                      size={120}
                      stroke={10}
                      sublabel="paid"
                    />
                    <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
                      <div>
                        <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Total</dt>
                        <dd className="text-xl font-semibold text-sapphire">{formatCurrency(l.totals.net)}</dd>
                        {l.totals.concession > 0 && (
                          <p className="text-[12px] text-ink-muted">
                            after {formatCurrency(l.totals.concession)} concession
                          </p>
                        )}
                      </div>
                      <div>
                        <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Paid</dt>
                        <dd className="text-xl font-semibold text-lagoon">{formatCurrency(l.totals.paid)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Pending</dt>
                        <dd className="text-xl font-semibold text-sapphire">{formatCurrency(l.totals.outstanding)}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Status</dt>
                        <dd className="mt-1">
                          <StatusBadge status={l.standing} />
                        </dd>
                      </div>
                    </dl>
                  </GlassCard>
                  <Card className="p-6">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
                      <CalendarClock className="h-4 w-4" /> Next due
                    </p>
                    {l.nextDue ? (
                      <>
                        <p className="mt-2 text-2xl font-semibold text-sapphire">
                          {formatCurrency(l.nextDue.outstanding)}
                        </p>
                        <p className="text-sm text-ink-soft">
                          {l.nextDue.label} · {formatLongDate(l.nextDue.dueDate)}
                        </p>
                        <p
                          className={
                            l.nextDue.status === "overdue"
                              ? "mt-1 text-sm font-semibold text-plum"
                              : "mt-1 text-sm text-ink-muted"
                          }
                        >
                          {dueLabel(l.nextDue.dueDate)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-lg font-semibold text-lagoon">All fees paid</p>
                    )}
                    <p className="mt-4 flex items-start gap-1.5 text-[12px] text-ink-muted">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Pay at the school office or via UPI / bank transfer.
                      Online payment will be enabled soon.
                    </p>
                  </Card>
                </div>

                {l.concessions.length > 0 && (
                  <Card>
                    <CardHeader
                      title="Concessions & Fee Waivers"
                      description={`Total concessions: ${formatCurrency(
                        l.totals.concession
                      )} applied across installments`}
                      icon={<BadgePercent className="h-4 w-4" />}
                    />
                    <ul className="divide-y divide-line/60 px-5 pb-2">
                      {l.concessions.map((c) => (
                        <li key={c.id} className="flex items-center justify-between py-3 text-sm">
                          <div>
                            <p className="font-medium text-ink">{c.reason}</p>
                            <p className="text-[12px] text-ink-muted">
                              Approved on {formatDate(c.createdAt.slice(0, 10))}
                            </p>
                          </div>
                          <span className="font-semibold text-plum">− {formatCurrency(c.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <Card>
                  <CardHeader title="Installments" />
                  <div className="p-5">
                    <FeeObligationsTable obligations={l.obligations} />
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Payment history" description="Open any payment to view or print its receipt." />
                  <div className="p-5">
                    <PaymentsTable payments={l.payments} />
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </QueryView>
    </div>
  );
}

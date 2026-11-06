"use client";
/**
 * DEMO ONLY (internal full build; mounted through DemoSlot "audit.log"): the
 * audit-log screen with sample entries generated in the browser, so the table,
 * filters, CSV export and the before/after drawer can be tried without a
 * Convex deployment. Nothing is read from or written to any database.
 */
import { useEffect, useMemo, useState } from "react";
import { toCsv } from "@convex/model/audit";
import { AUDIT_CATEGORY_LABELS, auditCategoryOf, auditOutcomeOf } from "@convex/core/auditCategories";
import { AuditLogView } from "./audit-log-view";
import { dateRangeMs, EMPTY_AUDIT_FILTERS, saveCsv, type AuditEntry, type AuditFilterState } from "./audit-format";

type Actor = NonNullable<AuditEntry["actor"]>;
const PRINCIPAL: Actor = { name: "Aanya Jain", loginId: "ADMIN-001", profile: "Administrator" };
const ACCOUNTANT: Actor = { name: "Ravi Mehta", loginId: "ADMIN-002", profile: "Accountant" };
const TEACHER: Actor = { name: "Rahul Verma", loginId: "TCH-00001", profile: "Teacher" };
const TEACHER2: Actor = { name: "Neha Iyer", loginId: "TCH-00004", profile: "Teacher" };
const STUDENT: Actor = { name: "Aarav Sharma", loginId: "0246CBSE0001", profile: "Student" };

type Seed = [minutesAgo: number, actor: Actor | null, role: AuditEntry["actorRole"], action: string, table: string, target: string | null, summary: string, metadata?: Record<string, unknown>];

const SEEDS: Seed[] = [
  [3, PRINCIPAL, "admin", "auth.signed_in", "schoolMemberships", "ADMIN-001", "Aanya Jain (ADMIN-001) signed in", { method: "password" }],
  [11, ACCOUNTANT, "admin", "fees.payment_recorded", "feePayments", "0246CBSE0001", "Recorded ₹12,500 (UPI) from Aarav Sharma for Term 2", { amountMinor: 1250000, method: "upi", receiptNo: "RC-2026-0412" }],
  [26, PRINCIPAL, "admin", "credential.otp_requested", "schoolMemberships", "TCH-00004", "Aanya Jain requested a one-time code to reset the password of TCH-00004 (Neha Iyer)", { targetRole: "teacher" }],
  [27, PRINCIPAL, "admin", "credential.otp_failed", "schoolMemberships", "TCH-00004", "Incorrect password-reset code for TCH-00004 (attempt 1 of 5)", { attempts: 1, maxAttempts: 5 }],
  [28, PRINCIPAL, "admin", "PASSWORD_OVERWRITE", "schoolMemberships", "TCH-00004", "Password of TCH-00004 (Neha Iyer) overwritten by Aanya Jain", { targetRole: "teacher", authorizedBy: "email_otp" }],
  [55, TEACHER, "teacher", "attendance.corrected", "attendanceSessions", null, "Corrected 10-A register for yesterday (2 changes)", { before: { "Isha Rao": "absent", "Kabir Das": "late" }, after: { "Isha Rao": "present", "Kabir Das": "present" } }],
  [90, PRINCIPAL, "admin", "student.updated", "students", "0246CBSE0007", "Updated Meera Nair (ADM-2019-007)", { fields: ["phone", "address"], before: { phone: "+91 98100 00011", address: "12 Lake Road" }, after: { phone: "+91 98100 00099", address: "4 Hill View, Sector 9" }, scholarNo: "0246CBSE0007" }],
  [140, PRINCIPAL, "admin", "membership.permissions_changed", "schoolMemberships", "ADMIN-002", "Changed Ravi Mehta's access: Accountant → Accountant + Reports", { from: { summary: "Accountant", grants: ["fees: manage"] }, to: { summary: "Accountant + Reports", grants: ["fees: manage", "reports: view"] } }],
  [180, TEACHER2, "teacher", "marks.entered", "examSubjects", null, "Entered Mathematics marks for 9-B, Half-yearly (38 students)", { changed: 38 }],
  [260, STUDENT, "student", "auth.signed_in", "schoolMemberships", "0246CBSE0001", "Aarav Sharma (0246CBSE0001) signed in", { method: "password" }],
  [300, STUDENT, "student", "account.password_changed", "schoolMemberships", "0246CBSE0001", "0246CBSE0001 (Aarav Sharma) changed their own password", { firstChange: true }],
  [420, ACCOUNTANT, "admin", "fees.concession_added", "feeConcessions", "0246CBSE0012", "Added a 25% sibling concession for Diya Kapoor", { before: { concession: null }, after: { concession: "Sibling 25%" } }],
  [600, PRINCIPAL, "admin", "student.tc_issued", "transferCertificates", "0246CBSE0031", "Issued transfer certificate TC-2026-014 to Rohan Gupta", { tcNo: "TC-2026-014", waiver: false }],
  [900, PRINCIPAL, "admin", "students.promoted", "promotionRuns", null, "Promoted 34 students from 8-A to 9-A (2026-27)", { promoted: 34, repeated: 1 }],
  [1300, PRINCIPAL, "admin", "account.disabled", "schoolMemberships", "TCH-00009", "Disabled the account of TCH-00009 (Sanjay Pillai)", { targetRole: "teacher" }],
  [1500, PRINCIPAL, "admin", "credential.otp_locked", "schoolMemberships", "0246CBSE0019", "Password-reset code for 0246CBSE0019 locked after 5 incorrect attempts", { attempts: 5, maxAttempts: 5 }],
  [2000, PRINCIPAL, "admin", "school.settings_updated", "schoolSettings", null, "Updated school settings", { before: { lowAttendanceThreshold: 75 }, after: { lowAttendanceThreshold: 85 } }],
  [2600, TEACHER, "teacher", "homework.created", "homework", null, "Set homework \"Quadratic equations — worksheet 4\" for 10-A", {}],
  [3200, ACCOUNTANT, "admin", "fees.payment_reversed", "feePayments", "0246CBSE0001", "Reversed receipt RC-2026-0377 (duplicate entry)", { reason: "Duplicate entry", amountMinor: 500000 }],
  [4300, PRINCIPAL, "admin", "enrollment.transferred", "enrollments", "0246CBSE0044", "Ananya Roy enrolled in 7-C (2026-27)", { before: { section: "7-B" }, after: { section: "7-C" } }],
  [5800, null, null, "school.modules_changed", "schools", null, "Enabled modules: Finance, Academics", { enabled: ["finance", "academics"] }],
  [7200, PRINCIPAL, "admin", "account.created", "schoolMemberships", "TCH-00012", "Account TCH-00012 created for Farah Khan (teacher)", { targetRole: "teacher" }],
  [9000, PRINCIPAL, "admin", "audit.exported", "schools", null, "Exported 312 audit log entries as CSV", { rowCount: 312, truncated: false }],
];

function demoEntries(now: number): AuditEntry[] {
  return SEEDS.map(([min, actor, role, action, table, target, summary, metadata], i) => ({
    _id: `demo-audit-${i}`,
    at: now - min * 60_000,
    action,
    category: auditCategoryOf(action),
    outcome: auditOutcomeOf(action),
    summary,
    entity: { table, id: `demo_${table}_${i}` },
    target,
    actorRole: role,
    actor,
    metadata: metadata ?? null,
  }));
}

/** The same filtering the server applies (convex/audit.ts getAuditLogs), in the browser. */
function applyFilters(rows: AuditEntry[], f: AuditFilterState): AuditEntry[] {
  const { startDate, endDate } = dateRangeMs(f.from, f.to);
  const needle = f.search.trim().toLowerCase();
  return rows.filter((r) =>
    (!f.category || r.category === f.category) &&
    (!f.actorRole || (f.actorRole === "system" ? !r.actor : r.actorRole === f.actorRole)) &&
    (startDate === undefined || r.at >= startDate) &&
    (endDate === undefined || r.at <= endDate) &&
    (!needle || [r.actor?.name, r.actor?.loginId, r.target, r.entity.id, r.action, r.summary].filter(Boolean).join("\n").toLowerCase().includes(needle)));
}

export function DemoAuditLog() {
  // Generated after mount: times are relative to "now", which differs between server render and browser.
  const [all, setAll] = useState<AuditEntry[] | undefined>(undefined);
  useEffect(() => setAll(demoEntries(Date.now())), []);
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_AUDIT_FILTERS);
  const [notice, setNotice] = useState<string | null>("Demo school: sample entries generated in your browser.");
  const rows = useMemo(() => (all ? applyFilters(all, filters) : undefined), [all, filters]);
  const onExport = () => {
    const header = ["Timestamp (UTC)", "Category", "Action", "Outcome", "Actor", "Actor Login ID", "Actor role", "Entity type", "Entity ID", "Affected account", "Summary", "Details (JSON)"];
    if (!rows) return;
    const body = rows.map((r) => [new Date(r.at).toISOString(), AUDIT_CATEGORY_LABELS[r.category], r.action, r.outcome, r.actor?.name ?? "System", r.actor?.loginId ?? "", r.actor?.profile ?? "System", r.entity.table, r.entity.id, r.target ?? "", r.summary, r.metadata ?? ""]);
    saveCsv(`audit-log-demo-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${toCsv([header, ...body])}`);
    setNotice(`Exported ${rows.length} sample entries.`);
  };
  return (
    <div data-testid="demo-audit-log">
      <AuditLogView
        filters={filters}
        onFiltersChange={setFilters}
        rows={rows}
        canLoadMore={false}
        loadingMore={false}
        onLoadMore={() => {}}
        onExport={onExport}
        exporting={false}
        notice={notice}
      />
    </div>
  );
}

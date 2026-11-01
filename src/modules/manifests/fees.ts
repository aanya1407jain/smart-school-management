/**
 * Module manifest. Fees: fee structures, assignments, concessions, payments, receipts and due reminders.
 *
 * Owned by the module and shipped only when the module is selected; the
 * composition root (src/modules/registry.generated.ts) lists the manifests of
 * the build, and navigation / route guards are built from it.
 */
import { defineModule, type RouteContribution } from "../../../convex/contracts/manifest";

const page = (path: string, anyOf: RouteContribution["anyOf"], roles: RouteContribution["roles"], publicReason?: string): RouteContribution => ({
  path, file: `src/app${path}/page.tsx`, roles, anyOf, ...(publicReason ? { publicReason } : {}),
});

export const fees = defineModule({
  id: "fees", version: "1.0.0", entitlementKey: "finance",
  requires: ["students"], optional: [],
  publicEntries: {},
  sources: ["src/modules/manifests/fees.ts", "convex/model/feeRecords.ts", "src/features/fees/", "convex/fees.ts", "convex/feeReminders.ts", "convex/model/feeData.ts", "convex/model/feeMath.ts"],
  permissions: ["fees:manage", "fees:read:own", "reports:finance"],
  routes: [
    page("/admin/fees", ["fees:manage"], ["admin"]),
    page("/admin/fees/[studentId]", ["fees:manage"], ["admin"]),
    page("/student/fees", ["fees:read:own"], ["student"]),
  ],
  nav: [
    { role: "admin", group: "Daily operations", label: "Fees", href: "/admin/fees", icon: "fees", anyOf: ["fees:manage"], order: 21 },
    { role: "student", group: "My school", label: "My Fees", href: "/student/fees", icon: "fees", anyOf: ["fees:read:own"], order: 15 },
  ],
  backend: {
    functionFiles: ["convex/feeReports.ts", "convex/fees.ts", "convex/feeReminders.ts"],
    tables: ["feeStructures", "studentFees", "feeConcessions", "feePayments", "receipts"],
    crons: [{ name: "fee-due reminders", schedule: { daily: { hourUTC: 2, minuteUTC: 30 } }, fn: "feeReminders:runDaily" }],
    migrations: [],
  },
  provides: ["fees.studentDues", "fees.studentLedger", "fees.receiptFiles", "fees.overview"],
  consumes: [],
  contributes: { reportTabs: ["Finance"], dashboardPanels: ["admin.feeOverview"], studentProfileSections: ["fees"] },
  events: { emits: [], listens: [] },
  tests: { unit: ["tests/convex/fees.test.ts", "tests/convex/mvp-p1-fees-reports.test.ts"] },
});

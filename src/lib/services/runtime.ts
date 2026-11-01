/**
 * The demo layer's side of the DEMO runtime port (src/lib/demo/runtime.ts).
 * Internal full build only: the composition root (src/modules/demo.generated.ts)
 * imports this file; customer exports do not contain it.
 */
import type { ComponentType } from "react";
import type { DemoRuntime } from "@/lib/demo/runtime";
import { DEMO_ACCOUNTS } from "@/features/auth/demo-accounts";
import { subscribeDb } from "@/lib/store/db";
import { purgeLegacySessionStorage, subscribeSession } from "./session-store";
import { services } from "./index";
import { DEMO_SLOTS } from "./demo-slots";

export const demoRuntime: DemoRuntime = {
  personas: DEMO_ACCOUNTS,
  auth: {
    bindIdentity: (viewer) => services.auth.bindIdentity(viewer),
    clearIdentity: () => services.auth.clearIdentity(),
    getSessionSnapshot: () => services.auth.getSessionSnapshot(),
  },
  subscribe(listener) {
    const a = subscribeDb(listener);
    const b = subscribeSession(listener);
    return () => { a(); b(); };
  },
  purgeLegacyStorage: purgeLegacySessionStorage,
  notifications: services.notifications,
  notices: services.notices,
  school: {
    getPublicProfile: () => services.school.getPublicProfile(),
    getSchool: () => services.lookup.getSchool(),
    updateInfo: (input) => services.school.updateInfo(input),
    updateSettings: (settings) => services.school.updateSettings(settings),
    resetDemoData: () => services.school.resetDemoData(),
    getAcademicOptions: () => services.lookup.getAcademicOptions(),
  },
  data(key, args) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = args as any;
    const sources: Record<string, () => Promise<unknown>> = {
      "dashboard.admin": () => services.dashboard.getAdminDashboard(),
      "reports.studentStatistics": () => services.reports.getStudentStatistics(),
      "reports.attendance": () => services.reports.getAttendanceReport(),
      "reports.examPerformance": () => services.reports.getExamPerformance(a),
      "reports.academicTrend": () => services.reports.getAcademicTrend(),
      "fees.summary": () => services.fees.getSummary(),
      "fees.payments": () => services.fees.listPayments({}),
      "fees.balances": () => services.fees.listBalances(a),
    };
    const source = sources[key];
    return source ? source() : Promise.reject(new Error(`No demo data for "${key}".`));
  },
  call(path, ...args) {
    const [svc, method] = path.split(".");
    const service = (services as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[svc];
    const fn = service?.[method];
    return fn ? fn.call(service, ...args) : Promise.reject(new Error(`No demo service "${path}".`));
  },
  slots: DEMO_SLOTS as Readonly<Record<string, ComponentType<Record<string, unknown>>>>,
};

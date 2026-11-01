/**
 * GENERATED composition root (backend): the internal demo dataset's student
 * Login IDs (D4: demo is internal-only). This checked-in copy is the internal
 * full build; scripts/distribute.ts writes an empty list for customer exports,
 * which contain no demo seed data. Only Core reads it.
 */
import { asterAcademy } from "./seedData/asterAcademy";

export const DEMO_STUDENT_LOGIN_IDS: readonly string[] = asterAcademy.students.flatMap((s) => (s.login ? [s.login.loginId.toUpperCase()] : []));

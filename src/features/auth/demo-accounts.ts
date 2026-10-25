import type { Role } from "@/types/domain";
import { asterAcademy } from "@convex/seedData/asterAcademy";

/**
 * Development-only demo logins (also listed in README.md), shown by the login
 * screen's "Development demo accounts" helper. They exist only in deployments
 * seeded with `npm run seed:demo` (convex/seedData/asterAcademy.ts). Real
 * schools never use them; the app itself never stores or checks passwords.
 */
const ds = asterAcademy;
const teacher = (key: string) => ds.teachers.find((t) => t.key === key)!;
const student = (key: string) => ds.students.find((s) => s.key === key)!;

export const DEMO_ACCOUNTS: { label: string; loginId: string; password: string; role: Role; roleLabel: string }[] = [
  { label: `${ds.admin.displayName} — Principal`, ...ds.admin.login, role: "admin", roleLabel: "Admin" },
  { label: "Rahul Verma — Maths & Science, 10A class teacher", ...teacher("verma").login!, role: "teacher", roleLabel: "Teacher" },
  { label: "Meera Iyer — Science, 10B class teacher", ...teacher("iyer").login!, role: "teacher", roleLabel: "Teacher" },
  { label: "Aarav Sharma — Class 10A", ...student("aarav").login!, role: "student", roleLabel: "Student" },
];

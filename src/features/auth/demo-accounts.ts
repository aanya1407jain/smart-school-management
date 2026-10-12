import type { Role } from "@/types/domain";

/**
 * Development-only demo logins (also listed in README.md). These accounts are
 * created in Convex Auth by `npm run seed:demo` (convex/seedData/asterAcademy.ts);
 * the app itself never stores or checks these passwords.
 */
const DEMO_PASSWORDS = {
  admin: "Admin@123",
  teacher: "Teacher@123",
  student: "Student@123",
  guardian: "Guardian@123",
  default: "Welcome@123",
} as const;

export const DEMO_ACCOUNTS: { label: string; email: string; password: string; role: Role; roleLabel: string }[] = [
  { label: "Aanya Jain — Principal", email: "admin@asteracademy.edu", password: DEMO_PASSWORDS.admin, role: "admin", roleLabel: "Admin" },
  { label: "Rahul Verma — Maths & Science, 10A class teacher", email: "teacher@asteracademy.edu", password: DEMO_PASSWORDS.teacher, role: "teacher", roleLabel: "Teacher" },
  { label: "Meera Iyer — Science, 10B class teacher", email: "meera.iyer@asteracademy.edu", password: DEMO_PASSWORDS.default, role: "teacher", roleLabel: "Teacher" },
  { label: "Aarav Sharma — Class 10A", email: "student@asteracademy.edu", password: DEMO_PASSWORDS.student, role: "student", roleLabel: "Student" },
  { label: "Priya Sharma — guardian of Aarav & Ananya", email: "guardian@asteracademy.edu", password: DEMO_PASSWORDS.guardian, role: "student", roleLabel: "Guardian" },
];

import type { Role } from "@/types/domain";
import { DEMO_PASSWORDS } from "@/lib/mock-data/seed";

/** Development-only demo logins (also listed in README.md). */
export const DEMO_ACCOUNTS: { label: string; email: string; password: string; role: Role; roleLabel: string }[] = [
  { label: "Aanya Jain — Principal", email: "admin@asteracademy.edu", password: DEMO_PASSWORDS.admin, role: "admin", roleLabel: "Admin" },
  { label: "Rahul Verma — Maths & Science, 10A class teacher", email: "teacher@asteracademy.edu", password: DEMO_PASSWORDS.teacher, role: "teacher", roleLabel: "Teacher" },
  { label: "Meera Iyer — Science, 10B class teacher", email: "meera.iyer@asteracademy.edu", password: DEMO_PASSWORDS.default, role: "teacher", roleLabel: "Teacher" },
  { label: "Aarav Sharma — Class 10A", email: "student@asteracademy.edu", password: DEMO_PASSWORDS.student, role: "student", roleLabel: "Student" },
  { label: "Priya Sharma — guardian of Aarav & Ananya", email: "guardian@asteracademy.edu", password: DEMO_PASSWORDS.guardian, role: "student", roleLabel: "Guardian" },
];

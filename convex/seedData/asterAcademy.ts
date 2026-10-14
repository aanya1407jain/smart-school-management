/**
 * DEMO DATA ONLY — "Aster Academy", a fictional school used for development,
 * demos and tests. Nothing in the backend depends on this school; it is just
 * one dataset passed to the generic seeder in convex/seed.ts.
 *
 * Demo logins (Login ID / password). Development and demo use ONLY — real
 * schools get their accounts from an administrator, never from this file:
 *   ADMIN-001      / Admin@123     Aanya Jain, Principal (admin)
 *   TCH-00001      / Teacher@123   Rahul Verma — class teacher 10-A, Maths 10-A/10-B/9-A, Science 10-A
 *   TCH-00002      / Welcome@123   Meera Iyer — class teacher 10-B
 *   TCH-00003      / Welcome@123   Sunita Rao — English 10-A/B/C, class teacher 10-C
 *   TCH-00004…10   / Welcome@123   the other teachers, in the order listed below
 *   STU-2026-00001 / Student@123   Aarav Sharma, 10-A
 *   STU-2026-00002 / Welcome@123   Amaira Desai, 10-B
 *   GRD-00001      / Guardian@123  Priya Sharma — guardian of Aarav (10-A) and Ananya (8-B)
 */
import type { SeedDataset } from "./types";

const DOMAIN = "asteracademy.edu";
const welcome = (loginId: string) => ({ loginId, password: "Welcome@123" });

const SECTIONS = ["8-A", "8-B", "9-A", "9-B", "10-A", "10-B", "10-C"];

// Deterministic name pools for generated students (no randomness).
const FIRST_M = ["Arjun", "Vihaan", "Kabir", "Reyansh", "Ishaan", "Dhruv", "Aditya", "Rohan", "Krish", "Atharv", "Shaurya", "Ayaan"];
const FIRST_F = ["Diya", "Saanvi", "Myra", "Anika", "Kiara", "Ira", "Navya", "Aadhya", "Riya", "Tara", "Meher", "Zoya"];
const LAST = ["Patel", "Reddy", "Gupta", "Kumar", "Nair", "Menon", "Joshi", "Bose", "Iyer", "Kulkarni", "Chopra", "Rao", "Das", "Mehta"];

type Student = SeedDataset["students"][number];

function generatedStudents(): Student[] {
  const named: Student[] = [
    { key: "aarav", firstName: "Aarav", lastName: "Sharma", gender: "male", dateOfBirth: "2011-04-14", section: "10-A", rollNo: 1, email: `student@${DOMAIN}`, login: { loginId: "STU-2026-00001", password: "Student@123" } },
    { key: "amaira", firstName: "Amaira", lastName: "Desai", gender: "female", dateOfBirth: "2011-08-02", section: "10-B", rollNo: 1, email: `amaira.desai@students.${DOMAIN}`, login: welcome("STU-2026-00002") },
    { key: "ananya", firstName: "Ananya", lastName: "Sharma", gender: "female", dateOfBirth: "2013-11-21", section: "8-B", rollNo: 1, email: `ananya.sharma@students.${DOMAIN}` },
  ];
  const out = [...named];
  let n = 0;
  for (const section of SECTIONS) {
    const level = Number(section.split("-")[0]);
    const already = named.filter((s) => s.section === section).length;
    for (let i = already; i < 6; i++, n++) {
      const female = n % 2 === 1;
      const firstName = (female ? FIRST_F : FIRST_M)[n % 12];
      const lastName = LAST[(n * 5 + 3) % LAST.length];
      const birthYear = 2026 - level - 6 + (n % 3 === 0 ? -1 : 0);
      out.push({
        key: `stu${n}`, firstName, lastName, gender: female ? "female" : "male",
        dateOfBirth: `${birthYear}-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 27) + 1).padStart(2, "0")}`,
        section, rollNo: i + 1, email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${n}@students.${DOMAIN}`,
      });
    }
  }
  return out;
}

export const asterAcademy: SeedDataset = {
  school: {
    name: "Aster Academy", slug: "aster-academy", shortName: "Aster", code: "AA",
    timezone: "Asia/Kolkata", locale: "en-IN", currency: "INR",
    tagline: "Learn · Lead · Light the way",
    address: "18 Lalbagh Road, Basavanagudi, Bengaluru 560004",
    phone: "+91 80 4110 2026", email: `office@${DOMAIN}`, website: `www.${DOMAIN}`, affiliation: "CBSE Affiliation No. 830417",
  },
  settings: {
    workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
    attendance: { lateCountsAsPresent: true, lowAttendanceThreshold: 85 },
    grading: { scheme: "cbse_8_point", passPercentage: 33 },
  },
  academicYear: { name: "2026-27", startDate: "2026-04-01", endDate: "2027-03-31" },
  classes: [
    { name: "Grade 8", level: 8, sections: ["A", "B"] },
    { name: "Grade 9", level: 9, sections: ["A", "B"] },
    { name: "Grade 10", level: 10, sections: ["A", "B", "C"] },
  ],
  subjects: [
    { name: "Mathematics", code: "MATH" }, { name: "Science", code: "SCI" }, { name: "English", code: "ENG" },
    { name: "Social Science", code: "SST" }, { name: "Hindi", code: "HIN" }, { name: "Computer Science", code: "CS" },
  ],
  admin: { displayName: "Aanya Jain", email: `admin@${DOMAIN}`, login: { loginId: "ADMIN-001", password: "Admin@123" } },
  teachers: [
    { key: "verma", title: "Mr.", firstName: "Rahul", lastName: "Verma", gender: "male", email: `teacher@${DOMAIN}`, designation: "Senior Teacher (PGT)", qualification: "M.Sc. Mathematics, B.Ed.", subjects: ["MATH", "SCI"], joiningDate: "2016-06-01", login: { loginId: "TCH-00001", password: "Teacher@123" } },
    { key: "iyer", title: "Ms.", firstName: "Meera", lastName: "Iyer", gender: "female", email: `meera.iyer@${DOMAIN}`, designation: "Teacher (TGT)", qualification: "M.Sc. Chemistry, B.Ed.", subjects: ["SCI"], joiningDate: "2019-06-01", login: welcome("TCH-00002") },
    { key: "rao", title: "Mrs.", firstName: "Sunita", lastName: "Rao", gender: "female", email: `sunita.rao@${DOMAIN}`, designation: "Head of English", qualification: "M.A. English Literature, B.Ed.", subjects: ["ENG"], joiningDate: "2012-06-01", login: welcome("TCH-00003") },
    { key: "khan", title: "Ms.", firstName: "Farah", lastName: "Khan", gender: "female", email: `farah.khan@${DOMAIN}`, designation: "Head of Mathematics", qualification: "M.Sc. Mathematics, M.Ed.", subjects: ["MATH"], joiningDate: "2011-06-01", login: welcome("TCH-00004") },
    { key: "nair", title: "Dr.", firstName: "Kavita", lastName: "Nair", gender: "female", email: `kavita.nair@${DOMAIN}`, designation: "Head of Humanities", qualification: "Ph.D. History", subjects: ["SST"], joiningDate: "2014-06-01", login: welcome("TCH-00005") },
    { key: "mishra", title: "Mr.", firstName: "Deepak", lastName: "Mishra", gender: "male", email: `deepak.mishra@${DOMAIN}`, designation: "Teacher (TGT)", qualification: "M.A. Hindi, B.Ed.", subjects: ["HIN"], joiningDate: "2018-06-01", login: welcome("TCH-00006") },
    { key: "kapoor", title: "Ms.", firstName: "Neha", lastName: "Kapoor", gender: "female", email: `neha.kapoor@${DOMAIN}`, designation: "Teacher (TGT)", qualification: "M.A. English, B.Ed.", subjects: ["ENG"], joiningDate: "2020-06-01", login: welcome("TCH-00007") },
    { key: "singh", title: "Mr.", firstName: "Vikram", lastName: "Singh", gender: "male", email: `vikram.singh@${DOMAIN}`, designation: "Teacher (PGT)", qualification: "M.Sc. Physics, B.Ed.", subjects: ["SCI"], joiningDate: "2017-06-01", login: welcome("TCH-00008") },
    { key: "joshi", title: "Mr.", firstName: "Sameer", lastName: "Joshi", gender: "male", email: `sameer.joshi@${DOMAIN}`, designation: "Teacher (TGT)", qualification: "MCA", subjects: ["CS"], joiningDate: "2021-06-01", login: welcome("TCH-00009") },
    { key: "desai", title: "Mr.", firstName: "Rohan", lastName: "Desai", gender: "male", email: `rohan.desai@${DOMAIN}`, designation: "Teacher (TGT)", qualification: "M.A. Geography, B.Ed.", subjects: ["SST"], joiningDate: "2022-06-01", login: welcome("TCH-00010") },
  ],
  classTeachers: { "10-A": "verma", "10-B": "iyer", "10-C": "rao", "9-A": "khan", "9-B": "nair", "8-A": "mishra", "8-B": "kapoor" },
  assignments: {
    "10-A": { MATH: "verma", SCI: "verma", ENG: "rao", SST: "nair", HIN: "mishra", CS: "joshi" },
    "10-B": { MATH: "verma", SCI: "iyer", ENG: "rao", SST: "nair", HIN: "mishra", CS: "joshi" },
    "10-C": { MATH: "khan", SCI: "iyer", ENG: "rao", SST: "nair", HIN: "mishra", CS: "joshi" },
    "9-A": { MATH: "verma", SCI: "singh", ENG: "kapoor", SST: "nair", HIN: "mishra" },
    "9-B": { MATH: "khan", SCI: "iyer", ENG: "kapoor", SST: "nair", HIN: "mishra" },
    "8-A": { MATH: "khan", SCI: "singh", ENG: "kapoor", SST: "desai", HIN: "mishra" },
    "8-B": { MATH: "khan", SCI: "singh", ENG: "kapoor", SST: "desai", HIN: "mishra" },
  },
  students: generatedStudents(),
  guardians: [
    {
      key: "priya", name: "Priya Sharma", phone: "+91 98450 22011", email: `guardian@${DOMAIN}`, occupation: "Architect",
      links: [{ student: "aarav", relationship: "Mother", isPrimary: true }, { student: "ananya", relationship: "Mother", isPrimary: true }],
      login: { loginId: "GRD-00001", password: "Guardian@123" },
    },
    { key: "nitin", name: "Nitin Desai", phone: "+91 98450 33102", email: `nitin.desai@example.com`, links: [{ student: "amaira", relationship: "Father", isPrimary: true }] },
  ],
  feeStructures: [
    {
      name: "Tuition & Activity 2026-27 (Grades 8–9)", classLevels: [8, 9],
      components: [{ label: "Tuition", amountMinor: 4_800_000 }, { label: "Activity", amountMinor: 600_000 }],
      installments: [{ label: "Quarter 1", dueDate: "2026-04-15", share: 0.25 }, { label: "Quarter 2", dueDate: "2026-07-15", share: 0.25 }, { label: "Quarter 3", dueDate: "2026-10-15", share: 0.25 }, { label: "Quarter 4", dueDate: "2027-01-15", share: 0.25 }],
    },
    {
      name: "Tuition & Activity 2026-27 (Grade 10)", classLevels: [10],
      components: [{ label: "Tuition", amountMinor: 5_600_000 }, { label: "Activity", amountMinor: 600_000 }, { label: "Board registration", amountMinor: 200_000 }],
      installments: [{ label: "Quarter 1", dueDate: "2026-04-15", share: 0.25 }, { label: "Quarter 2", dueDate: "2026-07-15", share: 0.25 }, { label: "Quarter 3", dueDate: "2026-10-15", share: 0.25 }, { label: "Quarter 4", dueDate: "2027-01-15", share: 0.25 }],
    },
  ],
  payments: [
    { student: "aarav", installments: 2, method: "upi", daysAgo: 90 },
    { student: "amaira", installments: 3, method: "bank_transfer", daysAgo: 20 },
    { student: "ananya", installments: 2, method: "cash", daysAgo: 85 },
  ],
  concessions: [{ student: "ananya", percent: 10, reason: "Sibling concession" }],
  exams: [
    { name: "Unit Test 1", term: "Term 1", classLevels: [8, 9, 10], startDate: "2026-07-20", endDate: "2026-07-25", status: "published", subjects: ["MATH", "SCI", "ENG"], maxMarks: 25, passMarks: 9 },
    { name: "Half-Yearly Examination", term: "Term 1", classLevels: [8, 9, 10], startDate: "2026-09-21", endDate: "2026-09-30", status: "marks_entry", subjects: ["MATH", "SCI", "ENG", "SST", "HIN"], maxMarks: 80, passMarks: 27 },
  ],
  holidays: [
    { title: "Gandhi Jayanti", date: "2026-10-02" },
    { title: "Dussehra", date: "2026-10-20" },
  ],
  notices: [
    { title: "Parent–Teacher Meeting — Term 1", body: "PTM will be held in respective classrooms on Saturday, 9:00 AM–1:00 PM.", type: "event", priority: "high", audience: { kind: "all" }, daysAgo: 3 },
    { title: "Science lab safety briefing for 10-B", body: "All 10-B students must attend the lab safety briefing before the practical exam.", type: "notice", priority: "normal", audience: { kind: "sections", sections: ["10-B"] }, daysAgo: 1 },
  ],
  homework: [
    { section: "10-A", subject: "MATH", title: "Quadratic Equations — Exercise 4.3", description: "Solve questions 1–10. Show all working.", dueInDays: 3 },
    { section: "10-B", subject: "SCI", title: "Chemical Reactions worksheet", description: "Complete the balancing equations worksheet.", dueInDays: 4 },
  ],
  timetables: {
    "10-A": {
      1: ["MATH", "ENG", "SCI", "SST", "HIN", "CS"],
      2: ["SCI", "MATH", "ENG", "HIN", "SST", "MATH"],
      3: ["ENG", "SCI", "MATH", "CS", "SST", "HIN"],
      4: ["MATH", "SST", "ENG", "SCI", "HIN", "CS"],
      5: ["SCI", "MATH", "HIN", "ENG", "SST", "MATH"],
      6: ["ENG", "MATH", "SCI", "SST", "CS", "HIN"],
    },
  },
  periods: [
    { start: "08:30", end: "09:15" }, { start: "09:15", end: "10:00" }, { start: "10:15", end: "11:00" },
    { start: "11:00", end: "11:45" }, { start: "12:30", end: "13:15" }, { start: "13:15", end: "14:00" },
  ],
  attendanceDays: 10,
};

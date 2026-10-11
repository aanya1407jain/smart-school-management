/**
 * Builds the complete, relational demo dataset for the seed tenant —
 * "Aster Academy", a fictional demo school. Everything school-specific in here
 * (names, emails, ID prefixes, address) is demo data, not product code.
 *
 * Every record references real ids from other tables — students are enrolled
 * in sections, sections have class teachers, timetable entries reference
 * teacher assignments, marks reference exam papers and enrolled students, etc.
 *
 * "Calendar" data (academic year, exams, fee due dates) is fixed to 2026–27.
 * "Live" data (attendance history, homework, notices, notifications) is
 * generated relative to the day the dataset is seeded so the demo always
 * feels current.
 */
import type {
  AcademicYear, AppNotification, AttendanceSession, AttendanceStatus, Concession, Database, Enrollment,
  Exam, ExamPaper, FeeAssignment, FeeObligation, FeeStructure, Guardian, GuardianLink, Homework,
  HomeworkSubmission, LeaveRequest, Mark, Notice, Payment, Period, Receipt, SchoolClass, Section,
  StaffAttendance, Student, Subject, Teacher, TeacherAssignment, TimetableEntry, UserAccount, Weekday,
} from "@/types/domain";
import { addDays, dayOfWeek, isSchoolDay, previousSchoolDay, todayISO } from "@/lib/utils/dates";
import { createRng } from "./random";
import {
  BLOOD_GROUPS, FATHER_FIRST, FEMALE_FIRST, LAST_NAMES, LOCALITIES, MALE_FIRST, MOTHER_FIRST, OCCUPATIONS,
} from "./names";

export const DB_VERSION = 4;
export const AY_ID = "ay_2026";
export const DEMO_PASSWORDS = {
  admin: "Admin@123",
  teacher: "Teacher@123",
  student: "Student@123",
  guardian: "Guardian@123",
  default: "Welcome@123",
} as const;

const GRADES = [8, 9, 10, 11, 12] as const;
const SECTION_NAMES = ["A", "B", "C"] as const;

export const SUBJECTS: Subject[] = [
  { id: "sub_math", name: "Mathematics", code: "MAT", type: "core" },
  { id: "sub_sci", name: "Science", code: "SCI", type: "core" },
  { id: "sub_eng", name: "English", code: "ENG", type: "language" },
  { id: "sub_cs", name: "Computer Science", code: "CSC", type: "elective" },
  { id: "sub_sst", name: "Social Science", code: "SST", type: "core" },
  { id: "sub_hin", name: "Hindi", code: "HIN", type: "language" },
];

export const PERIODS: Period[] = [
  { index: 1, label: "Period 1", startTime: "09:00", endTime: "09:45" },
  { index: 2, label: "Period 2", startTime: "09:45", endTime: "10:30" },
  { index: 0, label: "Short break", startTime: "10:30", endTime: "10:50", isBreak: true },
  { index: 3, label: "Period 3", startTime: "10:50", endTime: "11:35" },
  { index: 4, label: "Period 4", startTime: "11:35", endTime: "12:20" },
  { index: -1, label: "Lunch", startTime: "12:20", endTime: "13:00", isBreak: true },
  { index: 5, label: "Period 5", startTime: "13:00", endTime: "13:45" },
  { index: 6, label: "Period 6", startTime: "13:45", endTime: "14:30" },
];

type TeacherSeed = Omit<Teacher, "email" | "status" | "address" | "joiningDate" | "phone" | "gender"> & {
  gender: Teacher["gender"];
  slug: string;
};

const TEACHERS: TeacherSeed[] = [
  { id: "t_verma", slug: "rahul.verma", employeeId: "AA-EMP-014", title: "Mr.", firstName: "Rahul", lastName: "Verma", gender: "male", designation: "Senior Teacher (PGT)", qualification: "M.Sc. Mathematics, B.Ed.", specializationIds: ["sub_math", "sub_sci"] },
  { id: "t_iyer", slug: "meera.iyer", employeeId: "AA-EMP-021", title: "Ms.", firstName: "Meera", lastName: "Iyer", gender: "female", designation: "Teacher (TGT)", qualification: "M.Sc. Chemistry, B.Ed.", specializationIds: ["sub_sci"] },
  { id: "t_rao", slug: "sunita.rao", employeeId: "AA-EMP-008", title: "Mrs.", firstName: "Sunita", lastName: "Rao", gender: "female", designation: "Head of English", qualification: "M.A. English Literature, B.Ed.", specializationIds: ["sub_eng"] },
  { id: "t_mehta", slug: "arjun.mehta", employeeId: "AA-EMP-031", title: "Mr.", firstName: "Arjun", lastName: "Mehta", gender: "male", designation: "Teacher (PGT)", qualification: "M.Tech. Computer Science", specializationIds: ["sub_cs"] },
  { id: "t_nair", slug: "kavita.nair", employeeId: "AA-EMP-005", title: "Dr.", firstName: "Kavita", lastName: "Nair", gender: "female", designation: "Head of Humanities", qualification: "Ph.D. History", specializationIds: ["sub_sst"] },
  { id: "t_mishra", slug: "deepak.mishra", employeeId: "AA-EMP-017", title: "Mr.", firstName: "Deepak", lastName: "Mishra", gender: "male", designation: "Teacher (TGT)", qualification: "M.A. Hindi, B.Ed.", specializationIds: ["sub_hin"] },
  { id: "t_khan", slug: "farah.khan", employeeId: "AA-EMP-011", title: "Ms.", firstName: "Farah", lastName: "Khan", gender: "female", designation: "Head of Mathematics", qualification: "M.Sc. Mathematics, M.Ed.", specializationIds: ["sub_math"] },
  { id: "t_singh", slug: "vikram.singh", employeeId: "AA-EMP-024", title: "Mr.", firstName: "Vikram", lastName: "Singh", gender: "male", designation: "Teacher (PGT)", qualification: "M.Sc. Physics, B.Ed.", specializationIds: ["sub_sci"] },
  { id: "t_kapoor", slug: "neha.kapoor", employeeId: "AA-EMP-029", title: "Ms.", firstName: "Neha", lastName: "Kapoor", gender: "female", designation: "Teacher (TGT)", qualification: "M.A. English, B.Ed.", specializationIds: ["sub_eng"] },
  { id: "t_desai", slug: "rohan.desai", employeeId: "AA-EMP-033", title: "Mr.", firstName: "Rohan", lastName: "Desai", gender: "male", designation: "Teacher (TGT)", qualification: "M.A. Geography, B.Ed.", specializationIds: ["sub_sst"] },
  { id: "t_gupta", slug: "anjali.gupta", employeeId: "AA-EMP-019", title: "Mrs.", firstName: "Anjali", lastName: "Gupta", gender: "female", designation: "Teacher (TGT)", qualification: "M.A. Hindi, B.Ed.", specializationIds: ["sub_hin"] },
  { id: "t_joshi", slug: "sameer.joshi", employeeId: "AA-EMP-036", title: "Mr.", firstName: "Sameer", lastName: "Joshi", gender: "male", designation: "Teacher (TGT)", qualification: "MCA", specializationIds: ["sub_cs"] },
  { id: "t_menon", slug: "pooja.menon", employeeId: "AA-EMP-027", title: "Ms.", firstName: "Pooja", lastName: "Menon", gender: "female", designation: "Teacher (TGT)", qualification: "M.Sc. Mathematics, B.Ed.", specializationIds: ["sub_math"] },
  { id: "t_bansal", slug: "ritu.bansal", employeeId: "AA-EMP-022", title: "Mrs.", firstName: "Ritu", lastName: "Bansal", gender: "female", designation: "Teacher (TGT)", qualification: "M.Sc. Biology, B.Ed.", specializationIds: ["sub_sci"] },
  { id: "t_kulkarni", slug: "harish.kulkarni", employeeId: "AA-EMP-038", title: "Mr.", firstName: "Harish", lastName: "Kulkarni", gender: "male", designation: "Teacher (PGT)", qualification: "M.Sc. Applied Mathematics", specializationIds: ["sub_math"] },
  { id: "t_pillai", slug: "sneha.pillai", employeeId: "AA-EMP-040", title: "Dr.", firstName: "Sneha", lastName: "Pillai", gender: "female", designation: "Teacher (PGT)", qualification: "Ph.D. Chemistry", specializationIds: ["sub_sci"] },
  { id: "t_krishnan", slug: "lakshmi.krishnan", employeeId: "AA-EMP-012", title: "Mrs.", firstName: "Lakshmi", lastName: "Krishnan", gender: "female", designation: "Teacher (PGT)", qualification: "M.A. English, M.Phil.", specializationIds: ["sub_eng"] },
  { id: "t_qureshi", slug: "imran.qureshi", employeeId: "AA-EMP-026", title: "Mr.", firstName: "Imran", lastName: "Qureshi", gender: "male", designation: "Teacher (PGT)", qualification: "M.A. Political Science, B.Ed.", specializationIds: ["sub_sst"] },
  { id: "t_saxena", slug: "rekha.saxena", employeeId: "AA-EMP-030", title: "Mrs.", firstName: "Rekha", lastName: "Saxena", gender: "female", designation: "Teacher (TGT)", qualification: "M.A. Hindi, B.Ed.", specializationIds: ["sub_hin"] },
  { id: "t_bhatt", slug: "nikhil.bhatt", employeeId: "AA-EMP-041", title: "Mr.", firstName: "Nikhil", lastName: "Bhatt", gender: "male", designation: "Teacher (PGT)", qualification: "M.Sc. Computer Science", specializationIds: ["sub_cs"] },
];

/** Which teacher teaches which subject to which sections ("10A" style keys). */
const ASSIGNMENT_PLAN: Record<string, Record<string, string[]>> = {
  sub_math: {
    t_verma: ["10A", "10B", "9A"],
    t_menon: ["8A", "8B", "8C", "9B"],
    t_khan: ["11A", "11B", "11C", "9C"],
    t_kulkarni: ["12A", "12B", "12C", "10C"],
  },
  sub_sci: {
    t_verma: ["10A"],
    t_iyer: ["10B", "10C", "9A", "9B"],
    t_bansal: ["8A", "8B", "8C", "9C"],
    t_singh: ["11A", "11B", "11C", "12A"],
    t_pillai: ["12B", "12C"],
  },
  sub_eng: {
    t_rao: ["10A", "10B", "10C", "9A", "9B"],
    t_kapoor: ["9C", "8A", "8B", "8C", "11A"],
    t_krishnan: ["11B", "11C", "12A", "12B", "12C"],
  },
  sub_cs: {
    t_mehta: ["10A", "10B", "10C", "11A", "11B", "11C"],
    t_joshi: ["8A", "8B", "8C", "9A", "9B", "9C"],
    t_bhatt: ["12A", "12B", "12C"],
  },
  sub_sst: {
    t_nair: ["9A", "9B", "9C", "10A", "10B"],
    t_desai: ["10C", "8A", "8B", "8C", "11A"],
    t_qureshi: ["11B", "11C", "12A", "12B", "12C"],
  },
  sub_hin: {
    t_mishra: ["9A", "9B", "9C", "10A", "10B", "10C"],
    t_gupta: ["8A", "8B", "8C", "11A", "11B", "11C"],
    t_saxena: ["12A", "12B", "12C"],
  },
};

/** Periods per week for each subject (6 periods × 5 days = 30). */
const WEEKLY_QUOTA: Record<string, number> = { sub_math: 6, sub_sci: 6, sub_eng: 5, sub_sst: 5, sub_hin: 4, sub_cs: 4 };

const CLASS_TEACHERS: Record<string, string | null> = {
  "10A": "t_verma", "10B": "t_iyer", "10C": "t_rao", "9A": "t_mehta", "9B": "t_nair", "9C": "t_mishra",
  "8A": "t_gupta", "8B": "t_bansal", "8C": "t_joshi", "11A": "t_khan", "11B": "t_singh", "11C": "t_kapoor",
  "12A": "t_desai", "12B": "t_menon", "12C": "t_kulkarni",
};

const FEE_BY_GRADE: Record<number, { tuition: number; lab: number; activity: number; exam: number }> = {
  8: { tuition: 15000, lab: 1500, activity: 1500, exam: 2000 },
  9: { tuition: 16500, lab: 2000, activity: 1500, exam: 2000 },
  10: { tuition: 18000, lab: 2500, activity: 1500, exam: 2000 },
  11: { tuition: 21000, lab: 3500, activity: 1500, exam: 2000 },
  12: { tuition: 22500, lab: 4000, activity: 1500, exam: 2000 },
};

const HOMEWORK_TEMPLATES: Record<string, { title: string; description: string }[]> = {
  sub_math: [
    { title: "Quadratic Equations — Exercise 4.3", description: "Solve questions 1–8 from Exercise 4.3 using the quadratic formula. Show the discriminant for each question before solving." },
    { title: "Arithmetic Progressions worksheet", description: "Complete the AP worksheet shared in class. Questions 9 and 10 are challenge problems — attempt at least one." },
    { title: "Coordinate Geometry problem set", description: "Distance formula and section formula practice. Draw neat graphs where asked." },
    { title: "Trigonometric identities practice", description: "Prove the 12 identities on the sheet. Write each step clearly." },
  ],
  sub_sci: [
    { title: "Chemical reactions & equations worksheet", description: "Balance the 15 chemical equations and classify each reaction type." },
    { title: "Life processes — labelled diagrams", description: "Draw and label the human digestive system and the structure of a nephron." },
    { title: "Light: reflection numericals", description: "Solve the mirror-formula numericals 1–10 from the textbook exercise." },
    { title: "Electricity circuit problems", description: "Calculate equivalent resistance for the 6 circuits on the worksheet." },
  ],
  sub_eng: [
    { title: "Essay: Technology in the classroom", description: "Write a 400-word argumentative essay on the role of technology in education." },
    { title: "Letter to the editor", description: "Write a formal letter to the editor about the need for cleaner public parks in your locality." },
    { title: "Reading comprehension — 'The Last Leaf'", description: "Answer the 8 comprehension questions in complete sentences." },
  ],
  sub_cs: [
    { title: "Python loops practice set", description: "Write programs for the 6 loop problems. Submit the .py files or paste the code." },
    { title: "HTML page: my favourite book", description: "Create a single HTML page with headings, a list and an image about your favourite book." },
    { title: "Flowchart for a library system", description: "Draw a flowchart for issuing and returning a book." },
  ],
  sub_sst: [
    { title: "Map work: major rivers of India", description: "Mark the major rivers and their tributaries on the outline map provided." },
    { title: "Nationalism in India — short notes", description: "Prepare short notes on the Non-Cooperation and Civil Disobedience movements." },
    { title: "Resources & development case study", description: "Read the case study on soil erosion and answer the questions that follow." },
  ],
  sub_hin: [
    { title: "Nibandh: Mera Priya Tyohar", description: "Write a 250-word essay in Hindi on your favourite festival." },
    { title: "Kabir ke dohe — bhavarth", description: "Explain the meaning of the 5 dohe discussed in class." },
    { title: "Patra lekhan practice", description: "Write an informal letter to your friend describing your school trip." },
  ],
};

const key = (grade: number, section: string) => `${grade}${section}`;
export const sectionIdFor = (grade: number, section: string) => `sec_${grade}${section.toLowerCase()}`;
export const classIdFor = (grade: number) => `cls_${grade}`;

export function createSeedDatabase(today: string = todayISO()): Database {
  const rng = createRng(20262027);
  const nowIso = new Date().toISOString();
  const lastSchoolDay = previousSchoolDay(addDays(today, -1));

  // ------------------------------------------------------------ Academic year / classes / sections
  const academicYears: AcademicYear[] = [
    { id: "ay_2025", name: "2025–26", startDate: "2025-04-01", endDate: "2026-03-31", status: "archived" },
    { id: AY_ID, name: "2026–27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
    { id: "ay_2027", name: "2027–28", startDate: "2027-04-01", endDate: "2028-03-31", status: "upcoming" },
  ];

  const classes: SchoolClass[] = GRADES.map((g) => ({
    id: classIdFor(g), academicYearId: AY_ID, grade: g, name: `Class ${g}`, subjectIds: SUBJECTS.map((s) => s.id),
  }));

  const sections: Section[] = [];
  let roomNo = 101;
  for (const g of GRADES) {
    for (const s of SECTION_NAMES) {
      sections.push({
        id: sectionIdFor(g, s), classId: classIdFor(g), name: s, room: `Room ${roomNo++}`, capacity: 40,
        classTeacherId: CLASS_TEACHERS[key(g, s)] ?? null,
      });
    }
    roomNo += 7;
  }
  const sectionKey = (id: string) => {
    const sec = sections.find((s) => s.id === id)!;
    const cls = classes.find((c) => c.id === sec.classId)!;
    return key(cls.grade, sec.name);
  };

  // ------------------------------------------------------------ Teachers & assignments
  const teachers: Teacher[] = TEACHERS.map((t, i) => ({
    id: t.id, employeeId: t.employeeId, title: t.title, firstName: t.firstName, lastName: t.lastName,
    gender: t.gender, designation: t.designation, qualification: t.qualification, specializationIds: t.specializationIds,
    email: `${t.slug}@asteracademy.edu`,
    phone: `+91 98${String(450_00_000 + i * 731_17).slice(0, 8)}`,
    joiningDate: `20${String(12 + (i % 12)).padStart(2, "0")}-06-${String(1 + (i % 20)).padStart(2, "0")}`,
    status: t.id === "t_kapoor" ? "on_leave" : "active",
    address: `${10 + i * 3}, ${LOCALITIES[i % LOCALITIES.length]}, Bengaluru`,
  }));

  const teacherAssignments: TeacherAssignment[] = [];
  for (const [subjectId, byTeacher] of Object.entries(ASSIGNMENT_PLAN)) {
    for (const [teacherId, keys] of Object.entries(byTeacher)) {
      for (const k of keys) {
        const grade = Number(k.slice(0, -1));
        const sec = k.slice(-1);
        teacherAssignments.push({ id: `ta_${teacherId}_${subjectId}_${k.toLowerCase()}`, academicYearId: AY_ID, teacherId, sectionId: sectionIdFor(grade, sec), subjectId });
      }
    }
  }
  const teacherFor = (sectionId: string, subjectId: string) =>
    teacherAssignments.find((a) => a.sectionId === sectionId && a.subjectId === subjectId)?.teacherId ?? "";

  // ------------------------------------------------------------ Students, guardians, enrollments
  const students: Student[] = [];
  const enrollments: Enrollment[] = [];
  const guardians: Guardian[] = [];
  const guardianLinks: GuardianLink[] = [];
  const usedNames = new Set<string>();
  let stuNo = 0;

  // Guardian with two children at the school (used by the guardian demo login).
  const sharmaGuardian: Guardian = {
    id: "g_sharma", name: "Priya Sharma", phone: "+91 98450 22113", email: "priya.sharma@example.com",
    occupation: "Chartered Accountant", address: "42, 5th Cross, Jayanagar, Bengaluru",
  };
  guardians.push(sharmaGuardian);

  type Fixed = { first: string; last: string; gender: "male" | "female"; id: string; guardian?: Guardian };
  const fixedStudents: Record<string, Fixed[]> = {
    "10A": [
      { first: "Aarav", last: "Sharma", gender: "male", id: "stu_aarav", guardian: sharmaGuardian },
      { first: "Rahul", last: "Kumar", gender: "male", id: "stu_rahul" },
    ],
    "8B": [{ first: "Ananya", last: "Sharma", gender: "female", id: "stu_ananya", guardian: sharmaGuardian }],
  };

  const makeGuardianFor = (last: string): { g: Guardian; relation: GuardianLink["relation"] } => {
    const isMother = rng.chance(0.45);
    const first = isMother ? rng.pick(MOTHER_FIRST) : rng.pick(FATHER_FIRST);
    const g: Guardian = {
      id: `g_${guardians.length + 1}`,
      name: `${first} ${last}`,
      phone: `+91 9${rng.int(7, 9)}${rng.int(100, 999)} ${rng.int(10000, 99999)}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      occupation: rng.pick(OCCUPATIONS),
      address: `${rng.int(1, 220)}, ${rng.pick(LOCALITIES)}, Bengaluru`,
    };
    guardians.push(g);
    return { g, relation: isMother ? "Mother" : "Father" };
  };

  for (const g of GRADES) {
    for (const s of SECTION_NAMES) {
      const k = key(g, s);
      const count = k === "10A" ? 8 : 6;
      const roster: Fixed[] = [...(fixedStudents[k] ?? [])];
      roster.forEach((f) => usedNames.add(`${f.first} ${f.last}`));
      while (roster.length < count) {
        const gender = rng.chance(0.5) ? "male" : "female";
        const first = gender === "male" ? rng.pick(MALE_FIRST) : rng.pick(FEMALE_FIRST);
        const last = rng.pick(LAST_NAMES);
        const full = `${first} ${last}`;
        if (usedNames.has(full)) continue;
        usedNames.add(full);
        roster.push({ first, last, gender, id: "" });
      }
      roster.sort((a, b) => a.first.localeCompare(b.first));
      roster.forEach((f, idx) => {
        stuNo += 1;
        const id = f.id || `stu_${String(stuNo).padStart(3, "0")}`;
        const birthYear = 2026 - g - 6;
        const locality = rng.pick(LOCALITIES);
        const admissionYear = Math.max(2016, 2026 - rng.int(0, g - 5));
        students.push({
          id,
          admissionNo: `AA-${admissionYear}-${String(stuNo).padStart(4, "0")}`,
          firstName: f.first,
          lastName: f.last,
          gender: f.gender,
          dateOfBirth: `${birthYear}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
          bloodGroup: rng.pick(BLOOD_GROUPS),
          email: `${f.first.toLowerCase()}.${f.last.toLowerCase()}@students.asteracademy.edu`,
          phone: `+91 9${rng.int(6, 9)}${rng.int(100, 999)} ${rng.int(10000, 99999)}`,
          address: f.guardian ? f.guardian.address : `${rng.int(1, 220)}, ${locality}, Bengaluru`,
          admissionDate: `${admissionYear}-04-${String(rng.int(1, 15)).padStart(2, "0")}`,
          status: "active",
          documents: [
            { id: `doc_${id}_1`, name: "Birth certificate.pdf", kind: "birth_certificate", uploadedAt: `${admissionYear}-04-02`, sizeKb: rng.int(180, 420) },
            { id: `doc_${id}_2`, name: "Aadhaar card.pdf", kind: "id_proof", uploadedAt: `${admissionYear}-04-02`, sizeKb: rng.int(90, 260) },
            ...(g >= 9 ? [{ id: `doc_${id}_3`, name: `Report card ${2025 - 1}-${String(25).slice(-2)}.pdf`, kind: "report_card" as const, uploadedAt: "2026-04-05", sizeKb: rng.int(300, 700) }] : []),
          ],
        });
        enrollments.push({ id: `enr_${id}`, studentId: id, academicYearId: AY_ID, sectionId: sectionIdFor(g, s), rollNo: idx + 1, status: "active" });
        if (f.guardian) {
          guardianLinks.push({ id: `gl_${id}`, guardianId: f.guardian.id, studentId: id, relation: "Mother", isPrimary: true });
        } else {
          const { g: guardian, relation } = makeGuardianFor(f.last);
          guardianLinks.push({ id: `gl_${id}`, guardianId: guardian.id, studentId: id, relation, isPrimary: true });
        }
      });
    }
  }
  const sectionOf = (studentId: string) => enrollments.find((e) => e.studentId === studentId)!.sectionId;
  const studentsIn = (sectionId: string) => enrollments.filter((e) => e.sectionId === sectionId).map((e) => e.studentId);
  const gradeOfSection = (sectionId: string) => Number(sectionKey(sectionId).slice(0, -1));

  // ------------------------------------------------------------ Timetable (clash-free search)
  const teachingPeriods = PERIODS.filter((p) => !p.isBreak);
  const days: Weekday[] = [1, 2, 3, 4, 5];
  const timetable = buildTimetable(sections, teachingPeriods, days, teacherFor, gradeOfSectionFn(sections, classes));

  // ------------------------------------------------------------ Student attendance
  const attendance: AttendanceSession[] = [];
  const presence: Record<string, number> = {};
  for (const st of students) {
    presence[st.id] = Math.min(0.995, Math.max(0.74, rng.normal(0.925, 0.045)));
  }
  presence["stu_aarav"] = 0.925;
  presence["stu_rahul"] = 0.96;
  const attendanceStart = "2026-07-01";
  for (let d = attendanceStart; d <= lastSchoolDay; d = addDays(d, 1)) {
    if (!isSchoolDay(d)) continue;
    if (d === "2026-08-15" || d === "2026-10-02" || d === "2026-09-14") continue; // holidays
    for (const sec of sections) {
      const entries: Record<string, AttendanceStatus> = {};
      for (const sid of studentsIn(sec.id)) {
        const r = rng.next();
        entries[sid] = r < presence[sid] - 0.03 ? "present" : r < presence[sid] ? "late" : "absent";
      }
      attendance.push({
        id: `att_${sec.id}_${d}`, sectionId: sec.id, date: d, entries,
        markedById: `u_${sec.classTeacherId ?? "admin"}`, markedAt: `${d}T09:${String(rng.int(5, 25)).padStart(2, "0")}:00.000+05:30`,
      });
    }
  }

  // Aarav's record is curated for the walkthrough (~92%).
  attendance.filter((x) => x.sectionId === "sec_10a").forEach((x, i) => {
    x.entries["stu_aarav"] = i % 12 === 5 ? "absent" : i % 31 === 9 ? "late" : "present";
  });

  // ------------------------------------------------------------ Staff attendance & leave
  const staffAttendance: StaffAttendance[] = [];
  for (let d = addDays(lastSchoolDay, -27); d <= lastSchoolDay; d = addDays(d, 1)) {
    if (!isSchoolDay(d)) continue;
    for (const t of teachers) {
      const status = t.status === "on_leave" && d >= addDays(lastSchoolDay, -3) ? "on_leave" : rng.chance(0.035) ? "absent" : "present";
      staffAttendance.push({ id: `sa_${t.id}_${d}`, teacherId: t.id, date: d, status });
    }
  }
  const leaveRequests: LeaveRequest[] = [
    { id: "lv_1", teacherId: "t_kapoor", type: "sick", fromDate: addDays(lastSchoolDay, -3), toDate: addDays(today, 4), reason: "Recovering from viral fever — medical certificate attached.", status: "approved", appliedAt: `${addDays(lastSchoolDay, -4)}T08:10:00.000+05:30` },
    { id: "lv_2", teacherId: "t_iyer", type: "casual", fromDate: addDays(today, 8), toDate: addDays(today, 9), reason: "Family function in Chennai.", status: "pending", appliedAt: `${addDays(today, -2)}T16:40:00.000+05:30` },
    { id: "lv_3", teacherId: "t_desai", type: "duty", fromDate: addDays(today, 12), toDate: addDays(today, 12), reason: "CBSE evaluator training workshop.", status: "pending", appliedAt: `${addDays(today, -1)}T11:05:00.000+05:30` },
    { id: "lv_4", teacherId: "t_verma", type: "casual", fromDate: "2026-08-21", toDate: "2026-08-21", reason: "Personal work.", status: "approved", appliedAt: "2026-08-18T10:00:00.000+05:30" },
    { id: "lv_5", teacherId: "t_joshi", type: "earned", fromDate: "2026-09-07", toDate: "2026-09-09", reason: "Travel to hometown.", status: "rejected", appliedAt: "2026-09-01T09:20:00.000+05:30" },
  ];

  // ------------------------------------------------------------ Fees
  const feeStructures: FeeStructure[] = GRADES.map((g) => {
    const f = FEE_BY_GRADE[g];
    return {
      id: `fs_${g}`, academicYearId: AY_ID, name: `Class ${g} — Annual Fee 2026–27`, classIds: [classIdFor(g)],
      components: [
        { id: `fc_${g}_tuition`, label: "Tuition fee", amount: f.tuition },
        { id: `fc_${g}_lab`, label: "Laboratory fee", amount: f.lab },
        { id: `fc_${g}_activity`, label: "Activity & sports", amount: f.activity },
        { id: `fc_${g}_exam`, label: "Examination fee", amount: f.exam },
      ],
      installments: [
        { id: "q1", label: "Quarter 1", dueDate: "2026-04-10", share: 0.25 },
        { id: "q2", label: "Quarter 2", dueDate: "2026-07-10", share: 0.25 },
        { id: "q3", label: "Quarter 3", dueDate: "2026-10-15", share: 0.25 },
        { id: "q4", label: "Quarter 4", dueDate: "2027-01-10", share: 0.25 },
      ],
      createdAt: "2026-03-15T10:00:00.000+05:30",
    };
  });
  const totalOf = (fs: FeeStructure) => fs.components.reduce((a, c) => a + c.amount, 0);

  const feeAssignments: FeeAssignment[] = [];
  const feeObligations: FeeObligation[] = [];
  const concessions: Concession[] = [];
  const payments: Payment[] = [];
  const pendingPayments: Omit<Payment, "id" | "receiptId">[] = [];
  for (const st of students) {
    const grade = gradeOfSection(sectionOf(st.id));
    const fs = feeStructures.find((f) => f.id === `fs_${grade}`)!;
    const asg: FeeAssignment = { id: `fa_${st.id}`, studentId: st.id, feeStructureId: fs.id, academicYearId: AY_ID, assignedAt: "2026-03-20T10:00:00.000+05:30" };
    feeAssignments.push(asg);
    const total = totalOf(fs);
    fs.installments.forEach((ins) => {
      feeObligations.push({ id: `fo_${st.id}_${ins.id}`, assignmentId: asg.id, studentId: st.id, label: ins.label, amount: Math.round(total * ins.share), dueDate: ins.dueDate });
    });
    let concession = 0;
    if (st.id === "stu_ananya") {
      concession = 2000;
      concessions.push({ id: `con_${st.id}`, studentId: st.id, assignmentId: asg.id, amount: 2000, reason: "Sibling concession (brother in Class 10A)", approvedBy: "u_admin", createdAt: "2026-04-02T11:00:00.000+05:30" });
    } else if (rng.chance(0.06)) {
      concession = Math.round(total * 0.1);
      concessions.push({ id: `con_${st.id}`, studentId: st.id, assignmentId: asg.id, amount: concession, reason: rng.pick(["Merit scholarship (10%)", "Staff ward concession", "Sports quota scholarship"]), approvedBy: "u_admin", createdAt: "2026-04-05T11:00:00.000+05:30" });
    }
    const net = Math.round((total - concession) * 0.25);
    const methods = ["upi", "bank_transfer", "card", "cash", "cheque"] as const;
    const pay = (amount: number, paidOn: string) =>
      pendingPayments.push({ studentId: st.id, amount, method: rng.pick(methods), reference: `TXN${rng.int(100000, 999999)}`, paidOn, recordedBy: "u_admin" });

    if (st.id === "stu_aarav") {
      pay(6000, "2026-04-06");
      pay(6000, "2026-07-08");
      pay(6000, "2026-10-03");
      continue;
    }
    if (st.id === "stu_ananya") {
      pay(net, "2026-04-06");
      pay(net, "2026-07-08");
      continue;
    }
    // Q1 — nearly everyone paid
    if (rng.chance(0.97)) pay(net, `2026-04-${String(rng.int(2, 12)).padStart(2, "0")}`);
    // Q2 — most paid, a few overdue
    const paidQ2 = rng.chance(0.86);
    if (paidQ2) pay(net, `2026-07-${String(rng.int(1, 14)).padStart(2, "0")}`);
    else if (rng.chance(0.4)) pay(Math.round(net / 2), "2026-07-20"); // partial payment
    // Q3 — due mid-October; some have paid early
    if (paidQ2 && rng.chance(0.45)) pay(net, addDays(today, -rng.int(1, 10)));
  }
  pendingPayments.sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const receipts: Receipt[] = [];
  pendingPayments.forEach((p, i) => {
    const id = `pay_${String(i + 1).padStart(4, "0")}`;
    const rid = `rcpt_${String(i + 1).padStart(4, "0")}`;
    payments.push({ ...p, id, receiptId: rid });
    receipts.push({ id: rid, receiptNo: `AA/26-27/${String(i + 1).padStart(4, "0")}`, paymentId: id, studentId: p.studentId, amount: p.amount, issuedAt: `${p.paidOn}T12:00:00.000+05:30` });
  });

  // ------------------------------------------------------------ Exams
  const exams: Exam[] = [
    { id: "ex_ut1", academicYearId: AY_ID, name: "Unit Test 1", term: "Term 1", type: "unit_test", classIds: classes.map((c) => c.id), startDate: "2026-07-20", endDate: "2026-07-25", status: "published", publishedAt: "2026-08-05T10:00:00.000+05:30" },
    { id: "ex_hy", academicYearId: AY_ID, name: "Half-Yearly Examination", term: "Term 1", type: "half_yearly", classIds: classes.map((c) => c.id), startDate: "2026-09-21", endDate: "2026-09-30", status: "marks_entry", publishedAt: null },
    { id: "ex_ut2", academicYearId: AY_ID, name: "Unit Test 2", term: "Term 2", type: "unit_test", classIds: classes.map((c) => c.id), startDate: "2026-11-16", endDate: "2026-11-21", status: "scheduled", publishedAt: null },
  ];
  const examPapers: ExamPaper[] = [];
  for (const ex of exams) {
    const max = ex.type === "half_yearly" ? 80 : 50;
    for (const c of classes) {
      SUBJECTS.forEach((sub, i) => {
        let date = ex.startDate;
        for (let n = 0; n < i; ) { date = addDays(date, 1); if (dayOfWeek(date) !== 0) n++; }
        examPapers.push({
          id: `ep_${ex.id}_${c.grade}_${sub.code.toLowerCase()}`, examId: ex.id, classId: c.id, subjectId: sub.id, date,
          startTime: ex.type === "half_yearly" ? "09:30" : "09:00", endTime: ex.type === "half_yearly" ? "12:30" : "10:30",
          maxMarks: max, passMarks: Math.round(max * 0.33),
        });
      });
    }
  }
  const ability: Record<string, number> = {};
  students.forEach((s) => (ability[s.id] = Math.min(96, Math.max(42, rng.normal(72, 12)))));
  const subjectBias: Record<string, number> = { sub_math: -3, sub_sci: -1, sub_eng: 3, sub_cs: 4, sub_sst: 0, sub_hin: 2 };
  const fixedPct: Record<string, Record<string, Record<string, number>>> = {
    stu_aarav: {
      ex_ut1: { sub_math: 84, sub_sci: 91, sub_eng: 78, sub_cs: 88, sub_sst: 74, sub_hin: 80 },
      ex_hy: { sub_sci: 87.5, sub_eng: 81.25, sub_cs: 92.5, sub_sst: 76.25, sub_hin: 82.5 },
    },
  };
  const marks: Mark[] = [];
  for (const paper of examPapers) {
    const ex = exams.find((e) => e.id === paper.examId)!;
    if (ex.status === "scheduled") continue;
    const sectionIds = sections.filter((s) => s.classId === paper.classId).map((s) => s.id);
    for (const secId of sectionIds) {
      // Half-yearly marks for Mathematics in 10A are still pending from Mr. Verma.
      if (ex.id === "ex_hy" && paper.subjectId === "sub_math" && secId === "sec_10a") continue;
      if (ex.id === "ex_hy" && paper.subjectId === "sub_hin" && secId === "sec_12c") continue;
      const enteredBy = `u_${teacherFor(secId, paper.subjectId)}`;
      for (const sid of studentsIn(secId)) {
        const fixed = fixedPct[sid]?.[ex.id]?.[paper.subjectId];
        const absent = fixed === undefined && rng.chance(0.012);
        const pct = fixed ?? Math.min(100, Math.max(18, rng.normal(ability[sid] + subjectBias[paper.subjectId], 7)));
        const m = absent ? null : Math.round((pct / 100) * paper.maxMarks * 2) / 2;
        marks.push({ id: `mk_${paper.id}_${sid}`, paperId: paper.id, studentId: sid, marks: m, absent, enteredBy, updatedAt: `${addDays(ex.endDate, 6)}T15:00:00.000+05:30` });
      }
    }
  }

  // ------------------------------------------------------------ Homework & submissions
  const homework: Homework[] = [];
  const submissions: HomeworkSubmission[] = [];
  const hwFixed: Homework[] = [
    { id: "hw_10a_math", title: "Quadratic Equations — Exercise 4.3", description: HOMEWORK_TEMPLATES.sub_math[0].description, subjectId: "sub_math", sectionId: "sec_10a", teacherId: "t_verma", assignedOn: addDays(today, -2), dueDate: addDays(today, 3), attachmentName: "Exercise-4.3.pdf", status: "active" },
    { id: "hw_10a_sci", title: "Chemical reactions & equations worksheet", description: HOMEWORK_TEMPLATES.sub_sci[0].description, subjectId: "sub_sci", sectionId: "sec_10a", teacherId: "t_verma", assignedOn: addDays(today, -4), dueDate: addDays(today, 1), attachmentName: "Chem-reactions-worksheet.pdf", status: "active" },
    { id: "hw_10a_eng", title: "Essay: Technology in the classroom", description: HOMEWORK_TEMPLATES.sub_eng[0].description, subjectId: "sub_eng", sectionId: "sec_10a", teacherId: "t_rao", assignedOn: addDays(today, -9), dueDate: addDays(today, -2), attachmentName: null, status: "active" },
    { id: "hw_10b_math", title: "Arithmetic Progressions worksheet", description: HOMEWORK_TEMPLATES.sub_math[1].description, subjectId: "sub_math", sectionId: "sec_10b", teacherId: "t_verma", assignedOn: addDays(today, -3), dueDate: addDays(today, 4), attachmentName: "AP-worksheet.pdf", status: "active" },
    { id: "hw_9a_math", title: "Coordinate Geometry problem set", description: HOMEWORK_TEMPLATES.sub_math[2].description, subjectId: "sub_math", sectionId: "sec_9a", teacherId: "t_verma", assignedOn: addDays(today, -6), dueDate: addDays(today, -1), attachmentName: null, status: "active" },
  ];
  homework.push(...hwFixed);
  for (const sec of sections) {
    const count = sec.id === "sec_10a" ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const sub = SUBJECTS[(sections.indexOf(sec) + i * 2 + 2) % SUBJECTS.length];
      if (homework.some((h) => h.sectionId === sec.id && h.subjectId === sub.id)) continue;
      const tpl = rng.pick(HOMEWORK_TEMPLATES[sub.id]);
      const assigned = addDays(today, -rng.int(1, 8));
      homework.push({ id: `hw_${sec.id}_${sub.code.toLowerCase()}_${i}`, title: tpl.title, description: tpl.description, subjectId: sub.id, sectionId: sec.id, teacherId: teacherFor(sec.id, sub.id), assignedOn: assigned, dueDate: addDays(assigned, rng.int(4, 9)), attachmentName: null, status: "active" });
    }
  }
  for (const hw of homework) {
    for (const sid of studentsIn(hw.sectionId)) {
      if (sid === "stu_aarav" && hw.id !== "hw_10a_eng") continue; // Aarav still has work pending
      const pastDue = hw.dueDate < today;
      if (!rng.chance(pastDue ? 0.85 : 0.35) && !(sid === "stu_aarav")) continue;
      const late = pastDue && rng.chance(0.1);
      let subAt = late ? addDays(hw.dueDate, 1) : addDays(hw.assignedOn, rng.int(1, 3));
      if (!late && subAt > hw.dueDate) subAt = hw.dueDate;
      if (subAt > today) subAt = today;
      submissions.push({
        id: `sub_${hw.id}_${sid}`, homeworkId: hw.id, studentId: sid, submittedAt: `${subAt}T18:${String(rng.int(10, 59))}:00.000+05:30`,
        content: "Completed all questions. Working shown in the attached file.", attachmentName: rng.chance(0.6) ? "my-work.pdf" : null,
        status: pastDue && rng.chance(0.5) ? "reviewed" : late ? "late" : "submitted", feedback: null,
      });
    }
  }

  // ------------------------------------------------------------ Notices
  const notices: Notice[] = [
    { id: "nt_ptm", title: "Parent–Teacher Meeting — Term 1", body: "The Term 1 Parent–Teacher Meeting will be held in respective classrooms from 9:00 AM to 1:00 PM. Half-yearly answer scripts will be shown to parents. Please carry the student ID card.", type: "event", audience: { scope: "school" }, publishDate: addDays(today, -1), eventDate: nextSchoolDayAfter(addDays(today, 12)), priority: "high", status: "published", createdBy: "u_admin" },
    { id: "nt_fee_q3", title: "Quarter 3 fee installment due on 15 October", body: "This is a reminder that the Quarter 3 fee installment is due on 15 October 2026. Payments can be made at the school office or online via UPI / net banking. A late fee applies after the due date.", type: "notice", audience: { scope: "students" }, publishDate: addDays(today, -3), eventDate: "2026-10-15", priority: "urgent", status: "published", createdBy: "u_admin" },
    { id: "nt_sci_expo", title: "Class 10 Science Exhibition — project submission", body: "All Class 10 students must submit their Science Exhibition project abstracts to their Science teacher. Teams of up to three students are allowed.", type: "notice", audience: { scope: "classes", classIds: ["cls_10"] }, publishDate: addDays(today, -2), eventDate: addDays(today, 9), priority: "normal", status: "published", createdBy: "u_admin" },
    { id: "nt_10a_extra", title: "10A: Extra Mathematics class on Saturday", body: "An extra Mathematics revision class for Class 10A will be held on Saturday from 9:30 AM to 11:00 AM in Room 115. Attendance is strongly recommended before Unit Test 2.", type: "notice", audience: { scope: "sections", sectionIds: ["sec_10a"] }, publishDate: addDays(today, -1), eventDate: addDays(today, 6), priority: "normal", status: "published", createdBy: "u_admin" },
    { id: "nt_field_8", title: "Class 8 field trip to Visvesvaraya Museum", body: "Class 8 students will visit the Visvesvaraya Industrial and Technological Museum. Consent forms must be returned to the class teacher.", type: "event", audience: { scope: "classes", classIds: ["cls_8"] }, publishDate: addDays(today, -4), eventDate: addDays(today, 16), priority: "normal", status: "published", createdBy: "u_admin" },
    { id: "nt_quiz", title: "Inter-house Quiz Competition", body: "The annual inter-house quiz will be held in the auditorium. Each house may nominate four participants from Classes 8–12.", type: "event", audience: { scope: "students" }, publishDate: addDays(today, -6), eventDate: addDays(today, 20), priority: "low", status: "published", createdBy: "u_admin" },
    { id: "nt_staff", title: "Staff meeting — half-yearly result moderation", body: "All teaching staff are requested to attend the result moderation meeting in the conference room at 3:00 PM. Please complete pending half-yearly marks entry before the meeting.", type: "notice", audience: { scope: "teachers" }, publishDate: addDays(today, -1), eventDate: addDays(today, 2), priority: "high", status: "published", createdBy: "u_admin" },
    { id: "nt_diwali", title: "Diwali vacation", body: "The school will remain closed for Diwali vacation. Classes resume on the following Monday.", type: "holiday", audience: { scope: "school" }, publishDate: addDays(today, -5), eventDate: "2026-11-07", priority: "normal", status: "published", createdBy: "u_admin" },
    { id: "nt_gandhi", title: "Gandhi Jayanti — school closed", body: "The school remained closed on 2 October on account of Gandhi Jayanti.", type: "holiday", audience: { scope: "school" }, publishDate: "2026-09-28", eventDate: "2026-10-02", priority: "low", status: "published", createdBy: "u_admin" },
    { id: "nt_sports", title: "Annual Sports Day", body: "Annual Sports Day will be held at the school grounds. House-wise practice sessions begin next week.", type: "event", audience: { scope: "school" }, publishDate: addDays(today, -8), eventDate: "2026-12-12", priority: "normal", status: "published", createdBy: "u_admin" },
    { id: "nt_winter", title: "Winter uniform from 1 November", body: "Students are required to wear the winter uniform (blazer and full sleeves) from 1 November.", type: "notice", audience: { scope: "students" }, publishDate: addDays(today, 5), eventDate: "2026-11-01", priority: "low", status: "draft", createdBy: "u_admin" },
  ];

  // ------------------------------------------------------------ Accounts
  const users: UserAccount[] = [
    { id: "u_admin", email: "admin@asteracademy.edu", password: DEMO_PASSWORDS.admin, role: "admin", displayName: "Aanya Jain", phone: "+91 98450 10001", title: "Principal" },
  ];
  for (const t of teachers) {
    const isDemo = t.id === "t_verma";
    users.push({ id: `u_${t.id}`, email: isDemo ? "teacher@asteracademy.edu" : t.email, password: isDemo ? DEMO_PASSWORDS.teacher : DEMO_PASSWORDS.default, role: "teacher", displayName: `${t.firstName} ${t.lastName}`, phone: t.phone, teacherId: t.id });
  }
  for (const s of students) {
    const isDemo = s.id === "stu_aarav";
    users.push({ id: `u_${s.id}`, email: isDemo ? "student@asteracademy.edu" : s.email, password: isDemo ? DEMO_PASSWORDS.student : DEMO_PASSWORDS.default, role: "student", displayName: `${s.firstName} ${s.lastName}`, phone: s.phone, studentIds: [s.id] });
  }
  users.push({ id: "u_guardian_sharma", email: "guardian@asteracademy.edu", password: DEMO_PASSWORDS.guardian, role: "student", displayName: "Priya Sharma", phone: sharmaGuardian.phone, studentIds: ["stu_aarav", "stu_ananya"], guardianId: "g_sharma" });

  // ------------------------------------------------------------ Notifications
  const ts = (daysAgo: number, hh: number, mm = 0) => `${addDays(today, -daysAgo)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000+05:30`;
  let nId = 0;
  const n = (userId: string, category: AppNotification["category"], title: string, message: string, createdAt: string, read: boolean, href: string | null): AppNotification =>
    ({ id: `nf_${++nId}`, userId, category, title, message, createdAt, read, href });
  const notifications: AppNotification[] = [
    n("u_admin", "general", "Leave request from Meera Iyer", "Casual leave requested for 2 days. Awaiting your approval.", ts(2, 16, 42), false, "/admin/teachers?tab=leave"),
    n("u_admin", "general", "Leave request from Rohan Desai", "Duty leave requested for CBSE evaluator training.", ts(1, 11, 6), false, "/admin/teachers?tab=leave"),
    n("u_admin", "examination", "Half-Yearly marks entry incomplete", "2 papers are still awaiting marks before results can be published.", ts(1, 9, 0), false, "/admin/examinations"),
    n("u_admin", "fees", "Quarter 3 fees due on 15 October", "Reminder sent to all students with pending Quarter 3 installments.", ts(3, 10, 15), true, "/admin/fees"),
    n("u_admin", "attendance", "Attendance summary ready", "All 15 sections marked attendance on the last school day.", ts(2, 10, 0), true, "/admin/attendance"),
    n("u_t_verma", "attendance", "Mark today's attendance for 10A", "You are the class teacher for Class 10A.", ts(0, 8, 45), false, "/teacher/attendance"),
    n("u_t_verma", "examination", "Half-Yearly: Mathematics 10A marks pending", "Please enter marks before the moderation meeting.", ts(1, 9, 0), false, "/teacher/examinations"),
    n("u_t_verma", "notice", "Staff meeting — result moderation", "Conference room, 3:00 PM.", ts(1, 12, 0), false, "/teacher/notices"),
    n("u_t_verma", "homework", "New submissions: Coordinate Geometry", "Students from 9A have submitted their work.", ts(1, 19, 30), true, "/teacher/homework"),
    n("u_stu_aarav", "homework", "New homework: Quadratic Equations", "Mathematics — due in 3 days.", ts(2, 14, 5), false, "/student/homework"),
    n("u_stu_aarav", "notice", "10A: Extra Mathematics class on Saturday", "Room 115, 9:30 AM.", ts(1, 13, 0), false, "/student/notices"),
    n("u_stu_aarav", "fees", "Payment received — ₹6,000", "Receipt generated for your Quarter 3 installment.", `${addDays(today, -8)}T12:00:00.000+05:30`, true, "/student/fees"),
    n("u_stu_aarav", "examination", "Unit Test 1 results published", "Your overall grade is A2.", "2026-08-05T10:00:00.000+05:30", true, "/student/results"),
    n("u_guardian_sharma", "fees", "Quarter 3 fee due for Ananya", "₹4,500 due on 15 October.", ts(3, 10, 15), false, "/student/fees"),
    n("u_guardian_sharma", "homework", "New homework for Aarav", "Mathematics — Quadratic Equations, due in 3 days.", ts(2, 14, 5), false, "/student/homework"),
    n("u_guardian_sharma", "notice", "Parent–Teacher Meeting — Term 1", "Held in respective classrooms, 9:00 AM–1:00 PM.", ts(1, 9, 30), false, "/student/notices"),
  ];

  return {
    version: DB_VERSION,
    seededAt: nowIso,
    school: {
      name: "Aster Academy",
      shortName: "Aster",
      tagline: "Learn · Lead · Light the way",
      address: "18 Lalbagh Road, Basavanagudi, Bengaluru 560004",
      phone: "+91 80 4110 2026",
      email: "office@asteracademy.edu",
      website: "www.asteracademy.edu",
      affiliation: "CBSE Affiliation No. 830417",
      principalName: "Aanya Jain",
      currentAcademicYearId: AY_ID,
      settings: {
        attendanceLateCountsAsPresent: true,
        lowAttendanceThreshold: 85,
        passPercentage: 33,
        currency: "INR",
        weekStartsOn: 1,
        notifications: { attendanceAlerts: true, feeReminders: true, homeworkAlerts: true, examAlerts: true, noticeAlerts: true },
      },
    },
    academicYears, classes, sections, subjects: SUBJECTS, teacherAssignments, students, enrollments, guardians, guardianLinks,
    teachers, staffAttendance, leaveRequests, attendance, feeStructures, feeAssignments, feeObligations, concessions,
    payments, receipts, exams, examPapers, marks, periods: PERIODS, timetable, homework, submissions, notices, notifications, users,
  };
}

function nextSchoolDayAfter(d: string) {
  let cur = d;
  while (!isSchoolDay(cur)) cur = addDays(cur, 1);
  return cur;
}

function gradeOfSectionFn(sections: Section[], classes: SchoolClass[]) {
  return (sectionId: string) => classes.find((c) => c.id === sections.find((s) => s.id === sectionId)?.classId)?.grade ?? 0;
}

/**
 * Fills every section's week so that no teacher is double-booked.
 * Randomised greedy with restarts — deterministic because of the seeded RNG.
 */
function buildTimetable(
  sections: Section[], periods: Period[], days: Weekday[], teacherFor: (sectionId: string, subjectId: string) => string, gradeOf: (sectionId: string) => number,
): TimetableEntry[] {
  const rng = createRng(4242);
  let best: TimetableEntry[] = [];
  for (let attempt = 0; attempt < 300; attempt++) {
    const out: TimetableEntry[] = [];
    const busy = new Set<string>();
    const quota: Record<string, Record<string, number>> = {};
    const perDay: Record<string, Record<string, number>> = {};
    sections.forEach((s) => (quota[s.id] = { ...WEEKLY_QUOTA }));
    for (const day of days) {
      sections.forEach((s) => (perDay[s.id] = {}));
      for (const p of periods) {
        const order = shuffle(sections, rng);
        for (const sec of order) {
          const pinned = sec.id === "sec_10a" && day === 1 && p.index === 1 ? "sub_math" : null;
          const tiebreak = Object.fromEntries(SUBJECTS.map((s) => [s.id, rng.next()]));
          const candidates = SUBJECTS.map((s) => s.id)
            .filter((sub) => quota[sec.id][sub] > 0 && !busy.has(`${teacherFor(sec.id, sub)}|${day}|${p.index}`))
            .sort((a, b) => (perDay[sec.id][a] ?? 0) - (perDay[sec.id][b] ?? 0) || quota[sec.id][b] - quota[sec.id][a] || tiebreak[a] - tiebreak[b]);
          const choice = pinned && candidates.includes(pinned) ? pinned : candidates[0];
          if (!choice) continue;
          const teacherId = teacherFor(sec.id, choice);
          busy.add(`${teacherId}|${day}|${p.index}`);
          quota[sec.id][choice] -= 1;
          perDay[sec.id][choice] = (perDay[sec.id][choice] ?? 0) + 1;
          out.push({
            id: `tt_${sec.id}_${day}_${p.index}`, academicYearId: AY_ID, sectionId: sec.id, subjectId: choice, teacherId, day, period: p.index,
            startTime: p.startTime, endTime: p.endTime,
            room: choice === "sub_cs" && gradeOf(sec.id) >= 11 ? `Computer Lab · ${sec.room}` : sec.room,
          });
        }
      }
    }
    repairTimetable(out, sections, periods, days, quota, busy, teacherFor);
    if (out.length > best.length) best = out;
    if (out.length === sections.length * days.length * periods.length) break;
  }
  // Walkthrough pin: Class 10A starts Monday with Mathematics.
  const first = best.find((e) => e.sectionId === "sec_10a" && e.day === 1 && e.period === 1);
  if (first && first.subjectId !== "sub_math") {
    const isBusy = (teacherId: string, day: number, period: number, ignore: TimetableEntry[]) =>
      best.some((e) => !ignore.includes(e) && e.teacherId === teacherId && e.day === day && e.period === period);
    const math = best.find((e) => e.sectionId === "sec_10a" && e.subjectId === "sub_math" && !isBusy(e.teacherId, 1, 1, [first]) && !isBusy(first.teacherId, e.day, e.period, [e]));
    if (math) {
      const a = { subjectId: first.subjectId, teacherId: first.teacherId, room: first.room };
      Object.assign(first, { subjectId: math.subjectId, teacherId: math.teacherId, room: math.room });
      Object.assign(math, a);
    }
  }
  return best;
}

/** Fills leftover gaps by swapping a lesson within the same section. */
function repairTimetable(
  out: TimetableEntry[], sections: Section[], periods: Period[], days: Weekday[],
  quota: Record<string, Record<string, number>>, busy: Set<string>, teacherFor: (sectionId: string, subjectId: string) => string,
) {
  for (const sec of sections) {
    for (const day of days) {
      for (const p of periods) {
        if (out.some((e) => e.sectionId === sec.id && e.day === day && e.period === p.index)) continue;
        const needed = Object.keys(quota[sec.id]).find((sub) => quota[sec.id][sub] > 0);
        if (!needed) continue;
        const tNeeded = teacherFor(sec.id, needed);
        // Find a lesson X in this section whose teacher is free in the gap, at a slot where tNeeded is free.
        const swap = out.find((e) => e.sectionId === sec.id && !busy.has(`${e.teacherId}|${day}|${p.index}`) && !busy.has(`${tNeeded}|${e.day}|${e.period}`));
        if (!swap) continue;
        busy.delete(`${swap.teacherId}|${swap.day}|${swap.period}`);
        busy.add(`${swap.teacherId}|${day}|${p.index}`);
        busy.add(`${tNeeded}|${swap.day}|${swap.period}`);
        out.push({ ...swap, id: `tt_${sec.id}_${day}_${p.index}`, day, period: p.index, startTime: p.startTime, endTime: p.endTime });
        Object.assign(swap, { subjectId: needed, teacherId: tNeeded });
        quota[sec.id][needed] -= 1;
      }
    }
  }
}

/** Deterministic Fisher–Yates shuffle (never sort with a random comparator). */
function shuffle<T>(arr: readonly T[], rng: { next: () => number }): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

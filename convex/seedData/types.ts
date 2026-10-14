/**
 * Shape of a seed dataset. A dataset is pure data — the seeding code in
 * convex/seed.ts is generic and must never branch on a school's name.
 * Keys (teacher `key`, student `key`, section labels like "10-A") are only
 * used to wire relationships inside the dataset.
 */
/** A demo sign-in: Login ID + password. Development/demo only. */
export type SeedLogin = { loginId: string; password: string };

export type SeedDataset = {
  school: {
    name: string; slug: string; shortName: string; code: string; timezone: string; locale: string; currency: string;
    tagline?: string; address?: string; phone?: string; email?: string; website?: string; affiliation?: string;
  };
  settings: {
    workingDays: number[];
    attendance: { lateCountsAsPresent: boolean; lowAttendanceThreshold: number };
    grading: { scheme: string; passPercentage: number };
  };
  academicYear: { name: string; startDate: string; endDate: string };
  classes: { name: string; level: number; sections: string[] }[];
  subjects: { name: string; code: string }[];
  admin: { displayName: string; email: string; login: SeedLogin };
  teachers: {
    key: string; title: string; firstName: string; lastName: string; gender: "male" | "female";
    email: string; designation: string; qualification: string; subjects: string[]; joiningDate: string; login?: SeedLogin;
  }[];
  /** section label → teacher key */
  classTeachers: Record<string, string>;
  /** section label → subject code → teacher key */
  assignments: Record<string, Record<string, string>>;
  students: {
    key: string; firstName: string; lastName: string; gender: "male" | "female"; dateOfBirth: string;
    section: string; rollNo: number; email: string; login?: SeedLogin;
  }[];
  guardians: {
    key: string; name: string; phone: string; email: string; occupation?: string;
    links: { student: string; relationship: string; isPrimary: boolean }[];
    login?: SeedLogin;
  }[];
  feeStructures: {
    name: string; classLevels: number[];
    components: { label: string; amountMinor: number }[];
    installments: { label: string; dueDate: string; share: number }[];
  }[];
  payments: { student: string; installments: number; method: "cash" | "upi" | "card" | "bank_transfer" | "cheque" | "online"; daysAgo: number }[];
  concessions: { student: string; percent: number; reason: string }[];
  exams: {
    name: string; term: string; classLevels: number[]; startDate: string; endDate: string; status: "draft" | "scheduled" | "marks_entry" | "published";
    subjects: string[]; maxMarks: number; passMarks: number;
  }[];
  holidays: { title: string; date: string }[];
  notices: { title: string; body: string; type: "notice" | "event" | "holiday"; priority: "normal" | "high" | "urgent"; audience: { kind: "all" } | { kind: "sections"; sections: string[] }; daysAgo: number }[];
  homework: { section: string; subject: string; title: string; description: string; dueInDays: number }[];
  /** Weekly timetable for selected sections: day (1=Mon) → subject codes by period. */
  timetables: Record<string, Record<number, string[]>>;
  periods: { start: string; end: string }[];
  /** How many past school days of attendance to generate per section. */
  attendanceDays: number;
};

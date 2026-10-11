/**
 * Product identity — the reusable platform, NOT a particular school.
 *
 * "Smart School Management System" is the product. The school using it (the
 * tenant) is data: its name, contact details and email domain live in
 * `Database.school` and are read through `services.school.getPublicProfile()`.
 * In Stage 1 the seeded tenant is the fictional demo school "Aster Academy".
 */
export const PRODUCT = {
  name: "Smart School Management System",
  shortName: "Smart School",
  description: "A role-based school management platform — students, academics, attendance, fees, examinations, timetable, homework and notices.",
} as const;

/** Browser-storage namespace for the Stage 1 mock persistence (product-level, not tenant-level). */
export const STORAGE_NAMESPACE = "ssms";

/**
 * Product identity — the reusable platform, NOT a particular school.
 *
 * "Atrium" is the product. The school using it (the tenant) is data: its name,
 * contact details and email domain live in `Database.school` and are read
 * through `services.school.getPublicProfile()`. In Stage 1 the seeded tenant is
 * the fictional demo school "Aster Academy".
 */
export const PRODUCT = {
  name: "Atrium",
  shortName: "Atrium",
  tagline: "The school, in one place",
  description: "Atrium runs your school from one place: students, attendance, fees, exams, timetable, homework and notices. Type what you need and go straight there.",
} as const;

/** Browser-storage namespace for the Stage 1 mock persistence (product-level, not tenant-level). Kept stable across the rename. */
export const STORAGE_NAMESPACE = "ssms";

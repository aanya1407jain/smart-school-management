import type { Id } from "@convex/_generated/dataModel";

export type LiveSection = { _id: Id<"sections">; classId: Id<"classes">; name: string; displayName: string; isClassTeacher: boolean };

/**
 * Which section the register shows. Only a section the SERVER lists for the
 * caller (academics.listSections — admins: all, teachers: their scope) can be
 * selected, so the register query only ever receives a real Convex section id.
 * `?section=` accepts that id or the section's label (e.g. "10-A"); anything
 * else is ignored.
 */
export function pickSection(sections: readonly LiveSection[], requested: string | null, overview?: readonly { sectionId: string; isClassTeacher: boolean; marked: boolean }[]): LiveSection | null {
  if (requested) {
    const hit = sections.find((s) => s._id === requested) ?? sections.find((s) => s.displayName.toLowerCase() === requested.trim().toLowerCase());
    if (hit) return hit;
  }
  const preferred = overview?.find((r) => r.isClassTeacher) ?? overview?.find((r) => !r.marked);
  return (preferred && sections.find((s) => s._id === preferred.sectionId)) ?? sections.find((s) => s.isClassTeacher) ?? sections[0] ?? null;
}

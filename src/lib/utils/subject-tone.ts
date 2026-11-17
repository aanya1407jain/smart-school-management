/** A colour per subject (dot + chip classes), so timetables read at a glance. Same mapping everywhere. */
export function subjectTone(subject: string): { dot: string; chip: string } {
  const s = subject.toLowerCase();
  if (s.includes("math")) return { dot: "bg-[#2563EB]", chip: "bg-[#E5EDFF] text-[#2563EB]" };
  if (s.includes("social")) return { dot: "bg-[#B26A00]", chip: "bg-[#FFF0D3] text-[#B26A00]" };
  if (s.includes("science")) return { dot: "bg-[#15803D]", chip: "bg-[#E1F5E7] text-[#15803D]" };
  if (s.includes("english")) return { dot: "bg-[#C2410C]", chip: "bg-[#FFEBD9] text-[#C2410C]" };
  if (s.includes("hindi") || s.includes("sanskrit")) return { dot: "bg-[#7C3AED]", chip: "bg-[#F1E9FF] text-[#7C3AED]" };
  if (s.includes("computer")) return { dot: "bg-[#0E7C86]", chip: "bg-[#DDF3F4] text-[#0E7C86]" };
  if (s.includes("sport") || s.includes("physical")) return { dot: "bg-[#DB2777]", chip: "bg-[#FDE7F1] text-[#DB2777]" };
  return { dot: "bg-[#475569]", chip: "bg-[#ECEFF3] text-[#475569]" };
}

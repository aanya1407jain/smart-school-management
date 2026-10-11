import type { Metadata } from "next";
import { MyClasses } from "@/features/teachers/my-classes";

export const metadata: Metadata = { title: "My Classes" };
export default function Page() {
  return <MyClasses />;
}

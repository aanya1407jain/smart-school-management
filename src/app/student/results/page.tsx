import type { Metadata } from "next";
import { MyResults } from "@/features/examinations/my-results";

export const metadata: Metadata = { title: "My Results" };
export default function Page() {
  return <MyResults />;
}

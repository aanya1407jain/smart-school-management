import type { Metadata } from "next";
import { MyHomework } from "@/features/homework/my-homework";

export const metadata: Metadata = { title: "My Homework" };
export default function Page() {
  return <MyHomework />;
}

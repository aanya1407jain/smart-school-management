import { NotFoundState } from "@/components/ui/states";

export default function NotFound() {
  return <div className="solid-card mx-auto mt-6 max-w-xl"><NotFoundState message="This page doesn't exist in your workspace." /></div>;
}

import { AlertCircle } from "lucide-react";

export function FormError({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-purple/25 bg-blush/40 px-3.5 py-3 text-[13px] text-plum">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{error.message}</span>
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Select } from "./form";

/** Horizontal filter row that wraps on small screens. */
export function FilterBar({ children, className, actions }: { children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row lg:items-center", className)}>
      {/* One column on the narrowest phones so dates and long option labels are not clipped. */}
      <div className="grid flex-1 grid-cols-1 gap-2.5 max-[359px]:[&>*]:col-span-1 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">{children}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FilterSelect({
  label, value, onChange, options, allLabel, className,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string; className?: string }) {
  return (
    <div className={cn("min-w-0 sm:w-auto", className)}>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 sm:min-w-[150px]">
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );
}

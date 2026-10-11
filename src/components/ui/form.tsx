import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, cloneElement, isValidElement, type ReactElement } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const control =
  "w-full rounded-xl border bg-white/85 px-3.5 text-sm text-ink placeholder:text-ink-muted/70 transition-colors " +
  "focus:outline-none focus:border-teal focus:shadow-focus disabled:cursor-not-allowed disabled:bg-alabaster disabled:text-ink-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props }, ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-10", invalid ? "border-plum/60" : "border-line", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, rows = 4, ...props }, ref,
) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={cn(control, "py-2.5 leading-relaxed", invalid ? "border-plum/60" : "border-line", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...props }, ref,
) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-10 appearance-none pr-9", invalid ? "border-plum/60" : "border-line", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
    </div>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }>(function Checkbox(
  { label, description, className, id, ...props }, ref,
) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className={cn("flex cursor-pointer items-start gap-2.5 text-sm text-ink", className)}>
      <input ref={ref} id={cid} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-heather accent-lagoon" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {description && <span className="block text-[13px] text-ink-muted">{description}</span>}
      </span>
    </label>
  );
});

/**
 * Label + control + hint/error. Pass a single control as the child; the
 * field wires up id, aria-describedby and aria-invalid automatically.
 */
export function FormField({
  label, required, hint, error, children, className,
}: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: string; children: ReactElement; className?: string }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, invalid: !!error, "aria-required": required || undefined })
    : children;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-plum" aria-hidden>*</span>}
      </label>
      {child}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1 text-[12.5px] font-medium text-plum" role="alert">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("grid gap-4 border-t border-line/70 pt-5 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr] md:gap-8", className)}>
      <legend className="sr-only">{title}</legend>
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

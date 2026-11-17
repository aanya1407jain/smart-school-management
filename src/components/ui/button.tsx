import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "accent" | "soft";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  // Solid accent for the main action (white on #0F766E: 5.5:1).
  // Evergreen with a top highlight: the one primary action per view.
  primary: "bg-primary text-primary-fg shadow-button hover:bg-primary-hover",
  secondary: "bg-surface text-ink shadow-card hover:bg-surface-2",
  accent: "bg-marigold text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(154_91_0/0.3)] hover:bg-[#E9960F]",
  outline: "bg-surface text-ink shadow-card hover:bg-surface-2",
  ghost: "text-ink-soft hover:bg-ink/5 hover:text-ink",
  soft: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  // Destructive actions stay visibly distinct: semantic red.
  danger: "bg-pd-danger text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-pd-danger/90",
};
const sizes: Record<Size, string> = {
  sm: "h-8 max-sm:h-9 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-9 max-sm:h-11 px-3.5 text-[13.5px] gap-2 rounded-[10px]",
  lg: "h-11 px-5 text-[14.5px] gap-2 rounded-xl",
  icon: "h-9 w-9 max-sm:h-11 max-sm:w-11 rounded-[10px]",
  "icon-sm": "h-8 w-8 max-sm:h-10 max-sm:w-10 rounded-[9px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    // Quiet colour transition and a slight press; clear focus ring.
    "inline-flex select-none items-center justify-center font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150",
    "active:scale-[.97] disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-none focus-visible:shadow-focus",
    variants[variant],
    sizes[size],
    className,
  );
}

/** A navigation link styled as a button (never nest <button> inside <a>). */
export function LinkButton({ href, variant, size, className, children, onClick }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; onClick?: () => void }) {
  return <Link href={href} onClick={onClick} className={buttonClass(variant, size, className)}>{children}</Link>;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

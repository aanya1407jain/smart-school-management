import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "accent" | "soft";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  // Solid accent for the main action (white on #0F766E: 5.5:1).
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "bg-sapphire text-white hover:bg-sapphire/90",
  accent: "bg-primary text-primary-fg hover:bg-primary-hover",
  outline: "border border-line bg-white text-ink hover:border-ink-muted/40 hover:bg-bg",
  ghost: "text-ink-soft hover:bg-teal-soft/60 hover:text-lagoon",
  soft: "bg-teal-soft text-lagoon hover:bg-teal/15",
  // Destructive actions stay visibly distinct: semantic red (white on #B42318: 6.6:1).
  danger: "bg-pd-danger text-white hover:bg-pd-danger/90",
};
const sizes: Record<Size, string> = {
  sm: "h-8 max-sm:h-9 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 max-sm:h-11 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-10 w-10 max-sm:h-11 max-sm:w-11 rounded-xl",
  "icon-sm": "h-8 w-8 max-sm:h-10 max-sm:w-10 rounded-lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    // Quiet colour transition and a slight press; clear focus ring.
    "inline-flex select-none items-center justify-center font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150",
    "active:scale-[.98] disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-none focus-visible:shadow-focus",
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

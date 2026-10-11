"use client";
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, GraduationCap, Presentation, ShieldCheck, ChevronDown, ArrowRight, MailCheck } from "lucide-react";
import type { Role } from "@/types/domain";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useSession } from "./session-provider";
import { services } from "@/lib/services";
import { canAccessRoute, homeRouteFor } from "@/lib/permissions";
import { cn } from "@/lib/utils/cn";
import { DEMO_ACCOUNTS } from "./demo-accounts";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";
import { PRODUCT } from "@/lib/constants/product";

const schema = z.object({
  role: z.enum(["admin", "teacher", "student"]),
  email: z.string().trim().min(1, "Enter your email or username").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const ROLES: { value: Role; label: string; hint: string; Icon: typeof ShieldCheck }[] = [
  { value: "admin", label: "Admin / Principal", hint: "School administration", Icon: ShieldCheck },
  { value: "teacher", label: "Teacher", hint: "Classes & teaching", Icon: Presentation },
  { value: "student", label: "Student", hint: "Students & guardians", Icon: GraduationCap },
];

export function LoginScreen() {
  const school = useSchoolProfile();
  const router = useRouter();
  const params = useSearchParams();
  const { login, status, user } = useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: "admin", email: "", password: "", remember: true },
  });
  const role = watch("role");

  // Already signed in → straight to the right workspace.
  useEffect(() => {
    if (status === "authenticated" && user) router.replace(homeRouteFor(user));
  }, [status, user, router]);

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      const u = await login(values);
      const next = params.get("next");
      router.replace(next && canAccessRoute(u, next) === "allowed" ? next : homeRouteFor(u));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-10">
      {/* Very subtle ambient shapes */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-24 h-[420px] w-[420px] rounded-full bg-lavender/35 blur-[90px]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-1/4 h-[360px] w-[360px] rounded-full bg-blush/50 blur-[90px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-[380px] w-[380px] rounded-full bg-teal/20 blur-[90px]" />

      <motion.div initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }} className="relative w-full max-w-[460px]">
        <div className="glass rounded-[28px] px-6 pb-7 pt-8 sm:px-9">
          <div className="flex flex-col items-center text-center">
            <LogoMark size={56} />
            <p className="mt-4 font-display text-[15px] font-semibold uppercase tracking-[0.22em] text-sapphire">{school?.name ?? "\u00A0"}</p>
            <h1 className="mt-3 text-[26px] font-semibold text-sapphire">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-muted">Sign in to continue to your school workspace.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 space-y-5">
            <fieldset>
              <legend className="mb-2 block text-[13px] font-medium text-ink-soft">I am signing in as</legend>
              <div role="radiogroup" aria-label="Role" className="grid grid-cols-3 gap-2">
                {ROLES.map(({ value, label, hint, Icon }) => {
                  const active = role === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => { setValue("role", value); setError(null); }}
                      className={cn(
                        "group flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition-all",
                        active ? "border-lagoon/40 bg-white text-sapphire shadow-[0_8px_24px_-14px_rgba(2,95,103,0.6)] ring-1 ring-lagoon/25" : "border-line/80 bg-white/45 text-ink-muted hover:bg-white/80 hover:text-ink",
                      )}
                    >
                      <span className={cn("grid h-9 w-9 place-items-center rounded-xl transition-colors", active ? "bg-lagoon text-white" : "bg-heather/25 text-ink-soft group-hover:bg-teal-soft group-hover:text-lagoon")}>
                        <Icon className="h-[18px] w-[18px]" aria-hidden />
                      </span>
                      <span className="text-[12.5px] font-semibold leading-tight">{label}</span>
                      <span className="hidden text-[11px] leading-tight text-ink-muted sm:block">{hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <FormField label="Email or username" required error={errors.email?.message}>
              <Input type="email" autoComplete="username" placeholder={school ? `you@${school.emailDomain}` : "you@school.edu"} {...register("email")} />
            </FormField>

            <FormField label="Password" required error={errors.password?.message}>
              <PasswordInput show={showPassword} onToggle={() => setShowPassword((s) => !s)} {...register("password")} />
            </FormField>

            <div className="flex items-center justify-between gap-3">
              <Checkbox label="Remember me" {...register("remember")} />
              <button type="button" onClick={() => setForgotOpen(true)} className="text-[13px] font-medium text-lagoon hover:text-sapphire hover:underline">
                Forgot password?
              </button>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-purple/25 bg-blush/40 px-3.5 py-3 text-[13px] text-plum">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full bg-gradient-to-r from-sapphire to-lagoon hover:from-sapphire hover:to-sapphire" loading={isSubmitting}>
              {isSubmitting ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>
        </div>

        {/* Development helper — lists the demo accounts documented in the README. */}
        <div className="mt-4 rounded-2xl border border-line/70 bg-white/50 backdrop-blur">
          <button type="button" onClick={() => setDemoOpen((o) => !o)} aria-expanded={demoOpen} className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-ink-soft">
            Development demo accounts
            <ChevronDown className={cn("h-4 w-4 transition-transform", demoOpen && "rotate-180")} />
          </button>
          {demoOpen && (
            <ul className="space-y-1 px-2 pb-2">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    onClick={() => { setValue("role", a.role); setValue("email", a.email, { shouldValidate: true }); setValue("password", a.password, { shouldValidate: true }); setError(null); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{a.label}</span>
                      <span className="block truncate text-[12px] text-ink-muted">{a.email} · {a.password}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-semibold text-lagoon">{a.roleLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-5 text-center text-[12px] text-ink-muted">© {new Date().getFullYear()} {school?.name ?? "Your school"} · {PRODUCT.name}</p>
      </motion.div>

      <ForgotPasswordModal open={forgotOpen} onOpenChange={setForgotOpen} />
    </main>
  );
}

const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { show: boolean; onToggle: () => void; invalid?: boolean }>(function PasswordInput(
  { show, onToggle, invalid, ...props }, ref,
) {
  return (
    <div className="relative">
      <Input ref={ref} type={show ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" invalid={invalid} className="pr-11" {...props} />
      <button type="button" onClick={onToggle} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-sapphire/5 hover:text-ink">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

function ForgotPasswordModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const school = useSchoolProfile();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await services.auth.requestPasswordReset(email); setSent(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) { setSent(false); setEmail(""); setErr(null); } }}
      title="Reset your password"
      description={sent ? undefined : "Enter the email linked to your school account. We'll send reset instructions."}
      size="sm"
      footer={sent ? <Button onClick={() => onOpenChange(false)}>Back to sign in</Button> : (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} loading={busy}>Send reset link</Button>
        </>
      )}
    >
      {sent ? (
        <div className="flex flex-col items-center py-2 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-soft text-lagoon"><MailCheck className="h-6 w-6" /></div>
          <p className="mt-3 text-sm text-ink-soft">If an account exists for <strong>{email}</strong>, you'll receive an email with a reset link shortly.</p>
          <p className="mt-2 text-[12px] text-ink-muted">(Demo mode — no email is actually sent.)</p>
        </div>
      ) : (
        <FormField label="Email" required error={err ?? undefined}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={school ? `you@${school.emailDomain}` : "you@school.edu"} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </FormField>
      )}
    </Modal>
  );
}

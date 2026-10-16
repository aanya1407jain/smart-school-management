"use client";
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, ChevronDown, ArrowRight, KeyRound } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useSession } from "./session-provider";
import { canAccessRoute, homeRouteFor } from "@/lib/permissions";
import { loginFormSchema, type LoginFormValues } from "./login-form";
import { cn } from "@/lib/utils/cn";
import { DEMO_ACCOUNTS } from "./demo-accounts";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";
import { PRODUCT } from "@/lib/constants/product";

const schema = loginFormSchema;
type FormValues = LoginFormValues;

export function LoginScreen() {
  const school = useSchoolProfile();
  const router = useRouter();
  const params = useSearchParams();
  const { login, status, user } = useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { loginId: "", password: "", remember: true },
  });

  // Already signed in → straight to the right workspace.
  useEffect(() => {
    if (status === "authenticated" && user) router.replace(homeRouteFor(user));
  }, [status, user, router]);

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      const u = await login({ loginId: values.loginId, password: values.password });
      if (!u) {
        router.replace("/account"); // valid account without portal data yet
        return;
      }
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

            <FormField label="Login ID" required error={errors.loginId?.message}>
              <Input type="text" autoComplete="username" autoCapitalize="characters" spellCheck={false} placeholder="e.g. TCH-00124" {...register("loginId")} />
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
                <li key={a.loginId}>
                  <button
                    type="button"
                    onClick={() => { setValue("loginId", a.loginId, { shouldValidate: true }); setValue("password", a.password, { shouldValidate: true }); setError(null); }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-ink">{a.label}</span>
                      <span className="block truncate font-mono text-[12px] text-ink-muted">{a.loginId} · {a.password}</span>
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
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Forgot your password?"
      size="sm"
      footer={<Button onClick={() => onOpenChange(false)}>Back to sign in</Button>}
    >
      <div className="flex flex-col items-center py-2 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-soft text-lagoon"><KeyRound className="h-6 w-6" /></div>
        <p className="mt-3 text-sm text-ink-soft">
          Ask your school office for a new temporary password. They will give you your Login ID and a password you can change after signing in.
        </p>
      </div>
    </Modal>
  );
}

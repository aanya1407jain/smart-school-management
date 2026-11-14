"use client";
import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { AlertCircle, Eye, EyeOff, ChevronDown, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon } from "@/components/icons/app-icon";
import { Button } from "@/components/ui/button";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { SET_PASSWORD_ROUTE, useSession } from "./session-provider";
import { canAccessRoute, landingRouteFor, safeInternalPath } from "@/lib/permissions";
import { loginFormSchema, type LoginFormValues } from "./login-form";
import { cn } from "@/lib/utils/cn";
import { demoRuntime } from "@/lib/demo/runtime";
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
  const [demoOpen, setDemoOpen] = useState(false);

  const { register, handleSubmit, setValue, clearErrors, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { loginId: "", password: "", remember: true },
  });

  // Already signed in → straight to the right workspace.
  useEffect(() => {
    if (status === "passwordChange") router.replace(SET_PASSWORD_ROUTE);
    else if (status === "authenticated" && user) router.replace(landingRouteFor(user));
  }, [status, user, router]);

  const onSubmit = async (values: FormValues) => {
    setError(null);
    try {
      const u = await login({ loginId: values.loginId, password: values.password });
      if (u === "passwordChange") {
        router.replace(SET_PASSWORD_ROUTE); // temporary password: must be replaced first
        return;
      }
      if (!u) {
        router.replace("/account"); // valid account without portal data yet
        return;
      }
      // SEC-05: only same-origin paths; anything else falls back to the role's dashboard.
      const next = safeInternalPath(params.get("next"));
      router.replace(next && canAccessRoute(u, next) === "allowed" ? next : landingRouteFor(u));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSelectDemoPersona = (a: { loginId: string; password?: string }) => {
    setError(null);
    clearErrors();
    const demoPassword = a.password || "Password@123";
    setValue("loginId", a.loginId, { shouldDirty: true, shouldTouch: true });
    setValue("password", demoPassword, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
  };

  return (
    <main className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="flex min-h-screen flex-col px-5 pb-8 pt-[max(20px,env(safe-area-inset-top))] sm:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:shadow-focus"><Logo /></Link>
          <Link href="/" className="text-[13px] font-medium text-ink-muted hover:text-ink">About Atrium</Link>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10"
        >
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-bg py-1 pl-1 pr-3 text-[12.5px] font-medium text-ink-soft ring-1 ring-inset ring-line">
            <LogoMark size={20} label="School crest" />
            {school?.name ?? "Your school"}
          </span>
          <h1 className="mt-5 text-[34px] font-semibold leading-[1.05] tracking-[-0.045em] text-ink sm:text-[40px]">
            Welcome back<span className="text-marigold">.</span>
          </h1>
          <p className="mt-2 text-[15px] text-ink-muted">Sign in with the Login ID your school gave you.</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-4">
            <FormField label="Login ID" hint="Students: your scholar number." required error={errors.loginId?.message}>
              <Input type="text" autoComplete="username" autoCapitalize="characters" spellCheck={false} placeholder="e.g. 0246CBSE0001 or TCH-00124" className="h-11 text-[15px]" {...register("loginId")} />
            </FormField>

            <FormField label="Password" required error={errors.password?.message}>
              <PasswordInput show={showPassword} onToggle={() => setShowPassword((s) => !s)} {...register("password")} />
            </FormField>

            {/* No self-service recovery: only the school's administrators set passwords. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Checkbox label="Remember me" {...register("remember")} />
              <p className="text-[12.5px] text-ink-muted">Can&apos;t sign in? Ask your school office.</p>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-blush px-3.5 py-3 text-[13px] text-plum ring-1 ring-inset ring-plum/15">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" size="lg" className="group w-full" loading={isSubmitting}>
              {isSubmitting ? "Signing in…" : <>Sign in <ArrowRight className="icon-nudge h-4 w-4" /></>}
            </Button>
          </form>

          {/* Development helper — lists the demo accounts documented in the README (internal builds only). */}
          {demoRuntime() && (
            <div className="mt-6">
              <button type="button" onClick={() => setDemoOpen((o) => !o)} aria-expanded={demoOpen} className="flex w-full items-center justify-between rounded-lg py-1 text-[13px] font-medium text-ink-muted hover:text-ink">
                Try a demo account
                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", demoOpen && "rotate-180")} />
              </button>
              {demoOpen && (
                <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(demoRuntime()?.personas ?? []).map((a) => (
                    <li key={a.loginId}>
                      <button
                        type="button"
                        onClick={() => handleSelectDemoPersona(a)}
                        className="lift flex w-full items-center gap-2.5 rounded-xl bg-surface px-2.5 py-2 text-left shadow-card"
                      >
                        <Avatar name={a.label} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-ink">{a.label}</span>
                          <span className="block truncate font-mono text-[11px] text-ink-muted">{a.roleLabel} · {a.loginId}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </motion.div>

        <p className="text-[12px] text-ink-muted">© {new Date().getFullYear()} {school?.name ?? "Your school"} · Runs on {PRODUCT.name}</p>
      </section>

      <SchoolPreview />
    </main>
  );
}

/** The right half: a dark stage with live-looking cards from a school day (illustrative demo data). */
function SchoolPreview() {
  return (
    <aside aria-hidden className="relative hidden overflow-hidden bg-brand-700 lg:block">
      <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="relative flex h-full flex-col justify-between p-12">
        <div className="relative mx-auto mt-6 h-[480px] w-full max-w-[520px]">
          {/* Ask bar */}
          <div className="float-y absolute left-0 right-6 top-0 flex items-center gap-3 rounded-2xl bg-white p-2.5 pr-3 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-marigold"><AppIcon name="spark" className="h-5 w-5" /></span>
            <span className="flex-1 text-[15px] text-ink">mark attendance for 10-A<span className="ml-px inline-block h-[17px] w-[2px] translate-y-[3px] animate-[caret_1s_steps(1)_infinite] bg-ink" /></span>
            <span className="rounded-lg bg-bg px-2 py-1 text-[11.5px] font-medium text-ink-muted ring-1 ring-inset ring-line">Attendance →</span>
          </div>

          {/* Register */}
          <div className="float-y absolute left-0 top-[96px] w-[290px] rounded-[20px] bg-white p-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] [animation-delay:-1.4s]">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">Class 10-A · Period 1</p>
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-pd-ok"><span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />Live</span>
            </div>
            <ul className="mt-3 space-y-2">
              {[["Aarav Sharma", "P"], ["Diya Patel", "P"], ["Kabir Mehta", "L"], ["Ira Nair", "A"]].map(([n, st]) => (
                <li key={n} className="flex items-center gap-2.5 text-[13px] text-ink-soft">
                  <Avatar name={n} size="xs" />
                  <span className="flex-1">{n}</span>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-md text-[11px] font-semibold", st === "P" ? "bg-pd-ok-soft text-pd-ok" : st === "L" ? "bg-pd-warning-soft text-pd-warning" : "bg-blush text-plum")}>{st}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[12px] text-ink-muted">
              <span>31 of 34 present</span><span className="font-semibold text-ink">91%</span>
            </div>
          </div>

          {/* Receipt */}
          <div className="float-y absolute right-0 top-[236px] w-[220px] rounded-[20px] bg-white p-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] [animation-delay:-2.6s]">
            <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-[10px] bg-marigold-soft text-[#9A5B00]"><AppIcon name="fees" className="h-4 w-4" /></span><p className="text-[12.5px] font-medium text-ink-muted">Fee received</p></div>
            <p className="mt-3 text-[26px] font-semibold tracking-[-0.04em] text-ink">₹12,400</p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-muted">AA/26-27/0412</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg"><div className="grow-x h-full w-[72%] rounded-full bg-mint" /></div>
            <p className="mt-1.5 text-[11.5px] text-ink-muted">Term 2 · 72% collected</p>
          </div>

          {/* Next class */}
          <div className="float-y absolute bottom-2 left-10 flex w-[250px] items-center gap-3 rounded-2xl bg-white p-3 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] [animation-delay:-3.4s]">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#E9F3FF] text-[#1F5FBF]"><AppIcon name="timetable" className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="text-[13px] font-semibold text-ink">Next: Mathematics</p><p className="text-[12px] text-ink-muted">10:40 · Room 204 · Mr. Verma</p></div>
          </div>
        </div>

        <div className="max-w-[460px]">
          <p className="text-[30px] font-semibold leading-[1.1] tracking-[-0.04em] text-white">Everything your school does, <span className="font-serif text-[34px] font-normal italic tracking-[-0.01em] text-marigold">one sentence</span> away.</p>
          <p className="mt-3 text-[14px] text-white/55">Attendance, fees, exams, homework and notices for principals, teachers and students.</p>
        </div>
      </div>
    </aside>
  );
}

const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { show: boolean; onToggle: () => void; invalid?: boolean }>(function PasswordInput(
  { show, onToggle, invalid, ...props }, ref,
) {
  return (
    <div className="relative">
      <Input ref={ref} type={show ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" invalid={invalid} className="h-11 pr-11 text-[15px]" {...props} />
      <button type="button" onClick={onToggle} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-ink/5 hover:text-ink">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
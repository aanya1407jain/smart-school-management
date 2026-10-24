"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogoMark } from "@/components/brand/logo";
import { useSession } from "@/features/auth/session-provider";
import { landingRouteFor } from "@/lib/permissions";
import { useSchoolProfile } from "@/lib/hooks/use-school-profile";
import { PRODUCT } from "@/lib/constants/product";

/** Splash: minimal, centred, warm off-white. Shows the school (tenant) name over the product name. Then on to login (or the user's dashboard). */
export default function SplashPage() {
  const router = useRouter();
  const { status, user } = useSession();
  const school = useSchoolProfile();

  useEffect(() => {
    if (status === "loading") return;
    const t = setTimeout(() => router.replace(user ? landingRouteFor(user) : "/login"), 2300);
    return () => clearTimeout(t);
  }, [status, user, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.2, 0.7, 0.2, 1] }}
        className="flex flex-col items-center text-center"
      >
        <LogoMark size={84} />
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.7 }}
          className="mt-7 font-display text-[30px] font-semibold uppercase tracking-[0.22em] text-sapphire sm:text-[36px]"
        >
          {school?.name ?? "\u00A0"}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.75, duration: 0.7 }}
          className="mt-3 text-[13px] font-medium uppercase tracking-[0.28em] text-ink-muted"
        >
          {PRODUCT.name}
        </motion.p>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.9, duration: 1.3, ease: "easeInOut" }}
          className="mt-9 h-[2px] w-24 origin-left rounded-full bg-gradient-to-r from-teal via-mauve to-lavender"
          aria-hidden
        />
        <span className="sr-only" role="status">Loading {PRODUCT.name}</span>
      </motion.div>
    </main>
  );
}

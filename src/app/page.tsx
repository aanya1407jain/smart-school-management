"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SET_PASSWORD_ROUTE, useSession } from "@/features/auth/session-provider";
import { landingRouteFor } from "@/lib/permissions";
import { Closing, Footer, HowItWorks, Modules, Roles, Security } from "@/features/landing/sections";
import { Hero, LandingNav } from "@/features/landing/hero";

/**
 * The public front page. Signed-in people go straight to their workspace (the
 * installed PWA opens here too); a temporary password goes to /set-password.
 */
export default function LandingPage() {
  const router = useRouter();
  const { status, user } = useSession();
  const home = user ? landingRouteFor(user) : "/login";

  useEffect(() => {
    if (status === "passwordChange") router.replace(SET_PASSWORD_ROUTE);
    else if (status === "authenticated" && user) router.replace(landingRouteFor(user));
  }, [status, user, router]);

  const signedIn = status === "authenticated" && !!user;
  return (
    <div className="min-h-screen bg-surface text-ink">
      <LandingNav signedIn={signedIn} home={home} />
      <main>
        <Hero signedIn={signedIn} home={home} />
        <HowItWorks />
        <Modules />
        <Roles />
        <Security />
        <Closing signedIn={signedIn} home={home} />
      </main>
      <Footer />
    </div>
  );
}

import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6 text-center">
      <div>
        <LogoMark size={56} className="mx-auto" />
        <h1 className="mt-6 text-2xl font-semibold text-sapphire">Page not found</h1>
        <p className="mt-2 text-sm text-ink-muted">The page you're looking for doesn't exist.</p>
        <Link href="/login" className="mt-6 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">Go to sign in</Link>
      </div>
    </main>
  );
}

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * The Convex deployment the browser talks to (HTTPS + WebSocket), from
 * NEXT_PUBLIC_CONVEX_URL (cloud: https://<name>.convex.cloud; self-hosted:
 * e.g. http://127.0.0.1:3210). Storage file URLs are served from the same origin.
 */
function convexOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const ws = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    return [url.origin, ws];
  } catch {
    return [];
  }
}
const convex = convexOrigins();

/**
 * SEC-03: foundational Content-Security-Policy.
 *  - script-src keeps 'unsafe-inline' because Next.js injects inline hydration
 *    scripts and this app has no per-request nonce yet (next step: a nonce set
 *    in src/proxy.ts, then drop 'unsafe-inline'). 'unsafe-eval' only in
 *    development (React Refresh).
 *  - style-src 'unsafe-inline': framer-motion and React `style` props.
 *  - No third-party origins: fonts are self-hosted (@fontsource) and the TC QR
 *    code is generated locally (SEC-04). The only remote origin is Convex.
 *  - frame-ancestors 'none' (with X-Frame-Options: DENY) blocks clickjacking.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${convex[0] ?? ""}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${convex.join(" ")}`.trim(),
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Browsers ignore HSTS on plain-http origins (e.g. local development); it applies once served over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  // Do not advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // Every workspace route is dynamic (the root layout reads the auth cookies), so by default the client
    // router refetches a page on each visit. Reuse a visited page's server payload for 30 s (going back and
    // forth between tabs is instant); live data still updates through the Convex subscriptions.
    staleTimes: { dynamic: 30, static: 300 },
    // Import only the used members of these libraries (lucide-react and framer-motion are on Next's default list).
    optimizePackageImports: ["recharts"],
  },
};

export default nextConfig;

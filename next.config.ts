import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
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

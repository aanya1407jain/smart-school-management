import type { Metadata, Viewport } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { Providers } from "./providers";
import "./globals.css";
import { PRODUCT } from "@/lib/constants/product";
import { ConvexServerProvider } from "@/lib/convex/server-provider";
import { ConvexClientProvider } from "@/lib/convex/client-provider";

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.description,
  applicationName: PRODUCT.name,
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: PRODUCT.name, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#EFF3F0", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <ConvexServerProvider>
          <ConvexClientProvider>
            <Providers>{children}</Providers>
          </ConvexClientProvider>
        </ConvexServerProvider>
      </body>
    </html>
  );
}

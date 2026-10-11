import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import { Providers } from "./providers";
import "./globals.css";
import { PRODUCT } from "@/lib/constants/product";
import { ConvexServerProvider } from "@/lib/convex/server-provider";
import { ConvexClientProvider } from "@/lib/convex/client-provider";

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.description,
  applicationName: PRODUCT.name,
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#F7F6F2", width: "device-width", initialScale: 1 };

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

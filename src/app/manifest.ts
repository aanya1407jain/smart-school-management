import type { MetadataRoute } from "next";
import { PRODUCT } from "@/lib/constants/product";

/** Installable app (PWA): opens at the landing page, which forwards signed-in people to their workspace. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT.name,
    short_name: PRODUCT.shortName,
    description: PRODUCT.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#EFF3F0",
    theme_color: "#EFF3F0",
    categories: ["education", "productivity"],
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Ask Atrium", url: "/login", description: "Sign in and ask" },
    ],
  };
}

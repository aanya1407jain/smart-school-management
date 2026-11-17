"use client";
import type { ReactNode } from "react";
import { SessionProvider } from "@/features/auth/session-provider";
import { ToastProvider } from "@/components/ui/toast";
import { AskProvider } from "@/components/command/ask-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <AskProvider>{children}</AskProvider>
      </ToastProvider>
    </SessionProvider>
  );
}

"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onOpenChange, title, description, children, footer, size = "md" }: BaseProps & { size?: "sm" | "md" | "lg" | "xl" }) {
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-sapphire/25 backdrop-blur-[3px] data-[state=open]:animate-[fade-up_.2s_ease-out]" />
        <Dialog.Content
          className={cn(
            "glass-strong fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl",
            "data-[state=open]:animate-[modal-in_.22s_cubic-bezier(.2,.8,.2,1)] focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line/60 px-6 pb-4 pt-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-ink-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Dialog</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close dialog"><X className="h-4 w-4" /></Button>
            </Dialog.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-line/60 px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({ open, onOpenChange, title, description, children, footer, side = "right", className }: BaseProps & { side?: "left" | "right"; className?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-sapphire/25 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "fixed top-0 z-50 flex h-full w-[min(100vw,30rem)] flex-col bg-white shadow-lift focus:outline-none",
            side === "right" ? "right-0 data-[state=open]:animate-[drawer-r_.25s_cubic-bezier(.2,.8,.2,1)]" : "left-0 data-[state=open]:animate-[drawer-l_.25s_cubic-bezier(.2,.8,.2,1)]",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line/70 px-6 pb-4 pt-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-ink-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Panel</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close panel"><X className="h-4 w-4" /></Button>
            </Dialog.Close>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex gap-2 border-t border-line/70 px-6 py-4 sm:justify-end">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Confirm", tone = "primary", onConfirm, loading,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description: ReactNode; confirmLabel?: string; tone?: "primary" | "danger"; onConfirm: () => void; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">{description}</p>
    </Modal>
  );
}

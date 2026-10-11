"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { SidebarContent } from "./sidebar";

/** Drawer navigation for phones — same items as the desktop sidebar. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-sapphire/30 backdrop-blur-[2px] md:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[min(86vw,300px)] shadow-lift focus:outline-none data-[state=open]:animate-[drawer-l_.25s_cubic-bezier(.2,.8,.2,1)] md:hidden">
          <Dialog.Title className="sr-only">Navigation menu</Dialog.Title>
          <Dialog.Description className="sr-only">Links to the sections of your workspace</Dialog.Description>
          <SidebarContent onNavigate={() => onOpenChange(false)} />
          <Dialog.Close className="absolute right-3 top-6 grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close menu">
            <X className="h-4 w-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
          <Dialog.Close className="absolute right-2 top-3.5 grid h-11 w-11 place-items-center rounded-lg text-emerald-100 hover:bg-emerald-900/60 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300" aria-label="Close menu">
            <X className="h-5 w-5" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

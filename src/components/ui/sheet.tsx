"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/use-translation"

// Bottom sheet for phone-sized screens, built on the same Radix dialog the
// centered Dialog uses. Slides up from the bottom edge and fills most of the
// viewport so embedded panels (e.g. the POS ticket) keep their full-height
// flex layout.

const Sheet = DialogPrimitive.Root

const SheetTrigger = DialogPrimitive.Trigger

const SheetClose = DialogPrimitive.Close

const SheetTitle = DialogPrimitive.Title

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const t = useT()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        aria-describedby={undefined}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex h-[94dvh] flex-col rounded-t-2xl border-t bg-background shadow-lg duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        <div className="flex h-9 shrink-0 items-center justify-center">
          <div className="h-1.5 w-10 rounded-full bg-muted" aria-hidden />
          <DialogPrimitive.Close className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <X className="h-5 w-5" />
            <span className="sr-only">{t("common.close")}</span>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
SheetContent.displayName = "SheetContent"

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle }

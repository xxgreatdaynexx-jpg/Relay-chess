import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#07140f]/75 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'modal-shell dialog-shell fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#1a2e26] text-cream shadow-2xl',
          className,
        )}
        {...props}
      >
        <div className="modal-shell-head dialog-shell-head">
          <DialogPrimitive.Close type="button" className="modal-shell-x" aria-label="Close" data-testid="dialog-close">✕</DialogPrimitive.Close>
        </div>
        <div className="modal-shell-body dialog-shell-body">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('font-serif text-2xl leading-tight text-cream', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-2 text-sm leading-relaxed text-cream-dim', className)} {...props} />;
}

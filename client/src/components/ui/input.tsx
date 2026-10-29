import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-lg border border-white/15 bg-black/25 px-3 text-base text-cream outline-none placeholder:text-cream/40 focus-visible:ring-2 focus-visible:ring-brass',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

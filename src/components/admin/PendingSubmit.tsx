'use client';

import type { ButtonHTMLAttributes } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Render the shadcn `Button` instead of a raw `<button>` (a server page cannot pass the component itself). */
  shadcn?: boolean;
};

/**
 * Submit button for a server-action form: the same element the page used before, but disabled and
 * `aria-busy` while the form's action runs, so a slow action cannot be double-submitted.
 * Props, class names and children pass through untouched; idle markup is identical to the plain button.
 */
export function PendingSubmit({ shadcn, disabled, type = 'submit', ...rest }: Props) {
  const { pending } = useFormStatus();
  const state = { disabled: pending || disabled, 'aria-busy': pending || undefined };
  return shadcn ? <Button type={type} {...rest} {...state} /> : <button type={type} {...rest} {...state} />;
}

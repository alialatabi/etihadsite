'use client';

import { common } from '@/content/ar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** One size input (label, number box, cm unit): the builder and the staff cards differ only in `inputClassName`. */
export function SizeField({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
  inputClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  describedBy?: string;
  inputClassName: string;
}) {
  return (
    <div className="flex-1 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputClassName}
        />
        <span className="shrink-0 text-sm text-muted-foreground">{common.units.cm}</span>
      </div>
    </div>
  );
}

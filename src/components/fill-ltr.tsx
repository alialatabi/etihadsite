import type { ReactNode } from 'react';
import { Ltr } from '@/components/Ltr';

/**
 * Like `fill()` from the copy index, but returns nodes with every substituted
 * value wrapped in <Ltr> so numbers/units never get reordered inside RTL text.
 */
export function fillLtr(template: string, values: Record<string, string | number>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m && m[1] in values) return <Ltr key={i}>{values[m[1]]}</Ltr>;
    return part;
  });
}

import { Fragment, type ReactNode } from 'react';
import { Ltr } from '@/components/Ltr';

/** Like `fill()`, but wraps every substituted value in <Ltr> so digits never reorder in RTL text. */
export function fillNodes(template: string, values: Record<string, string | number>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m && m[1] in values) return <Ltr key={i}>{String(values[m[1]])}</Ltr>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

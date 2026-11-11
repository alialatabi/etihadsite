import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Ltr } from '@/components/Ltr';

/**
 * Like `fill()` from the copy index, but returns nodes with every substituted
 * value wrapped in <Ltr> so numbers/units never get reordered inside RTL text.
 * A value that is already an element (for example <Money />) is inserted as it is.
 */
export function fillLtr(template: string, values: Record<string, string | number | ReactElement>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m && m[1] in values) {
      const value = values[m[1]];
      return isValidElement(value) ? <Fragment key={i}>{value}</Fragment> : <Ltr key={i}>{value}</Ltr>;
    }
    return part;
  });
}

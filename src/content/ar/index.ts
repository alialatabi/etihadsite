export { common } from './common';
export { builder } from './builder';
export { order } from './order';
export { pages } from './pages';
export { admin } from './admin';
export { staff } from './staff';
export { governorates, type Governorate } from './governorates';

/** Fill {placeholders} in a copy string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in values ? String(values[key]) : `{${key}}`));
}

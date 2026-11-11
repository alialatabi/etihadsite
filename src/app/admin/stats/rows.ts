/**
 * View-model of the statistics page: turns the aggregated numbers into the labelled rows
 * the bar lists show. Pure (copy and arithmetic only), so it can be unit-tested directly.
 */
import { admin, builder, common } from '@/content/ar';
import type { Material } from '@/lib/types';
import { pct, type Stats } from './aggregate';
import type { BarRow } from './parts';

const S = admin.stats;
const A = S.audience;

/**
 * Label of a shape key stored with an order event. Exactly what the page always did: any
 * non-empty text that builder.shape holds under the key is used (circle / rect / custom in
 * practice, but also its other entries such as `rounded`); every other key, inherited
 * property names included, is shown as it is. Narrowing this to the three shapes would
 * change the label of those other entries.
 */
const SHAPE_COPY: Record<string, unknown> = builder.shape;
const shapeKeyLabel = (key: string): string => {
  const label = SHAPE_COPY[key];
  return label && typeof label === 'string' ? label : key;
};

export function buildStatsRows(st: Stats) {
  const sourceRows: BarRow[] = st.sources.map((r) => ({ label: S.sources[r.key] ?? S.sources.other, value: r.count }));
  const deviceTotal = st.devices.reduce((a, r) => a + r.count, 0);
  const deviceRows: BarRow[] = st.devices.map((r) => ({
    label: S.devices[r.key] ?? r.key,
    value: r.count,
    note: `${pct(r.count, deviceTotal) ?? 0}%`,
  }));
  const cityRows: BarRow[] = st.cities.map((r) => ({ label: r.key, value: r.count }));
  const govRows: BarRow[] = st.governorates.map((r) => ({ label: r.key, value: r.count }));
  const materialRows: BarRow[] = st.materials.map((r) => ({
    label: common.materials[r.key as Material] ?? r.key,
    value: r.count,
  }));
  const shapeRows: BarRow[] = st.shapes.map((r) => ({
    label: shapeKeyLabel(r.key),
    value: r.count,
  }));
  const sizeRows: BarRow[] = st.sizes.map((r) => ({ label: `${r.key} ${common.units.cm}`, value: r.count }));
  const weekdayRows: BarRow[] = st.weekdays.map((w, i) => ({
    label: S.weekdays[i],
    value: w.visitors,
    note: w.orders ? `${w.orders} ${A.ordersLabel}` : undefined,
  }));
  const topHours = st.hours
    .map((h, hour) => ({ hour, ...h }))
    .filter((h) => h.visitors > 0)
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 6);
  const hourRows: BarRow[] = topHours.map((h) => ({
    label: `${S.hourLabel} ${String(h.hour).padStart(2, '0')}:00`,
    value: h.visitors,
    note: h.orders ? `${h.orders} ${A.ordersLabel}` : undefined,
  }));
  const customerRows: BarRow[] = [
    { label: A.newCustomers, value: st.newCustomers },
    { label: A.returningCustomers, value: st.returningCustomers },
  ];

  return { sourceRows, deviceRows, cityRows, govRows, materialRows, shapeRows, sizeRows, weekdayRows, hourRows, customerRows };
}

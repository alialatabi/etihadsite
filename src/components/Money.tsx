import { common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { formatIqd } from '@/lib/pricing';

/** An amount in Iraqi dinar: the grouped number (isolated LTR) followed by the currency word. */
export function Money({ amount }: { amount: number }) {
  return (
    <>
      <Ltr>{formatIqd(amount)}</Ltr> {common.units.iqd}
    </>
  );
}

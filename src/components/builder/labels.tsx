import { common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { count, formatCount } from '@/lib/plural';
import { safeFormatCm } from './safe';

/** "1,080 ستيكر": the number is grouped and LTR-isolated, the Arabic word follows it in reading order. */
export function CountLabel({ n }: { n: number }) {
  const word = count(n, common.plural.sticker);
  return (
    <>
      <Ltr>{formatCount(n)}</Ltr>
      {word && ` ${word}`}
    </>
  );
}

/** "3 × 3 سم": the dimensions are LTR-isolated, the unit follows in reading order. */
export function SizeLabel({ widthUm, heightUm }: { widthUm: number; heightUm: number }) {
  return (
    <>
      <Ltr>
        {safeFormatCm(widthUm)} × {safeFormatCm(heightUm)}
      </Ltr>{' '}
      {common.units.cm}
    </>
  );
}

import { common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { count } from '@/lib/plural';
import { safeFormatCm } from './safe';

function stickerWord(n: number): string {
  try {
    return count(n, common.plural.sticker);
  } catch {
    return '';
  }
}

/** "54 ستيكر": the number is LTR-isolated, the Arabic word follows it in reading order. */
export function CountLabel({ n }: { n: number }) {
  const word = stickerWord(n);
  return (
    <>
      <Ltr>{n}</Ltr>
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

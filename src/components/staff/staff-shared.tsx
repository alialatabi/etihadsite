import { Ltr } from '@/components/Ltr';
import { count, formatCount, type PluralForms } from '@/lib/plural';

/** Hands the finished PDF to the browser as a download. Shared by the sticker and the receipt tab. */
export function saveFile(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "3 تصاميم": the number isolated LTR, the plural word after it. */
export function Counted({ n, forms }: { n: number; forms: PluralForms }) {
  return (
    <>
      <Ltr>{formatCount(n)}</Ltr> {count(n, forms)}
    </>
  );
}

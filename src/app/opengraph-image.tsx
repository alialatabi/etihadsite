import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pages } from '@/content/ar';

export const alt = pages.seo.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Offline-safe OG card: the shop logo (already contains the Arabic wordmark) on navy,
 * plus Latin-only text, so no Arabic font file is needed at build time.
 */
export default async function Image() {
  const logo = await readFile(join(process.cwd(), 'public', 'brand', 'united-print-logo.jpg'));
  const src = `data:image/jpeg;base64,${logo.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 56,
          background: '#1e2a4a',
          color: '#faf8f3',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={420} height={420} alt="" style={{ borderRadius: 40 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 64, fontWeight: 700 }}>Al-Ittihad Print</div>
          <div style={{ fontSize: 34, color: '#ff6b45' }}>A4 Sticker Printing</div>
        </div>
      </div>
    ),
    { ...size },
  );
}

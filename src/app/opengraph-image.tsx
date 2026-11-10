import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pages } from '@/content/ar';

export const alt = pages.seo.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Offline-safe OG card: the shop logo (already contains the Arabic wordmark) on near-white,
 * plus Latin-only text, so no Arabic font file is needed at build time.
 */
export default async function Image() {
  const logo = await readFile(join(process.cwd(), 'public', 'brand', 'softy-logo.png'));
  const src = `data:image/png;base64,${logo.toString('base64')}`;
  // Logo is 1038x914; keep the aspect ratio.
  const logoH = 440;
  const logoW = Math.round((logoH * 1038) / 914);

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
          background: '#fdfbfa',
          color: '#121f34',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={logoW} height={logoH} alt="" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 64, fontWeight: 700 }}>Softy Printing</div>
          <div style={{ fontSize: 34, color: '#d01c4a' }}>A4 Sticker Printing</div>
        </div>
      </div>
    ),
    { ...size },
  );
}

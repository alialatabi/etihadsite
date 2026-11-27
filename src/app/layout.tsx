import type { Metadata, Viewport } from 'next';
import { Aref_Ruqaa, IBM_Plex_Sans_Arabic, Lalezar, Noto_Kufi_Arabic, Rakkas } from 'next/font/google';
import { DirectionProvider } from '@/components/ui/direction';
import { Header } from '@/components/shell/Header';
import { Footer } from '@/components/shell/Footer';
import { InstallPrompt } from '@/components/shell/InstallPrompt';
import { Tracker } from '@/components/shell/Tracker';
import { MetaPixel } from '@/components/shell/MetaPixel';
import { getSettings } from '@/lib/settings';
import { common, pages } from '@/content/ar';
import './globals.css';

/** Root layout: the RTL html/body shell with the site font, header, footer, install prompt and visit tracker around every page. */
const fontSans = IBM_Plex_Sans_Arabic({
  weight: ['400', '500', '700'],
  subsets: ['arabic', 'latin'],
  variable: '--font-sans',
  display: 'swap',
});

// Display fonts: decorative headline, CTA, price and marker faces only (never body text).
const fontLalezar = Lalezar({ weight: '400', subsets: ['arabic', 'latin'], variable: '--ff-lalezar', display: 'swap' });
const fontRakkas = Rakkas({ weight: '400', subsets: ['arabic'], variable: '--ff-rakkas', display: 'swap', preload: false });
const fontKufi = Noto_Kufi_Arabic({ weight: '900', subsets: ['arabic'], variable: '--ff-kufi', display: 'swap', preload: false });
const fontRuqaa = Aref_Ruqaa({ weight: '700', subsets: ['arabic'], variable: '--ff-ruqaa', display: 'swap', preload: false });

export const metadata: Metadata = {
  title: {
    default: pages.seo.title,
    template: `%s | ${common.brand}`,
  },
  description: pages.seo.description,
  // iOS "Add to Home Screen": open full-screen like an app, with the shop name under the icon.
  appleWebApp: {
    capable: true,
    title: pages.seo.manifestShort,
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#121f34',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <html lang="ar" dir="rtl" className={`${fontSans.variable} ${fontLalezar.variable} ${fontRakkas.variable} ${fontKufi.variable} ${fontRuqaa.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <DirectionProvider direction="rtl">
          <Header settings={settings} />
          <main className="flex-1">{children}</main>
          <Footer settings={settings} />
          <InstallPrompt shopName={settings.shopName} />
          <Tracker />
          <MetaPixel />
        </DirectionProvider>
      </body>
    </html>
  );
}

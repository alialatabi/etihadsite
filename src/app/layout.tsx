import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { DirectionProvider } from '@/components/ui/direction';
import { Toaster } from '@/components/ui/sonner';
import { Header } from '@/components/shell/Header';
import { Footer } from '@/components/shell/Footer';
import { getSettings } from '@/lib/settings';
import { pages } from '@/content/ar';
import './globals.css';

/**
 * Root layout — FROZEN during Phase 1. Agents C/D/E must not edit this file;
 * Header/Footer are edited in place by Agent E.
 */
const fontSans = IBM_Plex_Sans_Arabic({
  weight: ['400', '500', '700'],
  subsets: ['arabic', 'latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: pages.seo.title,
    template: `%s | الاتحاد برنت`,
  },
  description: pages.seo.description,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e2a4a',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  return (
    <html lang="ar" dir="rtl" className={`${fontSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <DirectionProvider direction="rtl">
          <Header settings={settings} />
          <main className="flex-1">{children}</main>
          <Footer settings={settings} />
          <Toaster position="top-center" dir="rtl" />
        </DirectionProvider>
      </body>
    </html>
  );
}

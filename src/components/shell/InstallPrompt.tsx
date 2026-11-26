'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { Share, SquarePlus, X } from 'lucide-react';
import { ctaCls, Tape } from '@/components/collage';
import { pages } from '@/content/ar';
import { sendTrack } from '@/lib/analytics/client';
import { isStaffPath } from '@/lib/analytics/paths';
import { cn } from '@/lib/utils';

const trackInstall = (step: 'shown' | 'accepted' | 'installed') =>
  sendTrack({ type: 'install', step, path: window.location.pathname });

/** Chromium's install event (not in lib.dom yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'hidden' | 'android' | 'ios';

const DISMISS_KEY = 'softy-install-dismissed';
const SHOW_DELAY_MS = 2500;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 1024px)').matches;
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // In-app browsers and Chrome/Firefox on iOS cannot add to the home screen the same way.
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\//i.test(ua);
  return ios && !otherBrowser;
}

function dismissedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Owner request: every time a customer opens the site on a phone, offer to install it as an app.
 * Android/Chromium → native install prompt via `beforeinstallprompt`; iOS Safari → short
 * "Share → Add to Home Screen" instructions. Hidden when already installed, on desktop, in /admin,
 * and for the rest of the visit once dismissed.
 */
export function InstallPrompt({ shopName }: { shopName: string }) {
  const pathname = usePathname();
  const [mode, setMode] = useState<Mode>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const t = pages.install;

  useEffect(() => {
    if (isStandalone() || !isMobile() || dismissedThisVisit()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (m: Mode) => {
      timer = setTimeout(() => setMode(m), SHOW_DELAY_MS);
    };
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      show('android');
    };
    const onInstalled = () => {
      trackInstall('installed');
      setMode('hidden');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (isIosSafari()) show('ios');
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const visible = mode !== 'hidden' && !pathname.startsWith('/admin') && !isStaffPath(pathname);
  useEffect(() => {
    if (visible) trackInstall('shown');
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {}
    setMode('hidden');
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') trackInstall('accepted');
    setDeferred(null);
    setMode('hidden');
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={t.region}
      className="fixed bottom-3 start-3 end-3 z-50 mx-auto max-w-md animate-in fade-in slide-in-from-bottom-4 rounded-[2px] bg-white p-4 shadow-paper motion-reduce:animate-none"
    >
      <Tape strip="orange" className="absolute -top-3 start-10 -rotate-6" />
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.close}
        className="absolute end-1 top-1 flex size-11 items-center justify-center rounded-[2px] text-ink-muted hover:bg-news focus-visible:outline-[3px] focus-visible:outline-ink"
      >
        <X className="size-5" aria-hidden />
      </button>

      <div className="flex items-center gap-3 pe-8">
        <Image src="/icon-192.png" alt="" width={56} height={56} className="size-14 shrink-0 sticker-edge-sm" />
        <div className="min-w-0">
          <p className="font-lalezar text-xl font-normal leading-tight text-ink">{t.title.replace('{name}', shopName)}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{t.body}</p>
        </div>
      </div>

      {mode === 'android' ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={install}
            className={cn(ctaCls('md'), 'flex-1')}
          >
            <SquarePlus className="size-5" aria-hidden />
            {t.install}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-12 items-center justify-center rounded-[2px] border border-ink/30 bg-white px-5 text-base text-ink hover:bg-news focus-visible:outline-[3px] focus-visible:outline-ink"
          >
            {t.later}
          </button>
        </div>
      ) : (
        <ol className="mt-4 space-y-2 rounded-[2px] bg-news p-3 text-sm">
          <li className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[50%] bg-ink text-paper">
              <Share className="size-4" aria-hidden />
            </span>
            {t.iosStep1}
          </li>
          <li className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[50%] bg-ink text-paper">
              <SquarePlus className="size-4" aria-hidden />
            </span>
            {t.iosStep2}
          </li>
        </ol>
      )}
    </section>
  );
}

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';

export default function NotFound() {
  const t = pages.notFound;
  return (
    <section className="glass mx-4 my-12 flex flex-col items-center rounded-3xl px-6 py-14 text-center sm:mx-auto sm:my-20 sm:max-w-xl sm:py-20">
      <p className="font-heading text-7xl font-bold text-brand sm:text-8xl">
        <Ltr>{t.code}</Ltr>
      </p>
      <div className="cut-line my-6 h-px w-48 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-bold sm:text-3xl">{t.title}</h1>
      <p className="mt-3 text-muted-foreground">{t.body}</p>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-6 font-bold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t.home}
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
    </section>
  );
}

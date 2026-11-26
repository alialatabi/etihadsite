import { pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { ScrapHeadline } from '@/components/collage';
import { CtaLink } from '@/components/shell/CtaLink';

export default function NotFound() {
  const t = pages.notFound;
  return (
    <section className="paper-card mx-4 my-12 flex flex-col items-center px-6 py-14 text-center sm:mx-auto sm:my-20 sm:max-w-xl sm:py-20">
      <p className="font-lalezar text-7xl font-normal text-brand sm:text-8xl">
        <Ltr>{t.code}</Ltr>
      </p>
      <div className="dashed-divider my-6 w-48" aria-hidden />
      <ScrapHeadline as="h1" text={t.title} size="md" red="none" />
      <p className="mt-4 text-ink-muted">{t.body}</p>
      <CtaLink href="/" className="mt-8">
        {t.home}
      </CtaLink>
    </section>
  );
}

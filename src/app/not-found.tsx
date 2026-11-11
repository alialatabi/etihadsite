import { pages } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { CtaLink } from '@/components/shell/CtaLink';

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
      <CtaLink href="/" className="mt-8">
        {t.home}
      </CtaLink>
    </section>
  );
}

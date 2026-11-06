import { builder } from '@/content/ar';
import { Builder } from '@/components/builder/Builder';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const settings = await getSettings();
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-4 pt-8 md:pt-12">
        <span className="inline-block rounded-full bg-brand/15 px-3 py-1 text-xs font-medium text-brand">{builder.hero.badge}</span>
        <h1 className="font-heading mt-3 text-3xl font-bold leading-tight md:text-5xl">{builder.hero.title}</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">{builder.hero.subtitle}</p>
      </section>
      <Builder settings={settings} />
    </>
  );
}

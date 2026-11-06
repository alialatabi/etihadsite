import { builder } from '@/content/ar';

/**
 * Home / builder page — OWNED BY AGENT C (replace this placeholder entirely).
 */
export default function HomePage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <span className="inline-block rounded-full bg-brand/15 px-3 py-1 text-xs font-medium text-brand">{builder.hero.badge}</span>
      <h1 className="font-heading mt-4 text-4xl font-bold leading-tight md:text-5xl">{builder.hero.title}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{builder.hero.subtitle}</p>
      <div id="builder" className="mt-12 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
        {builder.preview.empty}
      </div>
    </section>
  );
}

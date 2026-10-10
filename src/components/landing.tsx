import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionaries";

/** Landing page content; `preview` is the live top-products block (streamed separately). */
export function Landing({ preview, t }: { preview: ReactNode; t: Dictionary["landing"] }) {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4">
      <section className="py-20 sm:py-28">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          {t.eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Winning Product Hunter
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-lg">{t.intro}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/products" className={buttonVariants({ size: "lg" })}>
            {t.ctaProducts}
          </Link>
          <Link href="/sources" className={buttonVariants({ size: "lg", variant: "outline" })}>
            {t.ctaSources}
          </Link>
        </div>
      </section>

      <section aria-labelledby="preview-heading" className="pb-16">
        <h2 id="preview-heading" className="text-xl font-semibold">
          {t.previewHeading}
        </h2>
        <div className="mt-4">{preview}</div>
      </section>

      <section aria-labelledby="why-heading" className="border-t py-16">
        <h2 id="why-heading" className="text-xl font-semibold">
          {t.whyHeading}
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {t.pillars.map((p) => (
            <div key={p.title} className="rounded-lg border p-5">
              <h3 className="font-medium">{p.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t py-16">
        <h2 id="how-heading" className="text-xl font-semibold">
          {t.howHeading}
        </h2>
        <ol className="mt-6 space-y-3">
          {t.steps.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {i + 1}
              </span>
              <span className="text-muted-foreground pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label={t.sourcesLabel}>
          {t.sources.map((s) => (
            <li key={s} className="bg-secondary rounded px-2 py-1 text-xs">
              {s}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";

const PILLARS = [
  {
    title: "Evidence, not hype",
    body: "Every score shows why: the ads, how long they have run, the stores selling it and their prices. Click through and check it yourself.",
  },
  {
    title: "Several sources must agree",
    body: "Ad libraries, store catalogs and supplier data are cross-checked. A product seen in one place only is marked as unconfirmed.",
  },
  {
    title: "Early, not late",
    body: "We rank by momentum and new advertisers, and penalize crowded products, so you see what is taking off rather than what everyone already sells.",
  },
  {
    title: "Built for your markets",
    body: "The US, Canada, the UK, Australia and New Zealand first, then Europe. Prices are shown in each market's own currency.",
  },
];

const STEPS = [
  "Every day we sweep the public Meta Ad Library in five markets for product ads.",
  "Ads are grouped by the product page they link to; the same product across stores is merged.",
  "Each product is checked against Shopify store listings for retail prices and competition.",
  "A transparent Winning Score ranks them, with every signal and its source on display.",
];

const SOURCES = [
  "Meta Ad Library",
  "Shopify Global Catalog",
  "Advertisers' own stores",
  "ECB exchange rates",
  "CJ Dropshipping (soon)",
  "Google & Pinterest trends (soon)",
];

/** Landing page content; `preview` is the live top-products block (streamed separately). */
export function Landing({ preview }: { preview: ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4">
      <section className="py-20 sm:py-28">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
          Product research for dropshippers
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Winning Product Hunter
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-lg">
          Find products that are selling right now, backed by evidence you can verify: real ads, how
          long they have been running, which stores sell them and at what price.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/products" className={buttonVariants({ size: "lg" })}>
            See winning products
          </Link>
          <Link href="/sources" className={buttonVariants({ size: "lg", variant: "outline" })}>
            How the data is collected
          </Link>
        </div>
      </section>

      <section aria-labelledby="preview-heading" className="pb-16">
        <h2 id="preview-heading" className="text-xl font-semibold">
          Top products right now
        </h2>
        <div className="mt-4">{preview}</div>
      </section>

      <section aria-labelledby="why-heading" className="border-t py-16">
        <h2 id="why-heading" className="text-xl font-semibold">
          Why it is different
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <div key={p.title} className="rounded-lg border p-5">
              <h3 className="font-medium">{p.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-heading" className="border-t py-16">
        <h2 id="how-heading" className="text-xl font-semibold">
          How it works
        </h2>
        <ol className="mt-6 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {i + 1}
              </span>
              <span className="text-muted-foreground pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <ul className="mt-8 flex flex-wrap gap-2" aria-label="Data sources">
          {SOURCES.map((s) => (
            <li key={s} className="bg-secondary rounded px-2 py-1 text-xs">
              {s}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

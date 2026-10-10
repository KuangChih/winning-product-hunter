import type { EvidenceItem } from "@/data/product-detail";
import { sourceLabel } from "@/lib/sources";
import { Sparkline } from "./sparkline";

const DAY = 86_400_000;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatPrice(cents: number, currency: string | null) {
  return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4"
    >
      {children}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function AdRow({ ad, now }: { ad: EvidenceItem; now: Date }) {
  const end = ad.endedAt && ad.endedAt < now ? ad.endedAt : now;
  const days = ad.startedAt ? Math.round((end.getTime() - ad.startedAt.getTime()) / DAY) : null;
  const active = !ad.endedAt || ad.endedAt > now;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0">
      <div>
        <div className="font-medium">{ad.advertiserName ?? "Unknown advertiser"}</div>
        <div className="text-muted-foreground text-xs">
          {sourceLabel(ad.source)}
          {ad.format ? ` · ${ad.format}` : ""}
          {ad.startedAt ? ` · started ${formatDate(ad.startedAt)}` : ""}
          {days !== null ? ` · ${days} days` : ""}
          {` · ${active ? "active" : "stopped"}`}
        </div>
      </div>
      {ad.url && <ExternalLink href={ad.url}>View ad</ExternalLink>}
    </li>
  );
}

export function EvidenceList({ evidence, now }: { evidence: EvidenceItem[]; now: Date }) {
  const ads = evidence
    .filter((e) => e.kind === "ad")
    .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0));
  const trends = evidence.filter((e) => e.kind === "trend");
  const listings = evidence.filter((e) => e.kind === "listing");

  return (
    <div className="space-y-8">
      {ads.length > 0 && (
        <Section title={`Ads (${ads.length})`}>
          <ul className="rounded-lg border px-3">
            {ads.map((ad) => (
              <AdRow key={ad.id} ad={ad} now={now} />
            ))}
          </ul>
        </Section>
      )}
      {trends.length > 0 && (
        <Section title="Search demand">
          <ul className="space-y-3">
            {trends.map((t) => {
              const series = t.series.search_interest ?? [];
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
                  <div className="min-w-40">
                    <div className="font-medium">“{t.title}”</div>
                    <div className="text-muted-foreground text-xs">
                      {sourceLabel(t.source)}
                      {t.region ? ` · ${t.region}` : ""} · {series.length} weeks
                    </div>
                  </div>
                  <Sparkline
                    values={series.map((p) => p.value)}
                    label={`Search interest for ${t.title}`}
                  />
                  {t.url && <ExternalLink href={t.url}>Open in Google Trends</ExternalLink>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {listings.length > 0 && (
        <Section title="Supplier listings">
          <ul className="rounded-lg border px-3">
            {listings.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-t py-2 first:border-t-0"
              >
                <div>
                  <div className="font-medium">{sourceLabel(l.source)}</div>
                  <div className="text-muted-foreground text-xs">
                    {l.priceCents !== null ? `Price ${formatPrice(l.priceCents, l.currency)}` : ""}
                    {l.metrics.orders_recent !== undefined
                      ? ` · ${l.metrics.orders_recent.toLocaleString("en-US")} recent orders`
                      : ""}
                  </div>
                </div>
                {l.url && <ExternalLink href={l.url}>View listing</ExternalLink>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {evidence.length === 0 && (
        <p className="text-muted-foreground text-sm">No evidence collected yet.</p>
      )}
    </div>
  );
}

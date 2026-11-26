import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { getDictionary } from "@/lib/i18n/server";
import { LISTING_PHOTOS, LISTINGS, photoSrcSet } from "@/lib/listings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary())("credits.metaTitle") };
}

/**
 * /credits: every catalogue photo with its title, author, licence, source and what we changed, as the CC BY and
 * CC BY-SA licences ask. Generated from web/data/listings.json, the same metadata GET /api/listings serves the iOS app.
 */
export default async function CreditsPage() {
  const t = await getDictionary();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.h("credits.title")}>{t("credits.lead")}</PageTitle>
      <ul className="grid gap-6 md:grid-cols-2">
        {Object.entries(LISTING_PHOTOS).map(([src, p]) => {
          const used = LISTINGS.filter((l) => l.photos.includes(src));
          const c = p.credit;
          return (
            <li key={src} className="rounded-2xl border border-border bg-surface p-4" data-testid="credit" data-src={src}>
              <picture>
                <source type="image/avif" srcSet={photoSrcSet(src, "avif")} sizes="(min-width: 768px) 30rem, 92vw" />
                <source type="image/webp" srcSet={photoSrcSet(src, "webp")} sizes="(min-width: 768px) 30rem, 92vw" />
                <img src={src} srcSet={photoSrcSet(src, "jpg")} sizes="(min-width: 768px) 30rem, 92vw" alt={p.alt} width={p.width} height={p.height} loading="lazy" decoding="async" className="h-auto w-full rounded-xl" />
              </picture>
              <h2 className="mt-3 font-semibold">
                <a href={c.source} className="underline">
                  {c.title}
                </a>
              </h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("credits.usedFor")}</dt>
                <dd>
                  {used.map((l, i) => (
                    <span key={l.slug}>
                      {i > 0 && ", "}
                      <Link href={`/app/listings/${l.slug}`} prefetch={false} className="underline">
                        {l.name}
                      </Link>
                    </span>
                  ))}
                </dd>
                <dt className="text-muted-foreground">{t("credits.author")}</dt>
                <dd>{c.author}</dd>
                <dt className="text-muted-foreground">{t("credits.license")}</dt>
                <dd>
                  <a href={c.licenseUrl} className="underline">
                    {c.license}
                  </a>
                </dd>
                <dt className="text-muted-foreground">{t("credits.changed")}</dt>
                <dd>{c.changes}</dd>
                {c.note && (
                  <>
                    <dt className="text-muted-foreground">{t("credits.note")}</dt>
                    <dd>{c.note}</dd>
                  </>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
      <p className="mt-8 text-sm text-muted-foreground">{t("credits.sameLicense")}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("credits.api")}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a JSON endpoint, not a page */}
        <a href="/api/listings" className="underline">
          <code>GET /api/listings</code>
        </a>
      </p>
    </section>
  );
}

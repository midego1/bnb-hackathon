import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { LangSwitch } from "@/components/LangSwitch";
import { ThemeCycleButton } from "@/components/ThemeSwitch";
import { getDictionary } from "@/lib/i18n/server";
import { LISTING_CITIES } from "@/lib/listings";
import type { ListingSearch } from "@/lib/marketing";
import { landingCopy } from "./copy";
import { ArrowIcon, BoxIcon, PlayIcon } from "./icons";
import { Search } from "./Search";

const WIDE = [1000, 1600, 2400];
const TALL = [600, 900, 1200];
const set = (name: string, widths: number[], ext: string) => widths.map((w) => `/marketing/${name}-${w}.${ext} ${w}w`).join(", ");
const PHONE = "(max-width: 767px)";
const DESKTOP = "(min-width: 768px)";
// The art covers the hero and is a little wider than it (it pans), so it renders wider than the viewport.
const WIDE_SIZES = "115vw";
const TALL_SIZES = "130vw";

/** The live judge demo: the big screen of the box we brought to the stage (its QR code leads to the phone flow). */
export const MYSTERY_BOX = "/stage/mystery-box";

/** Logo, in-page links, theme button and the way into the app. Laid over the top of the hero. */
export async function SiteHeader() {
  const c = (await getDictionary()).of(landingCopy).header;
  return (
    <header className="mk-night mk-top">
      <nav aria-label="Site" className="mx-auto flex w-full max-w-7xl items-center gap-2 px-5 py-4 sm:gap-3 sm:px-8">
        <Link prefetch={false} href="/" className="flex items-center gap-2 text-lg sm:gap-2.5 sm:text-xl" aria-label={c.home}>
          <LogoMark className="h-8 w-8" />
          <span className="mk-display">KeyEscrow</span>
        </Link>
        <ul className="ml-8 hidden items-center gap-7 text-[0.95rem] whitespace-nowrap text-muted-foreground xl:flex">
          {c.nav.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="transition-colors hover:text-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <span className="ml-auto flex items-center gap-2 sm:gap-2.5">
          {/* A phone gets EN / 中文 here (landing.css) and "Open the app" as the third button of the hero. */}
          <LangSwitch className="inline-flex border-white/25 bg-white/10 text-white" />
          <ThemeCycleButton className="inline-flex !h-10 !w-10 !rounded-full !border-white/25 !bg-white/10 !text-white hover:!bg-white/20" />
          <Link prefetch={false} href="/app" data-testid="mk-open-app" className="mk-btn mk-btn-line !hidden !min-h-10 !px-4 !py-2 !text-[0.95rem] sm:!inline-flex">
            {c.openApp}
          </Link>
        </span>
      </nav>
    </header>
  );
}

/**
 * First screen: the street at night (our own vector scene run through dotfx's LED preset, docs/marketing), the
 * promise, and the search that leads into the listings below. The three other ways in sit under it as smaller buttons.
 * The artwork is the LCP element, so it is preloaded per viewport class and never lazy.
 */
export async function Hero({ demo, search }: { demo: boolean; search: ListingSearch }) {
  const t = await getDictionary();
  const copy = t.of(landingCopy);
  const c = copy.hero;
  const lines = (l: string[]) => l.flatMap((x, i) => (i ? [<br key={i} />, x] : [x]));
  const WAY = "mk-btn mk-btn-line mk-btn-glass mk-btn-sm";
  return (
    <section aria-label={c.label} className="mk-night">
      {/* React hoists these into <head>. */}
      <link rel="preload" as="image" type="image/avif" media={DESKTOP} imageSrcSet={set("street-wide", WIDE, "avif")} imageSizes={WIDE_SIZES} fetchPriority="high" />
      <link rel="preload" as="image" type="image/avif" media={PHONE} imageSrcSet={set("street-tall", TALL, "avif")} imageSizes={TALL_SIZES} fetchPriority="high" />

      <div className="mk-hero">
        <div className="mk-art">
          <div className="mk-art-pan">
            <picture>
              <source media={PHONE} type="image/avif" srcSet={set("street-tall", TALL, "avif")} sizes={TALL_SIZES} />
              <source media={PHONE} type="image/webp" srcSet={set("street-tall", TALL, "webp")} sizes={TALL_SIZES} />
              <source media={PHONE} srcSet="/marketing/street-tall-900.jpg" />
              <source type="image/avif" srcSet={set("street-wide", WIDE, "avif")} sizes={WIDE_SIZES} />
              <source type="image/webp" srcSet={set("street-wide", WIDE, "webp")} sizes={WIDE_SIZES} />
              {/* Art-directed <picture> with our own pre-built AVIF / WebP / JPEG: there is no image optimizer on Workers. */}
              <img
                src="/marketing/street-wide-1600.jpg"
                width={2400}
                height={1200}
                alt={c.artAlt}
                decoding="async"
                fetchPriority="high"
              />
            </picture>
          </div>
        </div>
        <div className="mk-glow" aria-hidden />
        <div className="mk-scrim" aria-hidden />

        <div className="mx-auto flex w-full max-w-7xl flex-col justify-start px-5 pt-20 pb-6 sm:px-8 md:pt-28 xl:flex-1 xl:justify-center xl:pt-24 xl:pb-12">
          <div className="max-w-[46rem]">
            <h1 className="mk-display">{t.head(landingCopy, (x) => lines(x.hero.h1))}</h1>
            <p className="mk-hero-copy mt-4 max-w-[36rem] text-base leading-relaxed text-foreground sm:mt-5 sm:text-xl sm:leading-relaxed">
              {c.body}
            </p>
            {/* Keyed by the search, so the fields follow the address ("Show all" clears them). */}
            <Search
              key={`${search.where}|${search.when}|${search.how}`}
              labels={copy.search}
              cities={LISTING_CITIES.map((city) => [city, copy.search.cities[city] ?? city])}
              today={new Date().toISOString().slice(0, 10)}
              initial={{ where: search.where ?? "", when: search.when ?? "", how: search.how }}
            />
            {/* Without JavaScript the phone's pill cannot open: show the fields instead. */}
            <noscript>
              <style>{".mk-search-fields{display:grid!important}.mk-search-pill{display:none!important}"}</style>
            </noscript>
            <ul aria-label={c.ways} className="mk-ways mt-4 sm:mt-5">
              {demo && (
                <li>
                  <Link prefetch={false} href="/demo" data-testid="mk-cta-demo" className={WAY}>
                    <PlayIcon />
                    {c.playDemo}
                  </Link>
                </li>
              )}
              <li>
                <Link prefetch={false} href={MYSTERY_BOX} title={c.mysteryBoxHint} data-testid="mk-cta-box" className={WAY}>
                  <BoxIcon />
                  {c.mysteryBox}
                </Link>
              </li>
              <li>
                <Link prefetch={false} href="/app" data-testid="mk-cta-app" className={WAY}>
                  {c.openApp}
                  <ArrowIcon />
                </Link>
              </li>
              <li>
                <Link prefetch={false} href="/how-it-works" data-testid="mk-cta-how" className="mk-hero-copy mk-link inline-flex min-h-11 items-center gap-1.5 px-1 text-[0.95rem] font-medium">
                  {c.how}
                  <ArrowIcon />
                </Link>
              </li>
            </ul>
            <p className="mk-hero-copy mt-3 text-sm text-muted-foreground" data-testid="mk-testnet">
              {c.testnet}
              {c.testnetMore}
              {t.lang === "zh" ? "。" : "."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

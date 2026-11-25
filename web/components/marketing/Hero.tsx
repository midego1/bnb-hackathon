import Link from "next/link";
import { LogoMark } from "@/components/LogoMark";
import { LangSwitch } from "@/components/LangSwitch";
import { ThemeCycleButton } from "@/components/ThemeSwitch";
import { getDictionary } from "@/lib/i18n/server";
import { landingCopy } from "./copy";
import { ArrowIcon, PlayIcon } from "./icons";

const WIDE = [1000, 1600, 2400];
const TALL = [600, 900, 1200];
const set = (name: string, widths: number[], ext: string) => widths.map((w) => `/marketing/${name}-${w}.${ext} ${w}w`).join(", ");
const PHONE = "(max-width: 767px)";
const DESKTOP = "(min-width: 768px)";
// The art covers the hero and is a little wider than it (it pans), so it renders wider than the viewport.
const WIDE_SIZES = "115vw";
const TALL_SIZES = "130vw";

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
        <ul className="ml-8 hidden items-center gap-7 text-[0.95rem] text-muted lg:flex">
          {c.nav.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="transition-colors hover:text-foreground">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <span className="ml-auto flex items-center gap-2 sm:gap-2.5">
          <LangSwitch className="hidden border-white/25 bg-white/10 text-white sm:inline-flex" />
          <ThemeCycleButton className="inline-flex !h-10 !w-10 !rounded-full !border-white/25 !bg-white/10 !text-white hover:!bg-white/20" />
          <Link prefetch={false} href="/app" data-testid="mk-open-app" className="mk-btn mk-btn-line !min-h-10 !px-3.5 !py-2 !text-[0.95rem] sm:!px-4">
            {c.openApp}
          </Link>
        </span>
      </nav>
    </header>
  );
}

/**
 * First screen: the street at night (our own vector scene run through dotfx's LED preset, docs/marketing), the promise
 * and the two ways in. The artwork is the LCP element, so it is preloaded per viewport class and never lazy.
 */
export async function Hero({ demo }: { demo: boolean }) {
  const t = await getDictionary();
  const c = t.of(landingCopy).hero;
  const lines = (l: string[]) => l.flatMap((x, i) => (i ? [<br key={i} />, x] : [x]));
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

        <div className="mx-auto flex w-full max-w-7xl flex-col justify-start px-5 pt-20 pb-6 sm:px-8 md:pt-28 xl:flex-1 xl:justify-center xl:pt-24 xl:pb-14">
          <div className="max-w-[46rem]">
            <h1 className="mk-display">{t.head(landingCopy, (x) => lines(x.hero.h1))}</h1>
            <p className="mk-hero-copy mt-4 max-w-[34rem] text-base leading-relaxed text-foreground sm:mt-5 sm:text-xl sm:leading-relaxed">
              {c.body}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5 sm:mt-7 sm:gap-3">
              {demo ? (
                <Link prefetch={false} href="/demo" data-testid="mk-cta-demo" className="mk-btn mk-btn-amber">
                  <PlayIcon />
                  {c.playDemo}
                </Link>
              ) : (
                <Link prefetch={false} href="/app" data-testid="mk-cta-demo" className="mk-btn mk-btn-amber">
                  {c.openApp}
                  <ArrowIcon />
                </Link>
              )}
              <Link prefetch={false} href="/how-it-works" data-testid="mk-cta-how" className="mk-btn mk-btn-line bg-[rgb(13_11_42/0.55)]">
                {c.how}
              </Link>
            </div>
            <p className="mk-hero-copy mt-3.5 flex items-center gap-2 text-sm text-muted md:mt-5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--mk-teal)]" aria-hidden />
              <span>
                {c.testnet}
                <span className="hidden md:inline">{c.testnetMore}</span>
                {t.lang === "zh" ? "。" : "."}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* What the promise means for one real-sized rental. */}
      <div className="border-t border-border">
        <dl className="mx-auto grid max-w-7xl gap-x-10 gap-y-5 px-5 py-6 sm:grid-cols-3 sm:px-8">
          {c.facts.map(([term, value]) => (
            <div key={term}>
              <dt className="text-sm text-subtle">{term}</dt>
              <dd className="mk-h3 mt-1 text-xl sm:text-2xl">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mx-auto max-w-7xl px-5 pb-6 text-xs text-subtle sm:px-8">
          {c.example}
        </p>
      </div>
    </section>
  );
}

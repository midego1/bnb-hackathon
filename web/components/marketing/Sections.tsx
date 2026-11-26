import Link from "next/link";
import type { ReactNode } from "react";
import { LangSwitch } from "@/components/LangSwitch";
import { LogoMark } from "@/components/LogoMark";
import { ACTIONS } from "@/lib/actions/definitions";
import { docsUrl, REPO_URL } from "@/lib/links";
import { getDictionary } from "@/lib/i18n/server";
import {
  ARBITER_DAYS,
  baht,
  EXAMPLE,
  explorerAddress,
  explorerTx,
  FLEET_OPERATOR_FEE_PERCENT,
  INSPECTOR_AGENT,
  INSPECTOR_TOOLS,
  OWNER_RESPONSE_DAYS,
  RENT_PERIOD_DAYS,
  rentPer,
  TESTNET_CONTRACTS,
  TESTS_URL,
} from "@/lib/marketing";
import { landingCopy, type LandingCopy } from "./copy";
import { MYSTERY_BOX } from "./Hero";
import { ArrowIcon, BoxIcon, CheckIcon, CrossIcon, ExternalIcon, PlayIcon } from "./icons";
import { MoneyFlow, type FlowFrame } from "./MoneyFlow";

const WRAP = "mx-auto w-full max-w-7xl px-5 sm:px-8";
const H2 = "mk-display text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]";
// About 70 characters a line in Geist at this size.
const LEAD = "mt-4 max-w-[38rem] text-lg leading-relaxed text-muted-foreground";

/** The section's copy in the visitor's language, and its headlines (bilingual in EN+中文). */
async function copyFor<K extends keyof LandingCopy>(key: K) {
  const t = await getDictionary();
  return { c: t.of(landingCopy)[key], h: (pick: (s: LandingCopy[K]) => ReactNode) => t.head(landingCopy, (x) => pick(x[key])), t };
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mk-link inline-flex items-center gap-1">
      {children}
      <ExternalIcon />
    </a>
  );
}

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link prefetch={false} href={href} className="mk-link inline-flex items-center gap-2 font-medium">
      {children} <ArrowIcon />
    </Link>
  );
}

const TILE_SIZES = "(min-width: 768px) 30vw, 45vw";
const tile = (name: string, ext: string) => [480, 960].map((w) => `/marketing/${name}-${w}.${ext} ${w}w`).join(", ");

/** One of the two LED pictures above the comparison (our own drawings through dotfx, docs/marketing). */
function Tile({ name, alt, label }: { name: string; alt: string; label: string }) {
  return (
    <figure className="pt-5">
      <picture>
        <source type="image/avif" srcSet={tile(name, "avif")} sizes={TILE_SIZES} />
        <source type="image/webp" srcSet={tile(name, "webp")} sizes={TILE_SIZES} />
        <img src={`/marketing/${name}-960.jpg`} width={960} height={720} alt={alt} loading="lazy" decoding="async" className="h-auto w-full rounded-lg" />
      </picture>
      <figcaption className="mk-h3 mt-3 text-lg">{label}</figcaption>
    </figure>
  );
}

/** The problem and the promise: the counter today against the counter with KeyEscrow, row by row. */
export async function Counter() {
  const { c, h } = await copyFor("counter");
  return (
    <section aria-labelledby="why" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="why" className={H2}>
        {h((s) => s.title)}
      </h2>
      <div className="mt-8 grid grid-cols-2 gap-x-4 text-base md:mt-10 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-10 md:border-t md:border-border-strong">
        <p className="col-span-2 max-w-[38rem] text-lg leading-relaxed text-muted-foreground md:col-span-1 md:pt-5">{c.lead}</p>
        <Tile name="today" alt={c.art[0]} label={c.today} />
        <Tile name="escrow" alt={c.art[1]} label={c.ours} />
        {c.rows.map(([what, today, ours], i) => (
          <div key={what} className={`col-span-2 grid gap-x-10 gap-y-2 border-b border-border py-5 md:col-span-3 md:grid-cols-subgrid ${i ? "" : "mt-6 border-t"}`}>
            <h3 className="font-medium">{h((s) => s.rows[i][0])}</h3>
            <p className="flex gap-2.5 text-muted-foreground">
              <span className="mt-0.5 shrink-0 text-danger">
                <CrossIcon />
              </span>
              <span>
                <span className="sr-only">{c.today}: </span>
                {today}
              </span>
            </p>
            <p className="flex gap-2.5">
              <span className="mt-0.5 shrink-0 text-success">
                <CheckIcon />
              </span>
              <span>
                <span className="sr-only">{c.ours}: </span>
                {ours}
              </span>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Proof that it is real: the four verified testnet contracts, the tests and the agent's registration. */
export async function Live() {
  const { c, h } = await copyFor("live");
  return (
    <section id="live" aria-labelledby="live-h" className="border-y border-border bg-surface">
      <div className={`${WRAP} py-20 sm:py-28`}>
        <h2 id="live-h" className={H2}>
          {h((s) => s.title)}
        </h2>
        <p className={LEAD}>{c.lead}</p>
        <table className="mt-10 block w-full border-collapse text-left md:table">
          <caption className="sr-only">{c.caption}</caption>
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-border-strong text-sm text-subtle">
              {c.cols.map((col) => (
                <th key={col} scope="col" className="py-3 pr-6 font-normal last:pr-0">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block border-t border-border-strong md:table-row-group md:border-0">
            {TESTNET_CONTRACTS.map((k) => (
              <tr key={k.name} className="block border-b border-border py-4 align-baseline md:table-row md:py-0">
                <th scope="row" className="mk-h3 block text-lg whitespace-nowrap md:table-cell md:py-4 md:pr-6">
                  {k.name}
                </th>
                <td className="block pt-1 text-muted-foreground md:table-cell md:py-4 md:pr-6">{c.roles[k.name]}</td>
                <td className="block pt-2 md:table-cell md:py-4">
                  <a href={explorerAddress(k.address)} className="mk-link mk-code inline-flex items-center gap-1.5 whitespace-nowrap" data-testid="mk-contract">
                    {k.address.slice(0, 10)}…{k.address.slice(-8)}
                    <ExternalIcon />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[0.95rem]">
          <Ext href={TESTS_URL}>{c.tests[0]}</Ext>
          <Ext href={explorerTx(INSPECTOR_AGENT.registerTx)}>{c.tests[1]}</Ext>
        </p>
        <div className="mt-14 grid gap-x-16 gap-y-10 lg:grid-cols-2">
          <div>
            <h3 className="mk-h3 text-2xl">{h((s) => s.prices)}</h3>
            <p className="mt-3 max-w-[58ch] leading-relaxed text-muted-foreground">{c.pricesBody}</p>
          </div>
          <div>
            <h3 className="mk-h3 text-2xl">{h((s) => s.risk)}</h3>
            <p className="mt-3 max-w-[58ch] leading-relaxed text-muted-foreground">
              {c.riskBody[0]}
              <Link prefetch={false} href="/integrations" className="mk-link" data-testid="mk-integrations">
                {c.riskBody[1]}
              </Link>
              {c.riskBody[2]}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** How it works: the example rental's baht on an LED board, step by step (MoneyFlow is the page's one island of its own). */
export async function Flow({ demo }: { demo: boolean }) {
  const { c, h } = await copyFor("how");
  const e = EXAMPLE;
  // What is with the renter, in the escrow and with the owner at each step (the one-time fee is the rest).
  const frames: FlowFrame[] = [
    { renter: baht(e.funded), escrow: baht(0), owner: baht(0) },
    { renter: baht(0), escrow: baht(e.funded), owner: baht(0), a: { dir: "fwd", tag: baht(e.funded) } },
    { renter: baht(0), escrow: baht(e.deposit), owner: baht(e.firstPayout), b: { tag: baht(e.firstPayout) }, fee: true },
    { renter: baht(e.deposit), escrow: baht(0), owner: baht(e.firstPayout), a: { dir: "rev", tag: baht(e.deposit) }, fee: true },
  ];
  const damage: FlowFrame = { renter: baht(e.refund), escrow: baht(0), owner: baht(e.firstPayout + e.claim), a: { dir: "rev", tag: baht(e.refund) }, b: { tag: baht(e.claim) }, fee: true };
  return (
    <section aria-labelledby="how" className="mk-night">
      <div className={`${WRAP} py-20 sm:py-28`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          {/* The page's centrepiece gets a bigger headline than the sections around it. */}
          <h2 id="how" className="mk-display text-[clamp(2.25rem,1.2rem+4vw,4.5rem)]">
            {h((s) => s.title)}
          </h2>
          <Link prefetch={false} href="/how-it-works" className="mk-link inline-flex items-center gap-2 text-base font-medium">
            <PlayIcon />
            {c.cartoon}
          </Link>
        </div>
        <p className={LEAD}>{c.lead}</p>
        <MoneyFlow labels={c.board} steps={c.steps.map((s, i) => ({ title: h((x) => x.steps[i].title), body: s.body }))} frames={frames} damageFrame={damage} damageBody={c.damageBody} />
        {demo && (
          <p className="mt-8">
            <Link prefetch={false} href="/demo" className="mk-btn mk-btn-amber" data-testid="mk-flow-demo">
              {c.cta}
              <ArrowIcon />
            </Link>
          </p>
        )}
        <p className="mt-6 max-w-[32rem] text-sm text-subtle">{c.note}</p>
      </div>
    </section>
  );
}

/** The return inspection: the two demo photo sets and the shape of what the inspector returns. */
export async function Inspection() {
  const { c, h } = await copyFor("inspection");
  return (
    <section id="inspection" aria-labelledby="inspection-h" className={`${WRAP} py-20 sm:py-28`}>
      <div className="grid items-start gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div>
          <h2 id="inspection-h" className={H2}>
            {h((s) => s.title)}
          </h2>
          <p className={LEAD}>{c.lead}</p>
          <ul className="mt-8 space-y-4 text-base leading-relaxed">
            {c.points.map(([lead, rest]) => (
              <li key={lead} className="flex gap-3">
                <span className="mt-1 shrink-0 text-success">
                  <CheckIcon />
                </span>
                <span>
                  <strong className="font-semibold">{lead}</strong> <span className="text-muted-foreground">{rest}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <figure className="min-w-0">
          <div className="grid grid-cols-2 gap-3">
            {c.photos.map(([file, label, alt]) => (
              <div key={file}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small pre-built WebP, sized, lazy */}
                <img src={`/marketing/${file}.webp`} width={640} height={480} alt={alt} loading="lazy" decoding="async" className="h-auto w-full rounded-lg border border-border" />
                <p className="mt-2 text-sm font-medium">{label}</p>
              </div>
            ))}
          </div>
          <pre className="mk-code mk-scroll-x mt-5 rounded-lg border border-border bg-surface p-4" tabIndex={0} aria-label={c.codeLabel}>
            {c.code}
          </pre>
          <figcaption className="mt-3 text-sm text-subtle">
            {c.caption}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Three ways a return ends, on one 14-day scale. */
export async function Deadlines() {
  const { c, h } = await copyFor("deadlines");
  const lanes = [
    { days: 0, tone: "bg-[var(--mk-teal)]" },
    { days: OWNER_RESPONSE_DAYS, tone: "bg-[var(--mk-amber)]" },
    { days: ARBITER_DAYS, tone: "bg-[var(--mk-pink)]" },
  ].map((l, i) => ({ ...l, ...c.lanes[i] }));
  return (
    <section aria-labelledby="disputes" className="mk-night">
      <div className={`${WRAP} py-20 sm:py-28`}>
        <h2 id="disputes" className={H2}>
          {h((s) => s.title)}
        </h2>
        <p className={LEAD}>{c.lead}</p>
        <div className="mt-12 hidden gap-x-10 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]" aria-hidden>
          <span />
          <div className="mk-lane-scale mk-num">
            <span style={{ left: 0 }}>{c.day(0)}</span>
            <span style={{ left: `${(OWNER_RESPONSE_DAYS / ARBITER_DAYS) * 100}%`, transform: "translateX(-50%)" }}>{c.day(OWNER_RESPONSE_DAYS)}</span>
            <span style={{ right: 0 }}>{c.day(ARBITER_DAYS)}</span>
          </div>
        </div>
        <ol className="mt-10 space-y-9 md:mt-4">
          {lanes.map((l, i) => (
            <li key={i} className="grid gap-x-10 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:items-center">
              <div>
                <h3 className="mk-h3 text-2xl">{h((s) => s.lanes[i].title)}</h3>
                <p className="mt-2 max-w-[48ch] leading-relaxed text-muted-foreground">{l.body}</p>
              </div>
              <div>
                <div className="mk-lane-track" aria-hidden>
                  <span className={`mk-lane-fill ${l.tone}`} style={{ width: `${(l.days / ARBITER_DAYS) * 100}%` }} />
                </div>
                <p className="mk-num mt-2 text-sm font-medium">{l.end}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-sm text-subtle">
          {c.note}{" "}
          <Link prefetch={false} href="/arbiter" className="mk-link">
            {c.desk}
          </Link>
        </p>
      </div>
    </section>
  );
}

/** What a scooter shop gets: subscriptions, the Fleet Vault and the dispute desk, each with its own small figure. */
export async function Shops() {
  const { c, h } = await copyFor("shops");
  const rest = 100 - FLEET_OPERATOR_FEE_PERCENT;
  const ROW = "grid gap-x-16 gap-y-6 border-t border-border py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]";
  const BODY = "mt-3 max-w-[56ch] leading-relaxed text-muted-foreground";
  return (
    <section id="shops" aria-labelledby="shops-h" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="shops-h" className={H2}>
        {h((s) => s.title)}
      </h2>
      <p className={LEAD}>{c.lead}</p>

      <div className={`${ROW} mt-12`}>
        <div>
          <h3 className="mk-h3 text-2xl">{h((s) => s.subs.title)}</h3>
          <p className={BODY}>{c.subs.body}</p>
          <p className="mt-4">
            <Go href="/app/subscriptions">{c.subs.link}</Go>
          </p>
        </div>
        <figure>
          <dl className="mk-num border-b border-border">
            {RENT_PERIOD_DAYS.map((days, i) => (
              <div key={days} className="flex items-baseline justify-between gap-4 border-t border-border py-3">
                <dt className="font-medium">{c.subs.rhythms[i]}</dt>
                <dd className="text-right">
                  <span className="font-mono text-lg">{baht(rentPer(days))}</span> <span className="text-sm text-subtle">{c.subs.per}</span>
                </dd>
              </div>
            ))}
          </dl>
          <figcaption className="mt-3 text-sm text-subtle">{c.subs.caption}</figcaption>
        </figure>
      </div>

      <div className={ROW} id="fleet">
        <div>
          <h3 className="mk-h3 text-2xl">{h((s) => s.vault.title)}</h3>
          <p className={BODY}>{c.vault.body}</p>
          <p className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <Go href="/landlord">{c.vault.owners}</Go>
            <Go href="/shareholders">{c.vault.holders}</Go>
          </p>
        </div>
        <figure>
          <div className="flex h-5 gap-1 overflow-hidden rounded-full" role="img" aria-label={c.vault.splitLabel(rest)}>
            <span className="bg-foreground" style={{ width: `${FLEET_OPERATOR_FEE_PERCENT}%` }} />
            <span className="flex-1 bg-[var(--mk-teal)]" />
          </div>
          <p className="mt-2.5 flex justify-between gap-4 text-sm font-medium" aria-hidden>
            <span>{c.vault.operator}</span>
            <span>{c.vault.toHolders(rest)}</span>
          </p>
          <figcaption className="mt-3 text-sm text-subtle">{c.vault.caption}</figcaption>
        </figure>
      </div>

      <div className={`${ROW} border-b`}>
        <div>
          <h3 className="mk-h3 text-2xl">{h((s) => s.desk.title)}</h3>
          <p className={BODY}>{c.desk.body}</p>
        </div>
        <div>
          <h4 className="text-sm text-subtle">{c.desk.sees}</h4>
          <ul className="mt-3 space-y-2.5">
            {c.desk.evidence.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 text-success">
                  <CheckIcon />
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-5">
            <Go href="/arbiter">{c.desk.link}</Go>
          </p>
        </div>
      </div>
    </section>
  );
}

/** One definition per rental action: REST endpoint, MCP tool and A2A skill. */
export async function Agents() {
  const { c, h } = await copyFor("agents");
  return (
    <section id="agents" aria-labelledby="agents-h" className="mk-night">
      <div className={`${WRAP} grid gap-x-16 gap-y-12 py-20 sm:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}>
        <div>
          <h2 id="agents-h" className={H2}>
            {h((s) => s.title)}
          </h2>
          <p className={LEAD}>
            {c.lead[0]}
            <code className="mk-code">prepare_*</code>
            {c.lead[1]}
          </p>
          <p className="mt-5 max-w-[62ch] leading-relaxed text-muted-foreground">
            {c.inspector[0]}
            <Ext href={explorerTx(INSPECTOR_AGENT.registerTx)}>{c.inspector[1]}</Ext>
            {c.inspector[2]}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link prefetch={false} href="/developers" data-testid="mk-developers" className="mk-btn mk-btn-amber">
              {c.developers}
              <ArrowIcon />
            </Link>
            <a href={docsUrl("AGENT.md")} className="mk-btn mk-btn-line">
              {c.docs}
            </a>
          </div>
        </div>
        <div className="min-w-0">
          <pre className="mk-code mk-scroll-x rounded-lg border border-border bg-surface p-4" tabIndex={0} aria-label={c.codeLabel}>
            {c.code}
          </pre>
          <h3 className="mt-8 text-sm text-subtle">
            {c.tools(ACTIONS.length, INSPECTOR_TOOLS.length)}
          </h3>
          <ul className="mk-code mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-muted-foreground">
            {[...ACTIONS.map((a) => a.name), ...INSPECTOR_TOOLS].map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export async function Fee() {
  const { c, h } = await copyFor("fee");
  const amounts = [EXAMPLE.rent, EXAMPLE.deposit, EXAMPLE.funded, EXAMPLE.fee, EXAMPLE.firstPayout, EXAMPLE.rent];
  const rows = c.rows.map((label, i): [string, number, string?] => [label, amounts[i], i === 3 ? "font-semibold" : undefined]);
  return (
    <section id="fee" aria-labelledby="fee-h" className="mk-amber" data-testid="fee-pitch">
      <div className={`${WRAP} grid gap-x-16 gap-y-10 py-20 sm:py-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]`}>
        <h2 id="fee-h" className="mk-display text-[clamp(2.4rem,1.2rem+5vw,5.5rem)] leading-[0.98] lg:col-span-2">
          {h((s) => s.title)}
        </h2>
        <p className="max-w-[46ch] text-lg leading-relaxed text-muted-foreground">{c.body}</p>
        <div>
          <table className="mk-num w-full border-collapse text-left">
            <caption className="pb-3 text-left text-sm text-subtle">{c.caption}</caption>
            <tbody>
              {rows.map(([label, value, cls]) => (
                <tr key={label} className={`border-t border-border ${cls ?? ""}`}>
                  <th scope="row" className="py-3 pr-4 font-[weight:inherit]">
                    {label}
                  </th>
                  <td className="py-3 text-right font-mono text-lg">{baht(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 max-w-[32rem] text-sm text-subtle">
            {c.note}
          </p>
        </div>
      </div>
    </section>
  );
}

/** What exists today and what is only planned, said in words on every row. */
export async function Roadmap() {
  const { c, h } = await copyFor("roadmap");
  return (
    <section aria-labelledby="roadmap" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="roadmap" className={H2}>
        {h((s) => s.title)}
      </h2>
      <p className={LEAD}>{c.lead}</p>
      <ol className="mt-12 border-t border-border-strong">
        {c.phases.map(([when, , body], i) => (
          <li key={i} className="grid gap-x-10 gap-y-1 border-b border-border py-6 md:grid-cols-[10rem_14rem_minmax(0,1fr)] md:items-baseline" data-testid="mk-phase">
            <p className="mk-num text-sm text-subtle">
              {when}
              <span className={`mk-status ${i ? "" : "mk-status-live"}`}>{i ? c.planned : c.live}</span>
            </p>
            <h3 className="mk-h3 text-xl">{h((s) => s.phases[i][1])}</h3>
            <p className="max-w-[36rem] leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-subtle">
        {c.more} <Ext href={docsUrl("BUSINESS.md")}>{c.business}</Ext>
      </p>
    </section>
  );
}

/** The last ask, on the night band the page opened with: the same three ways in, and the code. */
export async function ClosingCta({ demo }: { demo: boolean }) {
  const { c, h } = await copyFor("closing");
  return (
    <section aria-labelledby="closing" className="mk-night mk-closing">
      {/* The street the page opened on, once more behind the last ask (not on phones). Decorative here: the hero describes it. */}
      <picture>
        <source type="image/avif" srcSet="/marketing/street-wide-1000.avif" />
        <source type="image/webp" srcSet="/marketing/street-wide-1000.webp" />
        <img src="/marketing/street-wide-1600.jpg" width={2400} height={1200} alt="" loading="lazy" decoding="async" className="mk-closing-art" />
      </picture>
      <div className={`${WRAP} py-20 sm:py-24`}>
        <h2 id="closing" className="mk-display max-w-[18ch] text-[clamp(2.2rem,1.3rem+3.6vw,4rem)]">
          {h((s) => s.title)}
        </h2>
        <p className={LEAD}>{demo ? c.demo : c.app}</p>
        <div className="mk-ctas mt-8">
          {demo && (
            <Link prefetch={false} href="/demo" className="mk-btn mk-btn-amber">
              <PlayIcon />
              {c.playDemo}
            </Link>
          )}
          <Link prefetch={false} href={MYSTERY_BOX} className={`mk-btn ${demo ? "mk-btn-line" : "mk-btn-amber"}`}>
            <BoxIcon />
            {c.mysteryBox}
          </Link>
          <Link prefetch={false} href="/app" className="mk-btn mk-btn-line">
            {c.openApp}
            <ArrowIcon />
          </Link>
        </div>
        <p className="mt-6">
          <a href={REPO_URL} className="mk-link inline-flex min-h-8 items-center gap-1.5 font-medium" data-testid="mk-github">
            {c.github}
            <ExternalIcon />
          </a>
        </p>
      </div>
    </section>
  );
}

export async function SiteFooter({ demo }: { demo: boolean }) {
  const { c, t } = await copyFor("footer");
  const l = c.links;
  const columns: [string, [string, string, boolean?][]][] = [
    [
      c.tryIt,
      [
        ...(demo ? ([["/demo", l.demo]] as [string, string][]) : []),
        [MYSTERY_BOX, l.mysteryBox],
        ["/how-it-works", l.cartoon],
        ["/app", l.app],
        ["/tenant", l.tenant],
        ["/app/subscriptions", l.subscriptions],
        ["/landlord", l.landlord],
        ["/shareholders", l.shareholders],
        ["/arbiter", l.arbiter],
      ],
    ],
    [
      c.build,
      [
        ["/developers", l.developers],
        ["/integrations", l.integrations],
        [docsUrl("AGENT.md"), l.agent, true],
        [docsUrl("API.md"), l.api, true],
        [docsUrl("ARCHITECTURE.md"), l.architecture, true],
      ],
    ],
    [
      c.read,
      [
        [REPO_URL, l.github, true],
        [docsUrl("BUSINESS.md"), l.business, true],
        [docsUrl("WRITEUP.md"), l.writeup, true],
        [docsUrl("DEPLOY.md"), l.deploy, true],
      ],
    ],
  ];
  return (
    <footer className="mk-night">
      <div className={`${WRAP} pb-16`}>
        <nav aria-label={c.label} className="grid gap-x-10 gap-y-10 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="flex items-center gap-2.5 text-xl">
              <LogoMark className="h-8 w-8" />
              <span className="mk-display">KeyEscrow</span>
            </p>
            <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-subtle">{c.about}</p>
            <LangSwitch className="mt-4 inline-flex border-border text-foreground" />
            {t.mode !== "en" && (
              <p className="mt-3 max-w-[34ch] text-sm text-subtle" data-testid="ai-translated">
                {t.h("aiNote")}
              </p>
            )}
          </div>
          {columns.map(([title, links]) => (
            <div key={title}>
              <h3 className="text-sm text-subtle">{title}</h3>
              <ul className="mt-4 space-y-2.5 text-[0.95rem]">
                {links.map(([href, label, external]) => (
                  <li key={href}>
                    {external ? (
                      <a href={href} className="text-muted-foreground transition-colors hover:text-foreground">
                        {label}
                      </a>
                    ) : (
                      <Link prefetch={false} href={href} className="text-muted-foreground transition-colors hover:text-foreground">
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { LangSwitch } from "@/components/LangSwitch";
import { LogoMark } from "@/components/LogoMark";
import { ACTIONS } from "@/lib/actions/definitions";
import { docsUrl, REPO_URL } from "@/lib/links";
import { getDictionary } from "@/lib/i18n/server";
import { ARBITER_DAYS, baht, EXAMPLE, explorerAddress, explorerTx, FLEET_OPERATOR_FEE_PERCENT, INSPECTOR_AGENT, INSPECTOR_TOOLS, OWNER_RESPONSE_DAYS, TESTNET_CONTRACTS } from "@/lib/marketing";
import { landingCopy, type LandingCopy } from "./copy";
import { ArrowIcon, CheckIcon, CrossIcon, ExternalIcon, PlayIcon } from "./icons";

const WRAP = "mx-auto w-full max-w-7xl px-5 sm:px-8";
const H2 = "mk-display text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]";
const LEAD = "mt-4 max-w-[62ch] text-lg leading-relaxed text-muted-foreground";

/** The section's copy in the visitor's language, and its headlines (bilingual in EN+中文). */
async function copyFor<K extends keyof LandingCopy>(key: K) {
  const t = await getDictionary();
  return { c: t.of(landingCopy)[key], h: (pick: (s: LandingCopy[K]) => ReactNode) => t.head(landingCopy, (x) => pick(x[key])), t };
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mk-link">
      {children} <span className="inline-block align-[-2px]"><ExternalIcon /></span>
    </a>
  );
}

/** The counter today against the counter with KeyEscrow, row by row. */
export async function Counter() {
  const { c, h } = await copyFor("counter");
  return (
    <section aria-labelledby="why" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="why" className={H2}>
        {h((s) => s.title)}
      </h2>
      <p className={LEAD}>{c.lead}</p>
      <div className="mt-10 grid gap-x-10 border-t border-border-strong text-base md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
        <p className="hidden pt-4 text-sm text-subtle md:block" aria-hidden />
        <p className="hidden pt-4 text-sm text-subtle md:block" aria-hidden>
          {c.today}
        </p>
        <p className="hidden pt-4 text-sm text-subtle md:block" aria-hidden>
          {c.ours}
        </p>
        {c.rows.map(([what, today, ours], i) => (
          <div key={what} className="grid gap-x-10 gap-y-2 border-b border-border py-5 md:col-span-3 md:grid-cols-subgrid">
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

/** Four steps, each with where the example rental's money is at that point. */
export async function HowItWorks() {
  const { c, h } = await copyFor("how");
  return (
    <section aria-labelledby="how" className="border-y border-border bg-surface">
      <div className={`${WRAP} py-20 sm:py-28`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 id="how" className={H2}>
            {h((s) => s.title)}
          </h2>
          <Link prefetch={false} href="/how-it-works" className="mk-link inline-flex items-center gap-2 text-base font-medium">
            <PlayIcon />
            {c.cartoon}
          </Link>
        </div>
        <ol className="mk-stops mt-16 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
          {c.steps.map((s, i) => (
            <li key={i} className="mk-stop flex flex-col">
              <h3 className="mk-h3 mt-2 text-2xl">{h((x) => x.steps[i].title)}</h3>
              <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">{s.body}</p>
              <dl className="mk-num mt-5 space-y-1.5 border-t border-border pt-4 text-sm">
                {s.money.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3">
                    <dt className="text-subtle">{k}</dt>
                    <dd className={v.startsWith("฿") ? "font-mono text-base font-medium" : "font-medium"}>{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
        <p className="mt-10 max-w-[75ch] text-sm text-subtle">
          {c.note}
        </p>
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

export async function FleetVault() {
  const { c, h } = await copyFor("fleet");
  const rest = 100 - FLEET_OPERATOR_FEE_PERCENT;
  return (
    <section id="fleet" aria-labelledby="fleet-h" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="fleet-h" className={H2}>
        {h((s) => s.title)}
      </h2>
      <p className={LEAD}>{c.lead}</p>
      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-2">
        <div>
          <h3 className="mk-h3 text-2xl">{h((s) => s.owners)}</h3>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-muted-foreground">{c.ownersBody}</p>
          <Link prefetch={false} href="/landlord" className="mk-link mt-4 inline-flex items-center gap-2 font-medium">
            {c.ownersLink} <ArrowIcon />
          </Link>
        </div>
        <div>
          <h3 className="mk-h3 text-2xl">{h((s) => s.holders)}</h3>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-muted-foreground">{c.holdersBody}</p>
          <Link prefetch={false} href="/shareholders" className="mk-link mt-4 inline-flex items-center gap-2 font-medium">
            {c.holdersLink} <ArrowIcon />
          </Link>
        </div>
      </div>
      <figure className="mt-12">
        <div className="flex h-14 overflow-hidden rounded-lg text-sm font-medium" role="img" aria-label={c.splitLabel(rest)}>
          <span className="grid place-items-center bg-foreground px-2 text-background" style={{ width: `${FLEET_OPERATOR_FEE_PERCENT}%`, minWidth: "7.5rem" }}>
            {c.operator}
          </span>
          <span className="grid flex-1 place-items-center bg-[var(--mk-teal)] px-3 text-[#06231f]">{c.toHolders(rest)}</span>
        </div>
        <figcaption className="mt-3 max-w-[75ch] text-sm text-subtle">
          {c.caption}
        </figcaption>
      </figure>
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

export async function Live() {
  const { c, h } = await copyFor("live");
  return (
    <section id="live" aria-labelledby="live-h" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="live-h" className={H2}>
        {h((s) => s.title)}
      </h2>
      <p className={LEAD}>{c.lead}</p>
      <table className="mt-10 block w-full border-collapse text-left md:table">
        <caption className="sr-only">{c.caption}</caption>
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-border-strong text-sm text-subtle">
            <th scope="col" className="py-3 pr-6 font-normal">
              {c.cols[0]}
            </th>
            <th scope="col" className="py-3 pr-6 font-normal">
              {c.cols[1]}
            </th>
            <th scope="col" className="py-3 font-normal">
              {c.cols[2]}
            </th>
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
                  <th scope="row" className="py-3 pr-4 font-[inherit]">
                    {label}
                  </th>
                  <td className="py-3 text-right font-mono text-lg">{baht(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-subtle">
            {c.note}
          </p>
        </div>
      </div>
    </section>
  );
}

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
          <li key={i} className="grid gap-x-10 gap-y-1 border-b border-border py-6 md:grid-cols-[10rem_14rem_minmax(0,1fr)] md:items-baseline">
            <p className="mk-num text-sm text-subtle">{when}</p>
            <h3 className="mk-h3 text-xl">{h((s) => s.phases[i][1])}</h3>
            <p className="max-w-[68ch] leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-subtle">
        {c.more} <Ext href={docsUrl("BUSINESS.md")}>{c.business}</Ext>
      </p>
    </section>
  );
}

/** The last ask, on the night band the page opened with. */
export async function ClosingCta({ demo }: { demo: boolean }) {
  const { c, h } = await copyFor("closing");
  return (
    <section aria-labelledby="closing" className="mk-night">
      <div className={`${WRAP} py-20 sm:py-24`}>
        <h2 id="closing" className="mk-display max-w-[18ch] text-[clamp(2.2rem,1.3rem+3.6vw,4rem)]">
          {h((s) => s.title)}
        </h2>
        <p className={LEAD}>{demo ? c.demo : c.app}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link prefetch={false} href={demo ? "/demo" : "/app"} className="mk-btn mk-btn-amber">
            {demo && <PlayIcon />}
            {demo ? c.playDemo : c.openApp}
          </Link>
          <a href={REPO_URL} className="mk-btn mk-btn-line" data-testid="mk-github">
            {c.github}
          </a>
        </div>
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
        ["/how-it-works", l.cartoon],
        ["/app", l.app],
        ["/tenant", l.tenant],
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
                      <a href={href} className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground">
                        {label}
                      </a>
                    ) : (
                      <Link prefetch={false} href={href} className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground">
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

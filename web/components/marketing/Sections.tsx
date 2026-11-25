import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/LogoMark";
import { ACTIONS } from "@/lib/actions/definitions";
import { docsUrl, REPO_URL } from "@/lib/links";
import {
  ARBITER_DAYS,
  baht,
  EXAMPLE,
  explorerAddress,
  explorerTx,
  FEE_PERCENT,
  FLEET_OPERATOR_FEE_PERCENT,
  INSPECTOR_AGENT,
  INSPECTOR_TOOLS,
  OWNER_RESPONSE_DAYS,
  TESTNET_CONTRACTS,
} from "@/lib/marketing";
import { ArrowIcon, CheckIcon, CrossIcon, ExternalIcon, PlayIcon } from "./icons";

const WRAP = "mx-auto w-full max-w-7xl px-5 sm:px-8";
const H2 = "mk-display text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]";
const LEAD = "mt-4 max-w-[62ch] text-lg leading-relaxed text-muted-foreground";

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="mk-link inline-flex items-center gap-1">
      {children}
      <ExternalIcon />
    </a>
  );
}

/** The counter today against the counter with KeyEscrow, row by row. */
export function Counter() {
  const rows = [
    ["The deposit", "Your passport or cash, in the shop's drawer", "Tokens in a contract made for this one rental"],
    ["Proof of the scooter's condition", "A few chat photos, if any", "Guided pickup and return photos, their fingerprints stored on-chain"],
    ["At return", "Whoever holds the passport wins the argument", "An AI inspection proposes a split; both sides accept, or the dispute desk rules"],
    ["If the other side goes quiet", "You wait, or you fly home without it", `After ${OWNER_RESPONSE_DAYS} days of silence the full deposit goes back to the renter`],
  ];
  return (
    <section aria-labelledby="why" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="why" className={H2}>
        The same counter, with nobody holding your passport.
      </h2>
      <p className={LEAD}>
        Renters fear bogus damage claims. Shop owners face real damage with no proof. Neither has anyone neutral to turn to, and nobody goes
        to court over a few thousand baht.
      </p>
      <div className="mt-10 grid gap-x-10 border-t border-border-strong text-base md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
        <p className="hidden pt-4 text-sm text-subtle md:block" aria-hidden />
        <p className="hidden pt-4 text-sm text-subtle md:block" aria-hidden>
          Today
        </p>
        <p className="hidden pt-4 text-sm text-subtle md:block" aria-hidden>
          With KeyEscrow
        </p>
        {rows.map(([what, today, ours]) => (
          <div key={what} className="grid gap-x-10 gap-y-2 border-b border-border py-5 md:col-span-3 md:grid-cols-subgrid">
            <h3 className="font-medium">{what}</h3>
            <p className="flex gap-2.5 text-muted-foreground">
              <span className="mt-0.5 shrink-0 text-danger">
                <CrossIcon />
              </span>
              <span>
                <span className="sr-only">Today: </span>
                {today}
              </span>
            </p>
            <p className="flex gap-2.5">
              <span className="mt-0.5 shrink-0 text-success">
                <CheckIcon />
              </span>
              <span>
                <span className="sr-only">With KeyEscrow: </span>
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
export function HowItWorks() {
  const steps = [
    {
      title: "The shop offers the scooter",
      body: "Rent, deposit and rental period, priced in baht. The rental agreement and guided pickup photos stay off-chain; only their SHA-256 fingerprints go on-chain.",
      money: [
        ["In escrow", baht(0)],
        ["Passport", "with the renter"],
      ],
    },
    {
      title: "The renter funds the escrow",
      body: "The deposit and the first month's rent go into this rental's own contract, instead of a passport at the counter.",
      money: [
        ["In escrow", baht(EXAMPLE.funded)],
        ["of which deposit", baht(EXAMPLE.deposit)],
      ],
    },
    {
      title: "Ride. Rent is paid out monthly",
      body: "Rent is released to the owner on a fixed 30-day schedule. KeyEscrow's fee comes out of the first payout only, never out of the deposit.",
      money: [
        ["Owner, month 1", baht(EXAMPLE.firstPayout)],
        ["Still in escrow", baht(EXAMPLE.deposit)],
      ],
    },
    {
      title: "Return the scooter, settle in minutes",
      body: "An AI inspection compares pickup and return photos and proposes a split of the deposit. One side proposes, the other accepts, and the money moves at once.",
      money: [
        ["Back to the renter", baht(EXAMPLE.deposit)],
        ["In escrow", baht(0)],
      ],
    },
  ];
  return (
    <section aria-labelledby="how" className="border-y border-border bg-surface">
      <div className={`${WRAP} py-20 sm:py-28`}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 id="how" className={H2}>
            How it works, in four steps.
          </h2>
          <Link prefetch={false} href="/how-it-works" className="mk-link inline-flex items-center gap-2 text-base font-medium">
            <PlayIcon />
            Watch it as a one-minute cartoon
          </Link>
        </div>
        <ol className="mk-stops mt-16 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.title} className="mk-stop flex flex-col">
              <h3 className="mk-h3 mt-2 text-2xl">{s.title}</h3>
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
          The money column follows the example rental: a {EXAMPLE.scooter} at {baht(EXAMPLE.rent)} a month, a {baht(EXAMPLE.deposit)} deposit and
          the one-time {baht(EXAMPLE.fee)} fee, at an illustrative 1 USDT = 34 THB, returned with no new damage. On testnet the token is mUSDT, a
          test stablecoin.
        </p>
      </div>
    </section>
  );
}

/** The return inspection: the two demo photo sets and the shape of what the inspector returns. */
export function Inspection() {
  return (
    <section id="inspection" aria-labelledby="inspection-h" className={`${WRAP} py-20 sm:py-28`}>
      <div className="grid items-start gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div>
          <h2 id="inspection-h" className={H2}>
            The AI proposes. People decide.
          </h2>
          <p className={LEAD}>
            At return, a vision model compares the pickup photos with the return photos and proposes how to split the deposit, with its
            reasons. It cannot move a single baht.
          </p>
          <ul className="mt-8 space-y-4 text-base leading-relaxed">
            {[
              ["Bounded.", "The refund and the claim always add up to the deposit, and never more."],
              ["Two signatures.", "One side submits the proposal on-chain, the other accepts. Either can dispute it instead."],
              ["Signed.", `Reports are signed by the KeyEscrow Inspector, ERC-8004 agent #${INSPECTOR_AGENT.id} on BSC testnet, so anyone can check who wrote them.`],
              ["With a memory.", "The inspector looks up the scooter's earlier inspections first, so an old scratch is not billed twice."],
            ].map(([lead, rest]) => (
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
            {[
              ["pickup-left", "Pickup", "Illustrated scooter seen from the left at pickup, with no damage."],
              ["return-left", "Return", "The same scooter at return, with new scratches circled on the left side panel."],
            ].map(([file, label, alt]) => (
              <div key={file}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small pre-built WebP, sized, lazy */}
                <img src={`/marketing/${file}.webp`} width={640} height={480} alt={alt} loading="lazy" decoding="async" className="h-auto w-full rounded-lg border border-border" />
                <p className="mt-2 text-sm font-medium">{label}</p>
              </div>
            ))}
          </div>
          <pre className="mk-code mk-scroll-x mt-5 rounded-lg border border-border bg-surface p-4" tabIndex={0} aria-label="Example inspection proposal">
            {`{
  // mUSDT back to the renter
  "tenantRefund": "170.00",
  // mUSDT to the owner
  "landlordClaim": "30.00",
  "reasons": [
    "New scratches on the left side panel",
    "Left mirror cracked; intact at pickup"
  ]
}`}
          </pre>
          <figcaption className="mt-3 text-sm text-subtle">
            The demo&apos;s illustrated photo set and an example proposal on a 200 mUSDT deposit. The contracts say tenant and landlord where
            this page says renter and owner.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Three ways a return ends, on one 14-day scale. */
export function Deadlines() {
  const lanes = [
    { title: "You agree", days: 0, tone: "bg-[var(--mk-teal)]", end: "Settled at once", body: "One side proposes the split, the other accepts. The deposit moves in the same transaction." },
    {
      title: "The owner goes quiet",
      days: OWNER_RESPONSE_DAYS,
      tone: "bg-[var(--mk-amber)]",
      end: `Day ${OWNER_RESPONSE_DAYS}: full deposit back to the renter`,
      body: `If the owner ignores the renter's proposal for ${OWNER_RESPONSE_DAYS} days, the renter can claim the whole deposit.`,
    },
    {
      title: "You disagree",
      days: ARBITER_DAYS,
      tone: "bg-[var(--mk-pink)]",
      end: `A ruling by day ${ARBITER_DAYS}, or the full deposit goes back to the renter`,
      body: `The dispute desk rules with the photos, both proposals and the AI report in front of it, and it has ${ARBITER_DAYS} days to do so.`,
    },
  ];
  return (
    <section aria-labelledby="disputes" className="mk-night">
      <div className={`${WRAP} py-20 sm:py-28`}>
        <h2 id="disputes" className={H2}>
          Every dispute has a deadline.
        </h2>
        <p className={LEAD}>
          The KeyEscrow dispute desk is the default arbiter; an owner can name another neutral one, and the renter sees who it is before
          paying. Whoever it is, the clock protects the renter.
        </p>
        <div className="mt-12 hidden gap-x-10 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]" aria-hidden>
          <span />
          <div className="mk-lane-scale mk-num">
            <span style={{ left: 0 }}>Day 0</span>
            <span style={{ left: `${(OWNER_RESPONSE_DAYS / ARBITER_DAYS) * 100}%`, transform: "translateX(-50%)" }}>Day {OWNER_RESPONSE_DAYS}</span>
            <span style={{ right: 0 }}>Day {ARBITER_DAYS}</span>
          </div>
        </div>
        <ol className="mt-10 space-y-9 md:mt-4">
          {lanes.map((l) => (
            <li key={l.title} className="grid gap-x-10 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:items-center">
              <div>
                <h3 className="mk-h3 text-2xl">{l.title}</h3>
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
          {OWNER_RESPONSE_DAYS} and {ARBITER_DAYS} days are the defaults; each rental fixes its own windows when it is created.{" "}
          <Link prefetch={false} href="/arbiter" className="mk-link">
            Open the dispute desk
          </Link>
        </p>
      </div>
    </section>
  );
}

export function FleetVault() {
  const rest = 100 - FLEET_OPERATOR_FEE_PERCENT;
  return (
    <section id="fleet" aria-labelledby="fleet-h" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="fleet-h" className={H2}>
        Fleet Vault: one fleet, many owners.
      </h2>
      <p className={LEAD}>
        A shop can point a scooter&apos;s income at a vault instead of its own wallet. Rent and damage payouts land in the vault and are
        shared among whoever holds its shares. A testnet prototype.
      </p>
      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-2">
        <div>
          <h3 className="mk-h3 text-2xl">For shop owners</h3>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-muted-foreground">
            List a scooter with the vault as its payee. You keep every role in the rental (propose, accept, dispute); only the payouts go to
            the vault. The operator keeps {FLEET_OPERATOR_FEE_PERCENT}% of income for maintenance.
          </p>
          <Link prefetch={false} href="/landlord" className="mk-link mt-4 inline-flex items-center gap-2 font-medium">
            Open the fleet owner view <ArrowIcon />
          </Link>
        </div>
        <div>
          <h3 className="mk-h3 text-2xl">For shareholders</h3>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-muted-foreground">
            Deposit mUSDT and receive BKK-FLEET-1 shares one to one. Claim your share of the fleet&apos;s income whenever you like, or redeem
            the shares for your deposit.
          </p>
          <Link prefetch={false} href="/shareholders" className="mk-link mt-4 inline-flex items-center gap-2 font-medium">
            Open the shareholder view <ArrowIcon />
          </Link>
        </div>
      </div>
      <figure className="mt-12">
        <div className="flex h-14 overflow-hidden rounded-lg text-sm font-medium" role="img" aria-label={`Of every baht of vault income, ${FLEET_OPERATOR_FEE_PERCENT}% goes to the operator and ${rest}% to shareholders.`}>
          <span className="grid place-items-center bg-foreground px-2 text-background" style={{ width: `${FLEET_OPERATOR_FEE_PERCENT}%`, minWidth: "7.5rem" }}>
            {FLEET_OPERATOR_FEE_PERCENT}% operator
          </span>
          <span className="grid flex-1 place-items-center bg-[var(--mk-teal)] px-3 text-[#06231f]">{rest}% to shareholders, pro rata</span>
        </div>
        <figcaption className="mt-3 max-w-[75ch] text-sm text-subtle">
          Where vault income goes: {FLEET_OPERATOR_FEE_PERCENT}% to the operator for maintenance, the rest to shareholders. Revenue-sharing
          tokens can be securities; compliant issuance and resale of shares are next steps, and this prototype does neither.
        </figcaption>
      </figure>
    </section>
  );
}

/** One definition per rental action: REST endpoint, MCP tool and A2A skill. */
export function Agents() {
  return (
    <section id="agents" aria-labelledby="agents-h" className="mk-night">
      <div className={`${WRAP} grid gap-x-16 gap-y-12 py-20 sm:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}>
        <div>
          <h2 id="agents-h" className={H2}>
            Built for agents, not only for browsers.
          </h2>
          <p className={LEAD}>
            Every rental action is defined once and served three ways: a REST endpoint, an MCP tool and an A2A skill. The{" "}
            <code className="mk-code">prepare_*</code> actions return unsigned transactions, already simulated on the chain, for your own wallet
            to sign. KeyEscrow never holds a key.
          </p>
          <p className="mt-5 max-w-[62ch] leading-relaxed text-muted-foreground">
            The inspector is an agent too: ERC-8004 agent #{INSPECTOR_AGENT.id} in the Identity Registry on BSC testnet (
            <Ext href={explorerTx(INSPECTOR_AGENT.registerTx)}>registration</Ext>
            ). Other agents can find it, call it and verify what it signed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link prefetch={false} href="/developers" data-testid="mk-developers" className="mk-btn mk-btn-amber">
              Developer reference
              <ArrowIcon />
            </Link>
            <a href={docsUrl("AGENT.md")} className="mk-btn mk-btn-line">
              Agent docs
            </a>
          </div>
        </div>
        <div className="min-w-0">
          <pre className="mk-code mk-scroll-x rounded-lg border border-border bg-surface p-4" tabIndex={0} aria-label="Connect Claude Code to the local KeyEscrow MCP server">
            {`# the agent, from a checkout of the repo
pnpm agent:dev

# then, in Claude Code
claude mcp add --transport http keyescrow \\
  http://127.0.0.1:8790/mcp`}
          </pre>
          <h3 className="mt-8 text-sm text-subtle">
            {ACTIONS.length} rental tools and {INSPECTOR_TOOLS.length} inspector tools
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

export function Live() {
  return (
    <section id="live" aria-labelledby="live-h" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="live-h" className={H2}>
        Live on BSC testnet. Check it yourself.
      </h2>
      <p className={LEAD}>
        The contracts are deployed on BSC testnet (chain 97) and their source is verified (an exact match on Sourcify), so what runs is
        what is in the repo. They are small and non-upgradeable. Nobody holds an admin key over a rental&apos;s funds: the money can only
        go to the two parties named at creation, and the dispute desk can only rule on a rental that is in dispute. Test money only: there
        is no mainnet deployment yet.
      </p>
      <table className="mt-10 block w-full border-collapse text-left md:table">
        <caption className="sr-only">KeyEscrow contracts on BSC testnet</caption>
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-border-strong text-sm text-subtle">
            <th scope="col" className="py-3 pr-6 font-normal">
              Contract
            </th>
            <th scope="col" className="py-3 pr-6 font-normal">
              What it does
            </th>
            <th scope="col" className="py-3 font-normal">
              Address (BscScan testnet)
            </th>
          </tr>
        </thead>
        <tbody className="block border-t border-border-strong md:table-row-group md:border-0">
          {TESTNET_CONTRACTS.map((c) => (
            <tr key={c.name} className="block border-b border-border py-4 align-baseline md:table-row md:py-0">
              <th scope="row" className="mk-h3 block text-lg whitespace-nowrap md:table-cell md:py-4 md:pr-6">
                {c.name}
              </th>
              <td className="block pt-1 text-muted-foreground md:table-cell md:py-4 md:pr-6">{c.role}</td>
              <td className="block pt-2 md:table-cell md:py-4">
                <a href={explorerAddress(c.address)} className="mk-link mk-code inline-flex items-center gap-1.5 whitespace-nowrap" data-testid="mk-contract">
                  {c.address.slice(0, 10)}…{c.address.slice(-8)}
                  <ExternalIcon />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-14 grid gap-x-16 gap-y-10 lg:grid-cols-2">
        <div>
          <h3 className="mk-h3 text-2xl">Prices in baht, with the source on show</h3>
          <p className="mt-3 max-w-[58ch] leading-relaxed text-muted-foreground">
            Everyone at the counter thinks in baht, so every amount is shown in THB first, then USD and the exact token amount. Rates come
            from the Atlas on-chain feed or the CoinMarketCap Pro API, read on the server, and a badge always says which one you are looking
            at: Atlas feed, Live CoinMarketCap or Demo rates.
          </p>
        </div>
        <div>
          <h3 className="mk-h3 text-2xl">A deposit that keeps covering the repair bill</h3>
          <p className="mt-3 max-w-[58ch] leading-relaxed text-muted-foreground">
            The risk engine turns CoinMarketCap volatility into a deposit buffer: none for a stablecoin, more for BNB, and a token that swings
            too much is refused.{" "}
            <Link prefetch={false} href="/integrations" className="mk-link" data-testid="mk-integrations">
              See each integration and its recent calls
            </Link>
            , including which ones are live on this server.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Fee() {
  const rows: [string, number, string?][] = [
    ["Monthly rent", EXAMPLE.rent],
    ["Deposit, two months, instead of the passport", EXAMPLE.deposit],
    ["Renter pays in at pickup: deposit and month 1", EXAMPLE.funded],
    ["KeyEscrow fee, once", EXAMPLE.fee, "font-semibold"],
    ["Owner receives for month 1", EXAMPLE.firstPayout],
    ["Owner receives for each later month", EXAMPLE.rent],
  ];
  return (
    <section id="fee" aria-labelledby="fee-h" className="mk-amber" data-testid="fee-pitch">
      <div className={`${WRAP} grid gap-x-16 gap-y-10 py-20 sm:py-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]`}>
        <h2 id="fee-h" className="mk-display text-[clamp(2.4rem,1.2rem+5vw,5.5rem)] leading-[0.98] lg:col-span-2">
          {FEE_PERCENT}% of one month&apos;s rent. Once.
        </h2>
        <p className="max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
          Paid by the owner out of the first rent payout, however long the rental runs. Never taken from the deposit: that is the
          renter&apos;s money until the rental is settled. The renter pays nothing extra, and there is no token.
        </p>
        <div>
          <table className="mk-num w-full border-collapse text-left">
            <caption className="pb-3 text-left text-sm text-subtle">A {EXAMPLE.scooter} rented by the month, in baht</caption>
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
            Illustrative rate of 1 USDT = 34 THB. Over a three-month rental the fee is about 3% of the rent. The rate is capped in the
            factory contract, and each rental keeps the rate it was created with.
          </p>
        </div>
      </div>
    </section>
  );
}

export function Roadmap() {
  const phases = [
    ["Now", "Hackathon build", "Escrow, vault and inspector agent on BSC testnet. Owner, renter and dispute-desk flows. AI inspection proposals. Baht-first prices."],
    ["Q1 2027", "Testnet pilot", "10 to 20 real scooter rentals with friendly shops in Chiang Mai and Phuket, on testnet funds. An independent security review of the contracts."],
    ["Q2 to Q3 2027", "Mainnet and opBNB", "A real, widely held stablecoin. Wallet onboarding for people new to crypto. Legal review of the escrow and dispute-desk roles under Thai law."],
    ["After that", "Partnerships", "Rental shops, fleet operators and travel platforms. Rental associations as named arbiters. Other places with the same passport problem."],
  ];
  return (
    <section aria-labelledby="roadmap" className={`${WRAP} py-20 sm:py-28`}>
      <h2 id="roadmap" className={H2}>
        Where this goes next.
      </h2>
      <p className={LEAD}>Today KeyEscrow is a working testnet build, not a business with customers. This is the plan from here.</p>
      <ol className="mt-12 border-t border-border-strong">
        {phases.map(([when, title, body]) => (
          <li key={title} className="grid gap-x-10 gap-y-1 border-b border-border py-6 md:grid-cols-[10rem_14rem_minmax(0,1fr)] md:items-baseline">
            <p className="mk-num text-sm text-subtle">{when}</p>
            <h3 className="mk-h3 text-xl">{title}</h3>
            <p className="max-w-[68ch] leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-subtle">
        The full plan, the risks and how we would handle them: <Ext href={docsUrl("BUSINESS.md")}>business model</Ext>
      </p>
    </section>
  );
}

/** The last ask, on the night band the page opened with. */
export function ClosingCta({ demo }: { demo: boolean }) {
  return (
    <section aria-labelledby="closing" className="mk-night">
      <div className={`${WRAP} py-20 sm:py-24`}>
        <h2 id="closing" className="mk-display max-w-[18ch] text-[clamp(2.2rem,1.3rem+3.6vw,4rem)]">
          See a deposit come back on its own.
        </h2>
        <p className={LEAD}>
          {demo
            ? "The demo runs one whole rental: funded, paid out, inspected by AI and settled, with on-chain transactions you can follow."
            : "Open the app and walk through a rental as the owner, the renter or the dispute desk."}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link prefetch={false} href={demo ? "/demo" : "/app"} className="mk-btn mk-btn-amber">
            {demo && <PlayIcon />}
            {demo ? "Play the live demo" : "Open the app"}
          </Link>
          <a href={REPO_URL} className="mk-btn mk-btn-line" data-testid="mk-github">
            Read the code on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ demo }: { demo: boolean }) {
  const columns: [string, [string, string, boolean?][]][] = [
    [
      "Try it",
      [
        ...(demo ? ([["/demo", "Play the live demo"]] as [string, string][]) : []),
        ["/how-it-works", "How it works, as a cartoon"],
        ["/app", "Open the app"],
        ["/tenant", "Renter"],
        ["/landlord", "Fleet owner"],
        ["/shareholders", "Shareholders"],
        ["/arbiter", "Dispute desk"],
      ],
    ],
    [
      "Build",
      [
        ["/developers", "Developer reference"],
        ["/integrations", "Integrations"],
        [docsUrl("AGENT.md"), "Inspector agent", true],
        [docsUrl("API.md"), "API", true],
        [docsUrl("ARCHITECTURE.md"), "Architecture", true],
      ],
    ],
    [
      "Read",
      [
        [REPO_URL, "GitHub", true],
        [docsUrl("BUSINESS.md"), "Business model", true],
        [docsUrl("WRITEUP.md"), "CoinMarketCap x Atlas write-up", true],
        [docsUrl("DEPLOY.md"), "Testnet deployment", true],
      ],
    ],
  ];
  return (
    <footer className="mk-night">
      <div className={`${WRAP} pb-16`}>
        <nav aria-label="Footer" className="grid gap-x-10 gap-y-10 border-t border-border pt-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="flex items-center gap-2.5 text-xl">
              <LogoMark className="h-8 w-8" />
              <span className="mk-display">KeyEscrow</span>
            </p>
            <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-subtle">
              Scooter rental deposits and rent, held in escrow on BNB Chain. Built for BNB Bangkok 2026. Open source (MIT), testnet only, no
              token.
            </p>
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

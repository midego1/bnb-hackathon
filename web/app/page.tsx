import Link from "next/link";
import { PlayDemoCta } from "@/components/demo/PlayDemoCta";
import { REPO_URL, docsUrl } from "@/lib/links";

const steps = [
  {
    title: "Landlord offers the lease",
    body: "Set rent, deposit and term. The lease PDF and check-in photos are stored off-chain; only their fingerprints (hashes) go on-chain.",
  },
  {
    title: "Tenant funds the escrow",
    body: "Deposit plus the first month's rent go into this lease's own contract on BNB Chain. Rent is paid out to the landlord month by month.",
  },
  {
    title: "Move out, settle in minutes",
    body: "An AI inspection compares check-in and check-out photos and proposes the deposit split. One side proposes, the other accepts, and the money moves at once.",
  },
];

const roles = [
  {
    href: "/landlord",
    title: "Landlord",
    body: "Create a lease and get rent paid out monthly, straight from escrow.",
    cta: "Create a lease",
  },
  {
    href: "/tenant",
    title: "Tenant",
    body: "Fund your deposit and first month. The landlord can never take the deposit alone.",
    cta: "See my leases",
  },
  {
    href: "/arbiter",
    title: "Dispute desk",
    body: "Neutral reviewer for move-outs the two sides can't agree on. Rules with the photos and AI report at hand.",
    cta: "Open the desk",
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <section>
        <p className="text-sm font-medium text-warning">Rental escrow on BNB Chain · built in Bangkok</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Rental deposits that neither side can run off with.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted sm:text-lg">
          In Bangkok, getting a two-month deposit back is a gamble. KeyEscrow keeps the deposit and rent in a smart contract made
          for each lease, so it only moves when landlord and tenant agree, or a neutral dispute desk rules.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/landlord" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover">
            I&apos;m a landlord
          </Link>
          <Link href="/tenant" className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-medium hover:border-border-hover">
            I&apos;m a tenant
          </Link>
          <a href={docsUrl("DEMO.md")} className="py-2.5 text-sm font-medium text-muted underline-offset-4 hover:underline">
            How the demo works →
          </a>
        </div>
        <PlayDemoCta />
      </section>

      <section className="mt-12" aria-labelledby="how">
        <h2 id="how" className="text-lg font-semibold">How it works</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-border bg-surface p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-sm font-semibold text-slate-950">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted">
          If the landlord ignores a move-out proposal (7 days by default), or the dispute desk misses its deadline (14 days by
          default), the full deposit goes back to the tenant. Neither party can move the money alone.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-warning-border bg-warning-soft p-5 text-sm text-warning-fg" data-testid="fee-pitch">
        <p>
          <span className="font-semibold">KeyEscrow fee: 10% of one month&apos;s rent, once per lease</span>, paid by the landlord from
          the first rent payout. A 15,000 THB condo pays ฿1,500 once; a Bangkok agent usually charges a full month. The deposit is never
          charged and there is no token.
        </p>
      </section>

      <section className="mt-10" aria-labelledby="roles">
        <h2 id="roles" className="text-lg font-semibold">Try it</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {roles.map((role) => (
            <Link
              key={role.href}
              href={role.href}
              className="group flex flex-col rounded-2xl border border-border p-5 transition hover:border-border-hover"
            >
              <h3 className="font-semibold">{role.title}</h3>
              <p className="mt-1 flex-1 text-sm text-muted">{role.body}</p>
              <span className="mt-3 text-sm font-medium text-subtle group-hover:text-foreground">{role.cta} →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
        <a href={REPO_URL} className="font-medium underline-offset-4 hover:underline">GitHub repo</a>
        <a href={docsUrl("ARCHITECTURE.md")} className="underline-offset-4 hover:underline">Architecture</a>
        <a href={docsUrl("BUSINESS.md")} className="underline-offset-4 hover:underline">Business model & roadmap</a>
        <a href={docsUrl("WRITEUP.md")} className="underline-offset-4 hover:underline">CoinMarketCap x Atlas</a>
        <a href={docsUrl("API.md")} className="underline-offset-4 hover:underline">API</a>
      </section>
    </div>
  );
}

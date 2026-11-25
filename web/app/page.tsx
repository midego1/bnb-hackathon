import Link from "next/link";
import { PlayDemoCta } from "@/components/demo/PlayDemoCta";
import { REPO_URL, docsUrl } from "@/lib/links";

const steps = [
  {
    title: "Shop offers the scooter",
    body: "Set rent, deposit and rental period in THB. The rental agreement and guided pickup photos of the scooter are stored off-chain; only their fingerprints (hashes) go on-chain.",
  },
  {
    title: "Renter funds the escrow",
    body: "Deposit plus the first month's rent go into this rental's own contract on BNB Chain. Rent is paid out to the owner month by month.",
  },
  {
    title: "Return the scooter, settle in minutes",
    body: "An AI inspection compares pickup and return photos and proposes the deposit split. One side proposes, the other accepts, and the money moves at once.",
  },
];

const roles = [
  {
    href: "/landlord",
    title: "Owner",
    body: "Offer a scooter to a renter and get rent paid out monthly, straight from escrow.",
    cta: "Offer a scooter",
  },
  {
    href: "/tenant",
    title: "Renter",
    body: "Fund your deposit and first month instead of leaving your passport. The shop can never take the deposit alone.",
    cta: "See my rentals",
  },
  {
    href: "/arbiter",
    title: "Dispute desk",
    body: "Neutral reviewer for scooter returns the two sides can't agree on. Rules with the photos and AI report at hand.",
    cta: "Open the desk",
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <section>
        <p className="text-sm font-medium text-warning">Scooter rental escrow on BNB Chain · built in Bangkok</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Rent a scooter in Thailand without leaving your passport.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted sm:text-lg">
          Rental shops often hold your passport as the deposit, and bogus damage claims at return are common. KeyEscrow keeps the
          deposit and rent in a smart contract made for each scooter rental, so it only moves when the shop owner and the renter
          agree, or a neutral dispute desk rules.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/landlord" className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover">
            I rent out scooters
          </Link>
          <Link href="/tenant" className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-medium hover:border-border-hover">
            I&apos;m renting a scooter
          </Link>
          <a href={docsUrl("DEMO.md")} className="py-2.5 text-sm font-medium text-muted underline-offset-4 hover:underline">
            How the demo works →
          </a>
          <Link href="/integrations" className="py-2.5 text-sm font-medium text-muted underline-offset-4 hover:underline" data-testid="integrations-link">
            Risk engine &amp; integrations →
          </Link>
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
          If the owner ignores a return proposal (7 days by default), or the dispute desk misses its deadline (14 days by
          default), the full deposit goes back to the renter. Neither party can move the money alone.
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-warning-border bg-warning-soft p-5 text-sm text-warning-fg" data-testid="fee-pitch">
        <p>
          <span className="font-semibold">KeyEscrow fee: 10% of one month&apos;s rent, once per rental</span>, paid by the owner from
          the first rent payout. A scooter at 3,400 THB a month pays ฿340 once. The deposit is never
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

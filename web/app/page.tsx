import Link from "next/link";

const roles = [
  {
    href: "/landlord",
    title: "Landlord",
    body: "Create a lease with rent, deposit, term and an arbiter. Receive rent monthly, straight from escrow.",
  },
  {
    href: "/tenant",
    title: "Tenant",
    body: "Fund deposit and first month in a stablecoin. Your deposit can never be moved by the landlord alone.",
  },
  {
    href: "/arbiter",
    title: "Arbiter",
    body: "Resolve disputed move-outs with evidence hashes and the AI inspection proposal at hand.",
  },
];

export default function Home() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-14">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
        Rental deposits that neither side can run off with.
      </h1>
      <p className="mt-4 max-w-2xl text-lg opacity-80">
        KeyEscrow locks deposit and rent in a per-lease smart contract on BNB Chain. Move-out photos are compared
        by an AI inspector, both parties agree on-chain, and the money settles instantly.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {roles.map((role) => (
          <Link
            key={role.href}
            href={role.href}
            className="rounded-xl border border-black/10 p-5 transition hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
          >
            <h2 className="font-semibold">{role.title}</h2>
            <p className="mt-2 text-sm opacity-80">{role.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

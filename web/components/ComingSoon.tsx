export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-prose opacity-80">{children}</p>
      <p className="mt-6 inline-block rounded-md bg-amber-100 px-3 py-1 text-sm text-amber-900">
        Wired to contracts in milestone M4.
      </p>
    </section>
  );
}

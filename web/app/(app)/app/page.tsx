import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { PlayDemoCta } from "@/components/demo/PlayDemoCta";
import { getDictionary } from "@/lib/i18n/server";
import { REPO_URL, docsUrl } from "@/lib/links";

const steps = ["offer", "fund", "settle"] as const;

const roles = [
  { href: "/landlord", key: "owner" },
  { href: "/tenant", key: "renter" },
  { href: "/arbiter", key: "desk" },
] as const;

export default async function Home() {
  const t = await getDictionary();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <section>
        <p className="text-sm font-medium text-warning">{t("home.kicker")}</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          {t.h("home.title")}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          {t("home.lead")}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/landlord" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            {t("home.owner")}
          </Link>
          <Link href="/tenant" className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-medium hover:border-border-hover">
            {t("home.renter")}
          </Link>
          <Link
            href="/how-it-works"
            data-testid="home-eli5"
            className="inline-flex items-center gap-1.5 rounded-lg border border-highlight-edge bg-warning-soft px-4 py-2.5 text-sm font-medium text-warning-fg hover:border-highlight"
          >
            <Play aria-hidden className="size-3.5 fill-current" />
            {t("home.eli5")}
          </Link>
          <a href={docsUrl("DEMO.md")} className="py-2.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">
            {t("home.demoDoc")} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />
          </a>
          <Link href="/integrations" className="py-2.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline" data-testid="integrations-link">
            {t("home.integrations")} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />
          </Link>
        </div>
        <PlayDemoCta />
      </section>

      <section className="mt-12" aria-labelledby="how">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="how" className="text-lg font-semibold">{t.h("home.how")}</h2>
          <Link href="/how-it-works" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline">
            {t("home.cartoon")} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" />
          </Link>
        </div>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s} className="rounded-2xl border border-border bg-surface p-5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-highlight text-sm font-semibold text-highlight-foreground">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{t.h(`home.steps.${s}`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`home.steps.${s}`)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("home.timeouts")}
        </p>
      </section>

      <section className="mt-8 rounded-2xl border border-warning-border bg-warning-soft p-5 text-sm text-warning-fg" data-testid="fee-pitch">
        <p>
          <span className="font-semibold">{t("home.fee.strong")}</span>
          {t("home.fee.rest")}
        </p>
      </section>

      <section className="mt-10" aria-labelledby="roles">
        <h2 id="roles" className="text-lg font-semibold">{t.h("home.tryIt")}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {roles.map((role) => (
            <Link
              key={role.href}
              href={role.href}
              className="group flex flex-col rounded-2xl border border-border p-5 transition hover:border-border-hover"
            >
              <h3 className="font-semibold">{t.h(`home.roles.${role.key}`)}</h3>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{t(`home.roles.${role.key}.body`)}</p>
              <span className="mt-3 text-sm font-medium text-subtle group-hover:text-foreground">{t(`home.roles.${role.key}.cta`)} <ArrowRight aria-hidden className="inline size-3.5 align-[-2px]" /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
        <a href={REPO_URL} className="font-medium underline-offset-4 hover:underline">{t("home.links.repo")}</a>
        <a href={docsUrl("ARCHITECTURE.md")} className="underline-offset-4 hover:underline">{t("home.links.architecture")}</a>
        <a href={docsUrl("BUSINESS.md")} className="underline-offset-4 hover:underline">{t("home.links.business")}</a>
        <a href={docsUrl("WRITEUP.md")} className="underline-offset-4 hover:underline">{t("home.links.writeup")}</a>
        <a href={docsUrl("API.md")} className="underline-offset-4 hover:underline">{t("home.links.api")}</a>
      </section>
    </div>
  );
}

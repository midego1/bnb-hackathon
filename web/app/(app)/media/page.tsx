/* eslint-disable @next/next/no-img-element -- static files from public/media, shown as they are (no image optimizer on Workers) */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { mediaCopy } from "@/components/media/copy";
import { RecipeGrid } from "@/components/RecipeGrid";
import { Card, PageTitle } from "@/components/ui";
import deployments from "@/lib/contracts/deployments.generated.json";
import { getDictionary } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/locales";
import { REPO_URL } from "@/lib/links";
import { RENTAL_RECIPE } from "@/lib/recipes";
// Generated before every build by scripts/media.mjs (gitignored): each file's path under /media and its size.
import manifest from "@/public/media/manifest.json";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).of(mediaCopy).metaTitle, alternates: { canonical: "/media" } };
}

type File = (typeof manifest.files)[number];
const href = (f: { path: string }) => `/media/${f.path}`;
const name = (f: File) => f.path.split("/").pop()!;
const size = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);
const inFolder = (folder: string) => manifest.files.filter((f) => f.path.startsWith(`${folder}/`) && f.path.indexOf("/", folder.length + 1) < 0);
const file = (path: string) => manifest.files.find((f) => f.path === path)!;
/** A file that only some entries have (the pitch has no .webm). */
const maybe = (path: string) => manifest.files.find((f) => f.path === path);

/** Length (ffprobe) and the screenshot of the same screen as poster. */
const VIDEOS = [
  ["pitch", "4:46", "videos/pitch-poster.jpg"],
  ["duo", "1:04", "screenshots/web/02-duo.png"],
  ["livingbrain", "3:54", "videos/livingbrain-poster.jpg"],
  ["demo-guided", "1:30", "screenshots/web/demo-mid-run.png"],
  ["eli5", "1:11", "screenshots/web/how-it-works.png"],
  ["tour", "1:17", "screenshots/web/01-landing.png"],
] as const;
const COLOURS = [
  ["night", "#0d0b2a"],
  ["amber", "#fbbf24"],
  ["pink", "#f472b6"],
  ["teal", "#2dd4bf"],
  ["ink", "#0f172a"],
  ["paper", "#f8fafc"],
] as const;
const CONTRACTS = [
  [97, "https://testnet.bscscan.com", { EscrowFactory: deployments["97"].escrowFactory, RentalEscrow: deployments["97"].rentalEscrowImplementation, FleetVault: deployments["97"].fleetVault, MockUSDT: deployments["97"].mockUsdt, AtlasSwapGuard: deployments["97"].atlasSwapGuard }],
  [56, "https://bscscan.com", { EscrowFactory: deployments["56"].escrowFactory, RentalEscrow: deployments["56"].rentalEscrowImplementation }],
] as const;
const LINK = "inline-block py-0.5 underline underline-offset-2";

/**
 * /media: every video, the deck, screenshots, brand files and documents, each downloadable, plus one .zip of all of
 * them. Server-rendered from the build-time manifest: no client code.
 */
export default async function MediaPage() {
  const t = await getDictionary();
  const c = t.of(mediaCopy);
  const zipped = manifest.files.filter((f) => f.zip).length;
  const dl = (f: File, label: ReactNode = `${name(f)} · ${size(f.bytes)}`) => (
    <a href={href(f)} download className={LINK} data-testid="media-download">
      {label}
    </a>
  );
  const section = (id: keyof typeof c.sections, children: ReactNode) => (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10">
      <h2 id={`${id}-title`} className="mb-4 text-xl font-semibold tracking-tight">
        {t.head(mediaCopy, (x) => x.sections[id])}
      </h2>
      {children}
    </section>
  );
  const shots = (folder: string, tall = false) => (
    <ul className={`grid gap-4 ${tall ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
      {inFolder(folder).map((f) => (
        <li key={f.path} className="min-w-0">
          <a href={href(f)} className="block overflow-hidden rounded-xl border border-border bg-muted" aria-label={name(f)}>
            <img src={href(f)} alt={name(f)} loading="lazy" decoding="async" className={`w-full object-cover object-top ${tall ? "aspect-[9/19.5]" : "aspect-[1470/830]"}`} />
          </a>
          <p className="mt-1 text-sm break-words">{dl(f)}</p>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.head(mediaCopy, (x) => x.title)}>{c.lead}</PageTitle>
      <a
        href={href(manifest.zip)}
        download
        data-testid="media-zip"
        className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground hover:bg-primary-hover"
      >
        {fmt(c.zip, { size: size(manifest.zip.bytes) })}
      </a>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{fmt(c.zipNote, { n: zipped })}</p>

      <RecipeGrid id="recipe" recipe={RENTAL_RECIPE} text={c.recipe} title={t.head(mediaCopy, (x) => x.recipe.title)} labels={c.recipeLabels} />

      {section(
        "videos",
        <div className="grid gap-4 md:grid-cols-2">
          {VIDEOS.map(([id, length, poster]) => (
            <Card key={id} title={c.videos[id].title} aside={<span className="text-sm text-subtle tabular-nums">{length}</span>}>
              <video controls playsInline preload="none" poster={`/media/${poster}`} className="aspect-[1470/830] w-full rounded-lg bg-muted" data-testid="media-video">
                {maybe(`videos/${id}.webm`) && <source src={href(maybe(`videos/${id}.webm`)!)} type="video/webm" />}
                <source src={href(file(`videos/${id}.mp4`))} type="video/mp4" />
              </video>
              <p className="mt-3 text-sm text-muted-foreground">{c.videos[id].body}</p>
              <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
                {dl(file(`videos/${id}.mp4`))}
                {maybe(`videos/${id}-1080.mp4`) && dl(maybe(`videos/${id}-1080.mp4`)!)}
                {maybe(`videos/${id}-1080-silent.mp4`) && dl(maybe(`videos/${id}-1080-silent.mp4`)!)}
                {maybe(`videos/${id}.webm`) && dl(maybe(`videos/${id}.webm`)!)}
              </p>
            </Card>
          ))}
        </div>,
      )}
      <p className="mt-3 text-sm">
        {c.gif}: {dl(file("videos/duo.gif"))}
      </p>

      {inFolder("overlay-kit").length > 0 &&
        section(
          "kit",
          <Card>
            <p className="text-sm text-muted-foreground">{c.kitBody}</p>
            <p className="mt-3 flex flex-wrap gap-x-4 text-sm">
              {inFolder("overlay-kit").map((f) => (
                <span key={f.path}>{dl(f)}</span>
              ))}
            </p>
          </Card>,
        )}

      {section(
        "deck",
        <Card>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <a href={href(file("deck/deck.pdf"))} className="block overflow-hidden rounded-lg border border-border" aria-label="deck.pdf">
              <img src={href(file("deck/deck-cover.jpg"))} alt="" width={960} height={540} loading="lazy" className="h-auto w-full" />
            </a>
            <div>
              <p className="text-sm text-muted-foreground">{c.deckBody}</p>
              <p className="mt-3 text-sm">{dl(file("deck/deck.pdf"), `${c.deckPdf} · ${size(file("deck/deck.pdf").bytes)}`)}</p>
              <p className="text-sm">{dl(file("deck/deck-cover.jpg"))}</p>
            </div>
          </div>
        </Card>,
      )}

      {section("web", shots("screenshots/web"))}
      {section("ios", shots("screenshots/ios", true))}

      {section(
        "brand",
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={c.brand.name}>
            <p className="text-3xl font-semibold tracking-tight">KeyScrow</p>
            <p className="mt-2 text-sm text-muted-foreground">{c.brand.nameNote}</p>
            <h3 className="mt-5 text-sm font-semibold">{c.brand.colours}</h3>
            <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              {COLOURS.map(([id, hex]) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="h-6 w-6 shrink-0 rounded-md ring-1 ring-border" style={{ background: hex }} aria-hidden />
                  <span>
                    <code className="font-mono">{hex}</code> {c.brand.colour[id]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={c.brand.files}>
            <ul className="space-y-3 text-sm">
              {inFolder("brand").map((f) => (
                <li key={f.path} className="flex items-center gap-3">
                  <img src={href(f)} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
                  <span className="min-w-0">
                    <span className="block">{c.brand.file[name(f) as keyof typeof c.brand.file]}</span>
                    {dl(f)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>,
      )}

      {section(
        "docs",
        <Card>
          <ul className="space-y-3 text-sm">
            {inFolder("docs").map((f) => (
              <li key={f.path}>
                <span className="block font-medium">{c.docs[name(f) as keyof typeof c.docs]}</span>
                <span className="flex flex-wrap gap-x-4">
                  <a href={`${REPO_URL}/blob/main/${f.src}`} className={LINK}>
                    {c.github}
                  </a>
                  {dl(f)}
                </span>
              </li>
            ))}
          </ul>
        </Card>,
      )}

      {section(
        "links",
        <Card>
          <ul className="space-y-1 text-sm">
            {(
              [
                ["https://keyscrow.app", c.links.app],
                ["https://mainnet.keyscrow.app", c.links.mainnet],
                ["https://agent.keyscrow.app", c.links.agent],
                [REPO_URL, c.links.repo],
              ] as const
            ).map(([url, label]) => (
              <li key={url}>
                {label}:{" "}
                <a href={url} className={`${LINK} break-all`}>
                  {url.replace("https://", "")}
                </a>
              </li>
            ))}
          </ul>
          {CONTRACTS.map(([chain, explorer, list]) => (
            <div key={chain} className="mt-4">
              <h3 className="text-sm font-semibold">{chain === 97 ? c.links.testnet : c.links.mainnetContracts}</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {Object.entries(list).map(([contract, address]) => (
                  <li key={contract}>
                    {contract}:{" "}
                    <a href={`${explorer}/address/${address}`} className={`${LINK} font-mono break-all`} data-testid="media-contract">
                      {address}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>,
      )}
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { demoAvailable } from "@/components/shell/nav";
import { sponsorsCopy, type SponsorsCopy } from "@/components/sponsors/copy";
import { Card, PageTitle } from "@/components/ui";
import { getDictionary } from "@/lib/i18n/server";
import { docsUrl, REPO_URL } from "@/lib/links";
import { integrationStatus } from "@/lib/server/sponsors/status";
import { SPONSOR_CHECKLIST, type CheckNeeds } from "@/lib/sponsorChecklist";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).of(sponsorsCopy).metaTitle, alternates: { canonical: "/sponsors" } };
}

type Chip = keyof SponsorsCopy["state"];
const CHIP: Record<Chip, string> = {
  live: "bg-success-soft text-success-fg ring-success-border",
  built: "bg-muted text-muted-foreground ring-border",
  waiting: "bg-warning-soft text-warning-fg ring-warning-border",
  done: "bg-success-soft text-success-fg ring-success-border",
  pending: "bg-warning-soft text-warning-fg ring-warning-border",
};
type L = keyof SponsorsCopy["links"];
type Track = { id: keyof SponsorsCopy["tracks"]; state: Chip; see: [string, L][]; proof: [string, L][]; sub?: ["cmc" | "atlas", Chip][] };

const TESTNET_FACTORY = "https://testnet.bscscan.com/address/0x04D7dDCb72802aF82296110A90526342C1249315";
const MAINNET_FACTORY = "https://bscscan.com/address/0x8d708713C2a9da93450F224f35eF7FA15c0a2d3E";
const REGISTRATION_TX = "https://testnet.bscscan.com/tx/0x40c7cf2008857eabb197df1453e33b3b45760fdec8e7f846ac23a4c2e73328c0";

/**
 * /sponsors: one card per sponsor track we enter, for judges. The chips come from integrationStatus(), the same data
 * as GET /api/integrations, so a key set on the server turns a card live without a deploy. /integrations stays the
 * technical page (env names, call log, the risk engine).
 */
export default async function SponsorsPage() {
  const t = await getDictionary();
  const c = t.of(sponsorsCopy);
  const live = new Set((await integrationStatus()).filter((i) => i.state === "live").map((i) => i.id));
  // The checklist's live rows need their integration live here; the Pull API also needs its key (as in status.ts).
  const on: Record<CheckNeeds, boolean> = {
    cmc: live.has("cmc"),
    atlas: live.has("atlas"),
    atlasPull: live.has("atlas") && !!process.env.ATLAS_API_KEY,
    livingbrain: live.has("livingbrain"),
  };
  const tracks: Track[] = [
    {
      id: "bnb",
      state: "live",
      see: [
        ["/duo/mystery-box", "duo"],
        ["/stage/mystery-box", "stage"],
        ["/r/mystery-box", "phone"],
        ...(demoAvailable ? [["/demo", "demo"] as [string, L]] : []),
        ["/app", "app"],
        ["/developers", "developers"],
      ],
      proof: [
        ["https://agent.keyscrow.app/.well-known/agent-card.json", "agentCard"],
        [TESTNET_FACTORY, "factory"],
        [REGISTRATION_TX, "registration"],
        ["https://mainnet.keyscrow.app", "mainnet"],
        [MAINNET_FACTORY, "mainnetFactory"],
        [`${REPO_URL}/tree/main/ios`, "ios"],
      ],
    },
    {
      id: "cmcAtlas",
      state: live.has("cmc") || live.has("atlas") ? "live" : "waiting",
      sub: [
        ["cmc", live.has("cmc") ? "live" : "waiting"],
        ["atlas", live.has("atlas") ? "live" : "waiting"],
      ],
      see: [
        ["/integrations", "integrations"],
        ["/api/integrations", "integrationsApi"],
        ["/api/price", "price"],
      ],
      proof: [
        [docsUrl("WRITEUP.md"), "writeup"],
        ["https://testnet.bscscan.com/address/0x3957d289ee9c38272377786787ea34f9dd29788d", "atlasBnbTestnet"],
        ["https://testnet.bscscan.com/address/0x9dfd7992952bb9e8fb4bc6065fdc3518addc4e8b", "atlasUsdtTestnet"],
        ["https://bscscan.com/address/0x9c0517f5b4c8657c7f18d68d2d79e2b3b1cd6438", "atlasBnbMainnet"],
        ["https://bscscan.com/address/0x9fc000fc9c17578b49853278a517e357201d01e4", "atlasUsdtMainnet"],
        [docsUrl("SPONSORS.md"), "sponsorsDoc"],
      ],
    },
    {
      id: "livingBrain",
      // Without a key the same memory runs on a local file: built, not live.
      state: live.has("livingbrain") ? "live" : "built",
      see: [
        ["/arbiter", "arbiter"],
        ["/backoffice", "backoffice"],
      ],
      proof: [[docsUrl("ARCHITECTURE.md#dispute-memory-per-wallet"), "memoryDoc"]],
    },
    {
      id: "cournot",
      state: live.has("cournot") ? "live" : "waiting",
      see: [["/integrations", "integrations"]],
      proof: [[`${REPO_URL}#cournot-integration`, "cournotDoc"]],
    },
    {
      id: "aws",
      state: "built",
      see: [["/pitch", "pitch"]],
      proof: [
        [docsUrl("BUSINESS.md"), "business"],
        [docsUrl("BUSINESS.md#roadmap"), "roadmap"],
      ],
    },
  ];
  const chip = (state: Chip, testId: string) => (
    <span data-testid={testId} data-state={state} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CHIP[state]}`}>
      {c.state[state]}
    </span>
  );
  const anchor = (href: string, text: string, className: string) =>
    href.startsWith("/") && !href.startsWith("/api/") ? (
      <Link prefetch={false} href={href} className={className}>
        {text}
      </Link>
    ) : (
      <a href={href} className={className}>
        {text}
      </a>
    );
  const links = (label: string, list: [string, L][]) => (
    <div className="mt-3">
      <p className="text-xs font-semibold text-subtle">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {list.map(([href, key]) => (
          <li key={href}>{anchor(href, c.links[key], "inline-block py-0.5 underline underline-offset-2")}</li>
        ))}
      </ul>
    </div>
  );
  const checklist = (id: Track["id"]) => (
    <div className="mt-4">
      <p className="text-xs font-semibold text-subtle">{c.checklist.title}</p>
      <ul className="mt-1 divide-y divide-border text-sm">
        {SPONSOR_CHECKLIST[id].map((row) => {
          const off = row.needs !== undefined && !on[row.needs];
          const state = off ? "pending" : row.state;
          const text = c.checklist.rows[row.id];
          return (
            <li key={row.id} data-testid="sponsor-check" data-row={row.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{text.ask}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {text.how}
                  {off && ` ${c.checklist.notHere}`} {anchor(row.href, text.link, "underline underline-offset-2")}
                </p>
              </div>
              {chip(state, `sponsor-check-${row.id}`)}
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.head(sponsorsCopy, (x) => x.title)}>{c.lead}</PageTitle>
      <p className="-mt-3 mb-6 text-sm">
        <Link href="/media" className="inline-block py-0.5 underline underline-offset-2" data-testid="sponsors-media">
          {c.media}
        </Link>
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {tracks.map((tr) => (
          <Card key={tr.id} title={c.tracks[tr.id].name} aside={chip(tr.state, `sponsor-${tr.id}-state`)} className="flex flex-col">
            <div data-testid="sponsor-track" data-track={tr.id}>
              <p className="text-sm text-muted-foreground">{c.tracks[tr.id].body}</p>
              {tr.sub && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {tr.sub.map(([id, state]) => (
                    <li key={id} className="flex items-start justify-between gap-3">
                      <span>{c.tracks.cmcAtlas[id]}</span>
                      {chip(state, `sponsor-${id}-state`)}
                    </li>
                  ))}
                </ul>
              )}
              {checklist(tr.id)}
              {links(c.see, tr.see)}
              {links(c.proof, tr.proof)}
            </div>
          </Card>
        ))}
        <aside className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="sponsor-not-entered">
          <h2 className="font-semibold text-foreground">{c.notEntered.title}</h2>
          <p className="mt-2">{c.notEntered.body}</p>
        </aside>
      </div>
    </section>
  );
}

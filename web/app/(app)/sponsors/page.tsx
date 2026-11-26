import type { Metadata } from "next";
import Link from "next/link";
import { demoAvailable } from "@/components/shell/nav";
import { sponsorsCopy, type SponsorsCopy } from "@/components/sponsors/copy";
import { Card, PageTitle } from "@/components/ui";
import { getDictionary } from "@/lib/i18n/server";
import { docsUrl, REPO_URL } from "@/lib/links";
import { integrationStatus } from "@/lib/server/sponsors/status";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).of(sponsorsCopy).metaTitle, alternates: { canonical: "/sponsors" } };
}

type Chip = keyof SponsorsCopy["state"];
const CHIP: Record<Chip, string> = {
  live: "bg-success-soft text-success-fg ring-success-border",
  built: "bg-muted text-muted-foreground ring-border",
  waiting: "bg-warning-soft text-warning-fg ring-warning-border",
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
        ["https://keyescrow-agent.mdgooijer.workers.dev/.well-known/agent-card.json", "agentCard"],
        [TESTNET_FACTORY, "factory"],
        [REGISTRATION_TX, "registration"],
        ["https://keyescrow-mainnet.mdgooijer.workers.dev", "mainnet"],
        [MAINNET_FACTORY, "mainnetFactory"],
        [`${REPO_URL}/tree/main/ios`, "ios"],
      ],
    },
    {
      id: "cmcAtlas",
      state: live.has("cmc") ? "live" : "waiting",
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
  const links = (label: string, list: [string, L][]) => (
    <div className="mt-3">
      <p className="text-xs font-semibold text-subtle">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {list.map(([href, key]) => (
          <li key={href}>
            {href.startsWith("/") && !href.startsWith("/api/") ? (
              <Link prefetch={false} href={href} className="inline-block py-0.5 underline underline-offset-2">
                {c.links[key]}
              </Link>
            ) : (
              <a href={href} className="inline-block py-0.5 underline underline-offset-2">
                {c.links[key]}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.head(sponsorsCopy, (x) => x.title)}>{c.lead}</PageTitle>
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

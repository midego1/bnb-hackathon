import type { SponsorsCopy } from "@/components/sponsors/copy";
import deployments from "@/lib/contracts/deployments.generated.json";
import { docsUrl, REPO_URL } from "@/lib/links";

/**
 * /sponsors checklist: per track, what the track asks (docs/SPONSORS.md) and how KeyScrow does it, with one evidence
 * link per row. The words are in components/sponsors/copy.ts (`checklist`, en + zh); this is the structure.
 *
 * - `done`: built and in the repo (docs, videos, tested code); `live`: running on keyscrow.app; `pending`: not met
 *   yet, the copy says why.
 * - `needs`: a `live` row shows `pending` on a server where that integration is not live (same data as /api/integrations).
 */
export type CheckState = "done" | "live" | "pending";
export type CheckNeeds = "cmc" | "atlas" | "atlasPull" | "livingbrain";
export type CheckRowId = keyof SponsorsCopy["checklist"]["rows"];
export type CheckRow = { id: CheckRowId; state: CheckState; href: string; needs?: CheckNeeds };

const testnet = (contract: "escrowFactory" | "fleetVault" | "atlasSwapGuard") => `https://testnet.bscscan.com/address/${deployments["97"][contract]}`;
const file = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const SPONSOR_CHECKLIST: Record<keyof SponsorsCopy["tracks"], CheckRow[]> = {
  bnb: [
    { id: "bnbChain", state: "live", href: testnet("escrowFactory") },
    { id: "bnbRwa", state: "live", href: testnet("fleetVault") },
    { id: "bnbAgent", state: "live", href: "https://testnet.bscscan.com/tx/0x40c7cf2008857eabb197df1453e33b3b45760fdec8e7f846ac23a4c2e73328c0" },
    { id: "bnbVideo", state: "done", href: docsUrl("submission/duo.mp4") },
    { id: "bnbRepo", state: "pending", href: REPO_URL },
    { id: "bnbHackquest", state: "pending", href: docsUrl("submission/HACKQUEST.md") },
  ],
  cmcAtlas: [
    { id: "cmcCore", state: "live", needs: "cmc", href: "/integrations" },
    { id: "atlasFeed", state: "live", needs: "atlas", href: "/api/price" },
    { id: "atlasPull", state: "live", needs: "atlasPull", href: file("web/lib/server/price/atlas.ts") },
    { id: "atlasGuard", state: "live", href: testnet("atlasSwapGuard") },
    { id: "cmcKeys", state: "done", href: "/api/integrations" },
    { id: "cmcWriteup", state: "done", href: docsUrl("WRITEUP.md") },
    { id: "cmcVideo", state: "done", href: docsUrl("submission/demo-guided.mp4") },
    { id: "cmcRepo", state: "pending", href: `${REPO_URL}#sponsor-integrations` },
    { id: "cmcTeam", state: "done", href: docsUrl("WRITEUP.md") },
  ],
  livingBrain: [
    { id: "lbAgent", state: "live", href: "https://agent.keyscrow.app" },
    { id: "lbMemory", state: "live", needs: "livingbrain", href: "/integrations" },
    { id: "lbWallet", state: "live", needs: "livingbrain", href: "/arbiter" },
    { id: "lbDescription", state: "done", href: docsUrl("submission/HACKQUEST.md#other-sponsor-tracks") },
    { id: "lbVideo", state: "pending", href: `${REPO_URL}/tree/main/docs/submission` },
  ],
  cournot: [
    { id: "cournotCall", state: "pending", href: "/integrations" },
    { id: "cournotDecision", state: "done", href: file("web/lib/risk.ts") },
    { id: "cournotClaim", state: "done", href: "/integrations" },
    { id: "cournotReadme", state: "done", href: `${REPO_URL}#cournot-integration` },
  ],
  aws: [
    { id: "awsPitch", state: "done", href: docsUrl("submission/deck.pdf") },
    { id: "awsBusiness", state: "done", href: docsUrl("BUSINESS.md") },
    { id: "awsActivate", state: "pending", href: "https://aws.amazon.com/startups/credits" },
  ],
};

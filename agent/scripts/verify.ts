/**
 * End-to-end check that a report really comes from the registered KeyEscrow Inspector:
 *   1. run inspect_move_out on the agent (MCP) with the demo request, or read a report from --report <file>
 *   2. recompute reportHash and recover the signer (offline)
 *   3. read the ERC-8004 Identity Registry: the agent exists, its `reportSigner` metadata equals the signer,
 *      and its tokenURI registration file names this agent and lists its A2A + MCP endpoints on AGENT_URL (the agent
 *      that answered; skipped with --report).
 * Read-only: never sends a transaction.
 *
 *   BSC_TESTNET_RPC_URL=… pnpm agent:verify [-- --report report.json]
 */
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentURIGenerator } from "@bnbagent/sdk/erc8004";
import { createPublicClient, http, isAddressEqual, type Address } from "viem";
import { parseAgentRegistry } from "../src/card.ts";
import { AGENT_NAME } from "../src/config.ts";
import { verifyInspectorReport, type InspectorIdentity } from "../src/shared.ts";
import { decodeReportSigner, IDENTITY_REGISTRY_ABI, REPORT_SIGNER_KEY } from "./registry.ts";
import { AGENT_URL, SAMPLE_REQUEST } from "./sample.ts";

let fails = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) fails++;
};

async function fetchReport(): Promise<Record<string, unknown>> {
  const i = process.argv.indexOf("--report");
  if (i !== -1) return JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
  const client = new Client({ name: "keyescrow-verify", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${AGENT_URL}/mcp`)));
  const res = await client.callTool({ name: "inspect_move_out", arguments: SAMPLE_REQUEST });
  await client.close();
  if (res.isError) throw new Error(`inspect_move_out failed: ${JSON.stringify(res.structuredContent)}`);
  return res.structuredContent as Record<string, unknown>;
}

const report = await fetchReport();
const inspector = report.inspector as InspectorIdentity | undefined;
console.log(`report ${report.reportHash}: tenantRefund ${report.tenantRefund}, landlordClaim ${report.landlordClaim}`);

const offline = await verifyInspectorReport(report);
check(offline.hashValid, "reportHash = sha256(canonical JSON of the report)");
check(offline.signatureValid, `inspectorSignature recovers to the report's inspector ${offline.signer ?? "(none)"}`);
const reg = parseAgentRegistry(inspector?.agentRegistry);
check(inspector?.agentId !== undefined && reg !== null, `report names ERC-8004 agent #${inspector?.agentId} in ${inspector?.agentRegistry}`);

const rpcUrl = process.env.BSC_TESTNET_RPC_URL;
if (!rpcUrl) throw new Error("BSC_TESTNET_RPC_URL is required for the on-chain check");
if (reg && inspector?.agentId !== undefined) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  check(chainId === reg.chainId, `RPC chainId ${chainId} matches the registry reference`);
  const id = BigInt(inspector.agentId);
  const address = reg.identityRegistry as Address;
  const [owner, uri, signerBytes] = await Promise.all([
    client.readContract({ address, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [id] }),
    client.readContract({ address, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [id] }),
    client.readContract({ address, abi: IDENTITY_REGISTRY_ABI, functionName: "getMetadata", args: [id, REPORT_SIGNER_KEY] }),
  ]);
  const reportSigner = decodeReportSigner(signerBytes);
  check(true, `agent #${id} exists, owner ${owner}`);
  check(
    offline.signer !== null && reportSigner !== null && isAddressEqual(reportSigner, offline.signer),
    `on-chain reportSigner ${reportSigner} signed this report`,
  );
  const file = uri.startsWith("data:") ? AgentURIGenerator.decodeRegistrationFileFromBase64(uri) : null;
  check(file?.name === AGENT_NAME, `tokenURI registration file names "${String(file?.name)}"`);
  const services = (file?.services as { name: string; endpoint: string }[] | undefined) ?? [];
  console.log(`    services: ${services.map((s) => `${s.name} ${s.endpoint}`).join(", ")}`);
  if (!process.argv.includes("--report")) {
    const elsewhere = services.filter((s) => !s.endpoint.startsWith(`${AGENT_URL}/`));
    check(
      services.length > 0 && elsewhere.length === 0,
      `registered endpoints are on ${AGENT_URL}${elsewhere.length ? ` (not: ${elsewhere.map((s) => s.endpoint).join(", ")}; fix with setAgentURI)` : ""}`,
    );
  }
  const regs = (file?.registrations as { agentId: number; agentRegistry: string }[] | undefined) ?? [];
  check(
    regs.some((r) => String(r.agentId) === inspector.agentId && r.agentRegistry.toLowerCase() === inspector.agentRegistry!.toLowerCase()),
    "registration file points back at this agent id and registry",
  );
}
console.log(fails === 0 ? "\nVERIFIED: signed by KeyEscrow Inspector, ERC-8004 agent #" + inspector?.agentId : `\n${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);

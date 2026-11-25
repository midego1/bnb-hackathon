/** Print the A2A agent card and the ERC-8004 registration file this agent would publish. `pnpm agent:card` */
import { AgentURIGenerator } from "@bnbagent/sdk/erc8004";
import { buildAgentCard, buildRegistrationFile, parseAgentRegistry } from "../src/card.ts";
import { loadConfig } from "../src/config.ts";

const cfg = loadConfig();
const identity = cfg.inspector?.identity ?? null;
const reg = parseAgentRegistry(identity?.agentRegistry);
const file = buildRegistrationFile(cfg.publicUrl, { agentId: identity?.agentId, identityRegistry: reg?.identityRegistry, chainId: reg?.chainId });
console.log("A2A agent card (/.well-known/agent-card.json):");
console.log(JSON.stringify(buildAgentCard(cfg.publicUrl, identity), null, 2));
console.log("\nERC-8004 registration file (tokenURI, /.well-known/agent-registration.json):");
console.log(JSON.stringify(file, null, 2));
const uri = `data:application/json;base64,${AgentURIGenerator.encodeRegistrationFileToBase64(file)}`;
console.log(`\non-chain agentURI: data: URI, ${uri.length} bytes, keccak256 ${AgentURIGenerator.calculateFileHash(file)}`);

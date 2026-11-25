import { loadConfig, type AgentConfig } from "./config.ts";
import { buildApp } from "./server.ts";
import { inspectorLabel, visionProviderFromEnv } from "./shared.ts";

let cfg: AgentConfig;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(`KeyEscrow Inspector: ${(err as Error).message}`);
  process.exit(1);
}
const app = buildApp(cfg);
const server = app.listen(cfg.port, cfg.host, () => {
  const id = cfg.inspector?.identity;
  console.log(`KeyEscrow Inspector listening on http://${cfg.host}:${cfg.port}`);
  console.log(`  A2A card      ${cfg.publicUrl}/.well-known/agent-card.json  (JSON-RPC ${cfg.publicUrl}/a2a)`);
  console.log(`  MCP           ${cfg.publicUrl}/mcp`);
  console.log(`  REST          ${cfg.publicUrl}/inspect`);
  console.log(`  ERC-8004 file ${cfg.publicUrl}/.well-known/agent-registration.json`);
  const provider = visionProviderFromEnv();
  console.log(`  provider      ${provider ? `${provider.name} (${provider.model})` : "mock (deterministic, no key)"}`);
  console.log(
    id
      ? `  identity      ${inspectorLabel(id)} · signer ${id.address}${id.agentRegistry ? ` · ${id.agentRegistry}` : ""} (from ${cfg.identitySource === "none" ? "key only" : cfg.identitySource})`
      : "  identity      none: reports are unsigned (set INSPECTOR_PRIVATE_KEY, see docs/AGENT.md)",
  );
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

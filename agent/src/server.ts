import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import { InspectorExecutor } from "./a2a.ts";
import { buildAgentCard, buildRegistrationFile, parseAgentRegistry, SKILL_ID } from "./card.ts";
import type { AgentConfig } from "./config.ts";
import { errorPayload, inspectMoveOut, type InspectDeps } from "./inspect.ts";
import { buildMcpServer } from "./mcp.ts";
import { inspectorLabel, visionProviderFromEnv, type VisionProvider } from "./shared.ts";

export interface BuildOptions {
  /** Override the vision provider (tests); default comes from env (mock without ANTHROPIC_API_KEY). */
  provider?: VisionProvider | null;
  now?: () => Date;
}

/**
 * One process, three faces over the same skill:
 *   A2A   GET /.well-known/agent-card.json, JSON-RPC at POST /a2a (message/send)
 *   MCP   Streamable HTTP at POST /mcp (stateless, JSON responses)
 *   REST  POST /inspect (same body as POST /api/settlement in the web app)
 * plus GET /.well-known/agent-registration.json (the ERC-8004 registration file) and GET /health.
 */
export function buildApp(cfg: AgentConfig, opts: BuildOptions = {}): Express {
  const identity = cfg.inspector?.identity ?? null;
  const deps = (): InspectDeps => ({ inspector: cfg.inspector, provider: opts.provider, now: opts.now?.() });
  const card = buildAgentCard(cfg.publicUrl, identity);
  const registry = parseAgentRegistry(identity?.agentRegistry);
  const registration = buildRegistrationFile(cfg.publicUrl, {
    agentId: identity?.agentId,
    identityRegistry: registry?.identityRegistry,
    chainId: registry?.chainId,
  });

  const a2a = new DefaultRequestHandler(card, new InMemoryTaskStore(), new InspectorExecutor(deps));

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      name: card.name,
      skill: SKILL_ID,
      provider: (opts.provider !== undefined ? opts.provider : visionProviderFromEnv())?.name ?? "mock",
      inspector: identity ? { ...identity, label: inspectorLabel(identity) } : null,
    });
  });

  app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: async () => card }));
  app.get("/.well-known/agent-registration.json", (_req, res) => {
    res.json(registration);
  });

  app.post("/inspect", async (req, res) => {
    try {
      res.json(await inspectMoveOut(req.body, deps()));
    } catch (err) {
      const { status, ...payload } = errorPayload(err);
      res.status(status).json(payload);
    }
  });

  app.post("/mcp", async (req, res) => {
    const server = buildMcpServer(deps(), identity);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "use POST (stateless MCP server)" }, id: null });
  });

  app.use("/a2a", jsonRpcHandler({ requestHandler: a2a, userBuilder: UserBuilder.noAuthentication }));

  return app;
}

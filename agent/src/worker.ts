/**
 * KeyEscrow Inspector on Cloudflare Workers (worker keyescrow-agent, agent/wrangler.jsonc; docs/CLOUDFLARE.md).
 *
 * The same three faces as the Node server (src/server.ts), on Web-standard Request/Response instead of express:
 *   A2A   GET /.well-known/agent-card.json, JSON-RPC at POST /a2a (message/send)
 *   MCP   Streamable HTTP at POST /mcp (stateless, JSON responses): the inspection plus the rental-action tools
 *         from web/lib/actions (reads and unsigned prepare_* transactions over fetch-based RPC; no keys)
 *   REST  POST /inspect (same body as POST /api/settlement in the web app)
 * plus GET /.well-known/agent-registration.json (the ERC-8004 registration file) and GET /health.
 *
 * Config comes from the Worker's vars and secrets (INSPECTOR_PRIVATE_KEY, ANTHROPIC_API_KEY, ...) and the committed
 * registration record agent/deployments/97.json. AGENT_PUBLIC_URL defaults to the URL the request came in on, so the
 * card points at https://keyescrow-agent.<subdomain>.workers.dev without knowing the subdomain up front.
 */
import { DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, ServerCallContext, A2AError } from "@a2a-js/sdk/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { R2EvidenceStore, type R2BucketLike } from "../../web/lib/server/evidence/r2.ts";
import deployment97 from "../deployments/97.json" with { type: "json" };
import { InspectorExecutor } from "./a2a.ts";
import { buildAgentCard, buildRegistrationFile, parseAgentRegistry, SKILL_ID } from "./card.ts";
import { configFromEnv, type AgentConfig, type AgentDeployment } from "./identity.ts";
import { errorPayload, inspectMoveOut, type InspectDeps } from "./inspect.ts";
import { buildMcpServer } from "./mcp.ts";
import { inspectorLabel, PriceService, visionProviderFromEnv, type ActionHost } from "./shared.ts";

export interface AgentWorkerEnv {
  [key: string]: unknown;
  /** Optional: the web app's R2 evidence bucket, to resolve photo hashes for a live vision model. */
  EVIDENCE?: R2BucketLike;
}

const MAX_BODY_BYTES = 1024 * 1024; // same as express.json({ limit: "1mb" })

type App = {
  cfg: AgentConfig;
  /** The rental-action tools (get_lease, prepare_fund, ...): fetch-based RPC per chain, read-only, no keys. */
  actions: ActionHost;
  card: ReturnType<typeof buildAgentCard>;
  registration: Record<string, unknown>;
  rpc: JsonRpcTransportHandler;
};

/** Per isolate, per public URL: the card, registration file and A2A handler are pure functions of the config. */
const apps = new Map<string, App>();

function stringEnv(env: AgentWorkerEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

function appFor(env: AgentWorkerEnv, origin: string): App {
  const vars = stringEnv(env);
  const publicUrl = (vars.AGENT_PUBLIC_URL || origin).replace(/\/+$/, "");
  const hit = apps.get(publicUrl);
  if (hit) return hit;
  const deployment = (vars.INSPECTOR_CHAIN_ID || "97") === "97" ? (deployment97 as AgentDeployment) : null;
  const cfg = configFromEnv({ ...vars, AGENT_PUBLIC_URL: publicUrl }, deployment);
  const identity = cfg.inspector?.identity ?? null;
  const card = buildAgentCard(cfg.publicUrl, identity);
  const registry = parseAgentRegistry(identity?.agentRegistry);
  const registration = buildRegistrationFile(cfg.publicUrl, {
    agentId: identity?.agentId,
    identityRegistry: registry?.identityRegistry,
    chainId: registry?.chainId,
  });
  // The executor reads its deps per request (InspectDeps carries no request state), so one handler serves them all.
  const deps = (): InspectDeps => workerDeps(cfg, env);
  // Quotes are cached per isolate; no in-flight sharing, since one request must not await another request's I/O here.
  const prices = new PriceService({ env: vars, dedupe: false });
  const actions: ActionHost = { env: vars, prices: () => prices.get() };
  const rpc = new JsonRpcTransportHandler(new DefaultRequestHandler(card, new InMemoryTaskStore(), new InspectorExecutor(deps, actions)));
  const app = { cfg, card, registration, rpc, actions };
  apps.set(publicUrl, app);
  return app;
}

/**
 * Per-request deps: photo hashes from the R2 bucket when bound; per-scooter memory from Living Brain when its
 * LIVING_BRAIN_* secrets are set (no local stand-in here: the Worker has no disk).
 */
function workerDeps(cfg: AgentConfig, env: AgentWorkerEnv): InspectDeps {
  return {
    inspector: cfg.inspector,
    loadStore: async () => (env.EVIDENCE ? new R2EvidenceStore(env.EVIDENCE) : undefined),
    loadMemory: async () => {
      const m = await import("../../web/lib/server/sponsors/livingbrain.ts");
      const vars = stringEnv(env);
      return m.livingBrainConfig(vars).configured ? m.inspectionMemoryFromEnv(vars) : null;
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

/** Parse a JSON body within the size limit; a Response on failure. */
async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, res: json({ error: "request body too large" }, 413) };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, res: json({ error: "request body too large" }, 413) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400) };
  }
}

async function handleA2a(app: App, request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.res;
  const body = parsed.body as { id?: unknown };
  try {
    const out = await app.rpc.handle(body, new ServerCallContext());
    if (typeof (out as AsyncGenerator)[Symbol.asyncIterator] === "function") {
      // The card says streaming: false; refuse rather than half-implement SSE.
      return json({ jsonrpc: "2.0", id: body?.id ?? null, error: A2AError.unsupportedOperation("streaming").toJSONRPCError() });
    }
    return json(out);
  } catch (err) {
    const e = err instanceof A2AError ? err : A2AError.internalError("General processing error.");
    return json({ jsonrpc: "2.0", id: body?.id ?? null, error: e.toJSONRPCError() }, 500);
  }
}

async function handleMcp(app: App, env: AgentWorkerEnv, request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.res;
  // One call per request: a JSON-RPC batch would run up to 100 inspections (paid model calls) in one POST.
  if (Array.isArray(parsed.body)) return json({ jsonrpc: "2.0", error: { code: -32600, message: "batch requests are not supported" }, id: null }, 400);
  const identity = app.cfg.inspector?.identity ?? null;
  const server = buildMcpServer(workerDeps(app.cfg, env), identity, app.actions);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { parsedBody: parsed.body });
  } finally {
    // JSON response mode: the reply is complete once handleRequest resolves.
    void transport.close();
    void server.close();
  }
}

export default {
  async fetch(request: Request, env: AgentWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    let app: App;
    try {
      app = appFor(env, url.origin);
    } catch (err) {
      // Config errors (a malformed key, a signer that does not match agent #2921) name the problem, never the key.
      console.error("[inspector] config", (err as Error).message);
      return json({ error: "agent misconfigured", detail: (err as Error).message }, 500);
    }
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/health" && method === "GET") {
      const identity = app.cfg.inspector?.identity ?? null;
      return json({
        ok: true,
        name: app.card.name,
        skill: SKILL_ID,
        runtime: "cloudflare-workers",
        provider: visionProviderFromEnv(stringEnv(env))?.name ?? "mock",
        inspector: identity ? { ...identity, label: inspectorLabel(identity) } : null,
      });
    }
    if (pathname === "/.well-known/agent-card.json" && method === "GET") return json(app.card);
    if (pathname === "/.well-known/agent-registration.json" && method === "GET") return json(app.registration);

    if (pathname === "/inspect" && method === "POST") {
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.res;
      try {
        return json(
          await inspectMoveOut(parsed.body, workerDeps(app.cfg, env)),
        );
      } catch (err) {
        const { status, ...payload } = errorPayload(err);
        return json(payload, status);
      }
    }

    if (pathname === "/mcp") {
      if (method !== "POST") {
        return json({ jsonrpc: "2.0", error: { code: -32000, message: "use POST (stateless MCP server)" }, id: null }, 405, { Allow: "POST" });
      }
      return handleMcp(app, env, request);
    }

    if (pathname === "/a2a" || pathname === "/a2a/") {
      if (method !== "POST") return json({ error: "use POST (A2A JSON-RPC)" }, 405, { Allow: "POST" });
      return handleA2a(app, request);
    }

    if (pathname === "/" && method === "GET") {
      return json({ name: app.card.name, card: `${app.cfg.publicUrl}/.well-known/agent-card.json`, mcp: `${app.cfg.publicUrl}/mcp`, a2a: app.card.url });
    }
    return json({ error: "not found" }, 404);
  },
};

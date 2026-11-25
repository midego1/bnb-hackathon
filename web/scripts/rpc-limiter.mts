/**
 * A "BSC-testnet-like" JSON-RPC proxy for a local anvil, for measuring and testing reads under the limits a public
 * RPC (PublicNode) enforces: eth_getLogs ranges over --max-range blocks are refused, and more than --rate calls per
 * second from one side (browser = request with an Origin header, server = without) answer HTTP 429.
 * Counts every call per side and method: GET /__stats, POST /__reset.
 *
 *   node web/scripts/rpc-limiter.mts --target http://127.0.0.1:28697 --port 28698 [--max-range 5000] [--rate 25]
 *
 * Local tool only: it forwards to the --target node and nothing else.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const target = arg("target", "http://127.0.0.1:8545");
const port = Number(arg("port", "28698"));
const maxRange = BigInt(arg("max-range", "5000"));
const rate = Number(arg("rate", "25"));

type Side = "browser" | "server";
type Stats = { calls: Record<Side, Record<string, number>>; httpRequests: Record<Side, number>; rateLimited: Record<Side, number>; rangeRefused: Record<Side, number> };
const fresh = (): Stats => ({
  calls: { browser: {}, server: {} },
  httpRequests: { browser: 0, server: 0 },
  rateLimited: { browser: 0, server: 0 },
  rangeRefused: { browser: 0, server: 0 },
});
let stats = fresh();
const hits: Record<Side, number[]> = { browser: [], server: [] };

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { ...cors, "content-type": "application/json" });
  res.end(JSON.stringify(json));
}

const hexBlock = async (tag: unknown): Promise<bigint | undefined> => {
  if (typeof tag !== "string") return undefined;
  if (tag.startsWith("0x")) return BigInt(tag);
  if (tag === "latest" || tag === "safe" || tag === "finalized") {
    const r = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
    return BigInt(((await r.json()) as { result: string }).result);
  }
  return tag === "earliest" ? BigInt(0) : undefined;
};

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/__stats") return send(res, 200, stats);
  if (req.method === "POST" && req.url === "/__reset") {
    stats = fresh();
    return send(res, 200, { ok: true });
  }
  const side: Side = req.headers.origin ? "browser" : "server";
  const text = await body(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return send(res, 400, { error: "bad json" });
  }
  const list = (Array.isArray(parsed) ? parsed : [parsed]) as { id?: unknown; method?: string; params?: unknown[] }[];
  stats.httpRequests[side]++;
  for (const c of list) stats.calls[side][c.method ?? "?"] = (stats.calls[side][c.method ?? "?"] ?? 0) + 1;

  const now = Date.now();
  hits[side] = hits[side].filter((t) => now - t < 1000);
  if (hits[side].length + list.length > rate) {
    stats.rateLimited[side]++;
    return send(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32005, message: "rate limit exceeded" } });
  }
  hits[side].push(...list.map(() => now));

  for (const c of list) {
    if (c.method !== "eth_getLogs") continue;
    const f = (c.params?.[0] ?? {}) as { fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown };
    if (f.blockHash) continue;
    const from = (await hexBlock(f.fromBlock ?? "latest")) ?? BigInt(0);
    const to = (await hexBlock(f.toBlock ?? "latest")) ?? BigInt(0);
    if (to - from + BigInt(1) > maxRange) {
      stats.rangeRefused[side]++;
      const err = { jsonrpc: "2.0", id: c.id ?? null, error: { code: -32701, message: `exceed maximum block range: ${maxRange}` } };
      return send(res, 200, Array.isArray(parsed) ? list.map((x) => ({ ...err, id: x.id ?? null })) : err);
    }
  }
  const upstream = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  res.writeHead(upstream.status, { ...cors, "content-type": "application/json" });
  res.end(await upstream.text());
}).listen(port, "127.0.0.1", () => console.log(`rpc-limiter on 127.0.0.1:${port} -> ${target} (max range ${maxRange}, ${rate}/s per side)`));

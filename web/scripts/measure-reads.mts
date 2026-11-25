/**
 * Counts the chain reads every page fires in a real browser (Playwright): JSON-RPC calls per method (batches
 * unpacked), our own /api/chain reads, HTTP >= 400 answers and console errors, and how long the first burst of reads
 * takes. Read-only: the injected wallet (--wallet) only answers eth_chainId / eth_accounts and refuses anything that
 * signs or sends.
 *
 *   node web/scripts/measure-reads.mts --base http://127.0.0.1:3000 --chain 97 \
 *     --wallet 0x8ef4...  --pages /backoffice,/landlord,/tenant,/shareholders,/arbiter,/lease/0x... [--runs 2] [--json out.json]
 *
 * Every page is loaded `--runs` times in a fresh browser context (run 1 = cold for the server cache, later runs warm).
 */
import { chromium, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

type Args = { base: string; chain: number; wallet?: string; pages: string[]; runs: number; json?: string; idleMs: number };

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    base: get("base") ?? "http://127.0.0.1:3000",
    chain: Number(get("chain") ?? 97),
    wallet: get("wallet"),
    pages: (get("pages") ?? "/backoffice,/landlord,/tenant,/shareholders,/arbiter").split(",").filter(Boolean),
    runs: Number(get("runs") ?? 2),
    json: get("json"),
    idleMs: Number(get("idle") ?? 2500),
  };
}

export type PageMeasure = {
  page: string;
  run: number;
  rpc: Record<string, number>;
  rpcRequests: number;
  api: Record<string, number>;
  httpErrors: string[];
  consoleErrors: string[];
  /** Time from navigation start to the last chain-read response of the first burst. */
  readsDoneMs: number;
};

/** A minimal read-only EIP-1193 wallet: enough for wagmi's injected connector to reconnect as `address`. */
function walletScript(address: string, chainIdHex: string) {
  return `(() => {
    const listeners = {};
    const provider = {
      isMetaMask: false,
      request: async ({ method }) => {
        if (method === "eth_chainId") return "${chainIdHex}";
        if (method === "net_version") return String(parseInt("${chainIdHex}", 16));
        if (method === "eth_accounts" || method === "eth_requestAccounts") return ["${address}"];
        if (method === "wallet_getPermissions" || method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        throw Object.assign(new Error("read-only measurement wallet: " + method + " refused"), { code: 4200 });
      },
      on: (e, f) => ((listeners[e] ??= []).push(f), provider),
      removeListener: () => provider,
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    try {
      localStorage.setItem("wagmi.injected.connected", "true");
      localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
    } catch {}
  })();`;
}

function rpcMethods(body: string | null): string[] {
  if (!body) return [];
  try {
    const j = JSON.parse(body);
    const list = Array.isArray(j) ? j : [j];
    return list.filter((x) => x && typeof x.method === "string" && x.jsonrpc).map((x) => x.method as string);
  } catch {
    return [];
  }
}

async function measure(page: Page, url: string, idleMs: number): Promise<Omit<PageMeasure, "page" | "run">> {
  const rpc: Record<string, number> = {};
  const api: Record<string, number> = {};
  const httpErrors: string[] = [];
  const consoleErrors: string[] = [];
  let rpcRequests = 0;
  let inflight = 0;
  let lastRead = 0;
  let lastActivity = Date.now();
  const start = Date.now();
  const isApi = (u: string) => /\/api\/chain\//.test(u);
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  page.on("request", (r) => {
    const methods = r.method() === "POST" ? rpcMethods(r.postData()) : [];
    if (methods.length) {
      rpcRequests++;
      for (const m of methods) rpc[m] = (rpc[m] ?? 0) + 1;
    } else if (isApi(r.url())) {
      const key = new URL(r.url()).pathname;
      api[key] = (api[key] ?? 0) + 1;
    } else return;
    inflight++;
    lastActivity = Date.now();
  });
  const done = (r: { url(): string; method(): string; postData(): string | null }) => {
    if (!(rpcMethods(r.method() === "POST" ? r.postData() : null).length || isApi(r.url()))) return;
    inflight--;
    lastRead = Date.now() - start;
    lastActivity = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", (r) => {
    httpErrors.push(`failed ${r.url().slice(0, 80)} ${r.failure()?.errorText ?? ""}`);
    done(r);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url().slice(0, 100)}`);
  });
  await page.goto(url, { waitUntil: "load" });
  // The first burst is over once nothing chain-related has been in flight for `idleMs` (polls run every 8 s).
  while (Date.now() - start < 60_000) {
    await page.waitForTimeout(250);
    if (inflight <= 0 && Date.now() - lastActivity >= idleMs) break;
  }
  return { rpc, rpcRequests, api, httpErrors, consoleErrors, readsDoneMs: lastRead };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch();
  const out: PageMeasure[] = [];
  try {
    for (const p of args.pages) {
      for (let run = 1; run <= args.runs; run++) {
        const context = await browser.newContext();
        if (args.wallet) await context.addInitScript(walletScript(args.wallet, `0x${args.chain.toString(16)}`));
        const page = await context.newPage();
        const m = await measure(page, new URL(p, args.base).toString(), args.idleMs);
        out.push({ page: p, run, ...m });
        await context.close();
        const getLogs = m.rpc.eth_getLogs ?? 0;
        const calls = m.rpc.eth_call ?? 0;
        const other = Object.entries(m.rpc).filter(([k]) => k !== "eth_getLogs" && k !== "eth_call").map(([k, v]) => `${k}=${v}`).join(" ");
        console.log(
          `${p.padEnd(56)} run ${run}: getLogs ${String(getLogs).padStart(3)}  eth_call ${String(calls).padStart(3)}  rpc-http ${String(m.rpcRequests).padStart(3)}  ` +
            `api ${JSON.stringify(m.api)}  errors ${m.httpErrors.length}  console ${m.consoleErrors.length}  reads ${m.readsDoneMs} ms  ${other}`,
        );
        for (const e of [...m.httpErrors, ...m.consoleErrors].slice(0, 4)) console.log(`    ${e}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 2));
}

await main();

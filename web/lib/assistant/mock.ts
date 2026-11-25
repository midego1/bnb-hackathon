/**
 * The demo model: a deterministic script that plays Ask AI's demo prompts offline (no key, no network, no cost) by
 * calling the SAME tools as Claude would, through the same engine, approvals and cards. Used when the server has no
 * ANTHROPIC_API_KEY or ASSISTANT_MOCK=1, and by every test. The panel shows a "Demo model" badge.
 *
 * It reads only what a real model would read: the conversation (the person's message, the marked page context and
 * the tool results).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AssistantModel, ModelRequest, ModelResponse } from "./model";

export const MOCK_MODEL_ID = "demo-model";

/** Anvil's dev renter (#2): a public, well-known test address used by the local demo. */
const DEV_RENTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

type Ctx = { lease?: string; address?: string; path?: string; chainId?: number };
type ToolCall = { name: string; input: Record<string, unknown> };
type Turn = { calls: ToolCall[]; results: string[] };

export type Intent =
  | { kind: "deposit" }
  | { kind: "next" }
  | { kind: "explain" }
  | { kind: "create"; rent?: string; deposit?: string; renter?: string; termMonths: number }
  | { kind: "ai_split" }
  | { kind: "dispute" }
  | { kind: "goto"; path: string; label: string }
  | { kind: "find" }
  | { kind: "decisions" }
  | { kind: "simple" }
  | { kind: "help" };

const num = (s: string | undefined) => (s ? s.replace(/[,\s]/g, "") : undefined);

/** What the person asked for, by keyword. Exported for tests. */
export function parseIntent(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (/^\/status\b|where('s| is) (my|the) deposit|deposit (now|status)/.test(t)) return { kind: "deposit" };
  if (/^\/next\b|what (happens|should i do|do i do|can i do) next|what now/.test(t)) return { kind: "next" };
  if (/^\/explain\b|explain (this|the|my) (rental|lease)/.test(t)) return { kind: "explain" };
  if (/explain keyescrow|keyescrow simply|how does (keyescrow|this) work|what is keyescrow/.test(t)) return { kind: "simple" };
  if (/\b(create|make|new|set up)\b.*\b(rental|lease|offer)\b/.test(t)) {
    const rent = num(/([\d,]+(?:\.\d+)?)\s*(?:thb|baht|฿)?\s*(?:a|per|\/)\s*month/.exec(t)?.[1]) ?? num(/rent (?:of )?([\d,]+(?:\.\d+)?)/.exec(t)?.[1]);
    const deposit =
      num(/([\d,]+(?:\.\d+)?)\s*(?:thb|baht|฿)?\s*deposit/.exec(t)?.[1]) ?? num(/deposit (?:of )?(?:฿)?([\d,]+(?:\.\d+)?)/.exec(t)?.[1]);
    const addr = /0x[0-9a-fA-F]{40}/.exec(text)?.[0];
    const renter = addr ?? (/(demo|anvil|test) renter/.test(t) ? DEV_RENTER : undefined);
    const months = /for (\d{1,2}) months?/.exec(t)?.[1];
    return { kind: "create", rent, deposit, renter, termMonths: months ? Number(months) : 1 };
  }
  if (/\bai\b.*\bsplit\b|\binspection\b|propose the (ai )?split/.test(t)) return { kind: "ai_split" };
  if (/(open|start|raise) a dispute|^dispute\b/.test(t)) return { kind: "dispute" };
  if (/(go|take me|open|navigate)\b.*dispute desk/.test(t)) return { kind: "goto", path: "/arbiter", label: "the dispute desk" };
  if (/(go|take me|open)\b.*\b(owner|fleet owner) page/.test(t)) return { kind: "goto", path: "/landlord", label: "the fleet owner page" };
  if (/(go|take me|open)\b.*\brenter page/.test(t)) return { kind: "goto", path: "/tenant", label: "the renter page" };
  if (/needs? my decision|waiting for me|to decide/.test(t)) return { kind: "decisions" };
  if (/find my rental|my rentals|list (my )?rentals/.test(t)) return { kind: "find" };
  return { kind: "help" };
}

/** The page context block the engine puts in the person's message (marked untrusted JSON). */
function readContext(text: string): Ctx {
  const m = /<untrusted_data source="page context">\n([\s\S]*?)\n<\/untrusted_data>/.exec(text);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as Ctx;
  } catch {
    return {};
  }
}

/** JSON payload of a tool result, if it carries one. */
function payload(result: string): Record<string, unknown> | undefined {
  const m = /<untrusted_data source="[^"]*">\n([\s\S]*?)\n<\/untrusted_data>/.exec(result);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

const blockText = (c: Anthropic.MessageParam["content"]) =>
  typeof c === "string" ? [c] : c.flatMap((b) => (b.type === "text" ? [(b as Anthropic.TextBlockParam).text] : []));

const resultText = (b: Anthropic.ToolResultBlockParam) =>
  typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => (x.type === "text" && "text" in x ? String(x.text) : "")).join("");

/** The person's latest message, its context, and the tool calls + results since. */
function readConversation(messages: Anthropic.MessageParam[]) {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && blockText(m.content).some((t) => t.startsWith("<untrusted_data source=\"page context\">"))) {
      start = i;
      break;
    }
  }
  const texts = start >= 0 ? blockText(messages[start].content) : [];
  const ctx = readContext(texts.find((t) => t.includes("page context")) ?? "");
  const ask = texts.filter((t) => !t.includes("page context")).at(-1) ?? "";
  const turn: Turn = { calls: [], results: [] };
  for (const m of messages.slice(start + 1)) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (m.role === "assistant" && b.type === "tool_use") turn.calls.push({ name: b.name, input: b.input as Record<string, unknown> });
      if (m.role === "user" && b.type === "tool_result") turn.results.push(resultText(b));
    }
  }
  return { ask, ctx, turn };
}

type Reply = { text?: string; tool?: ToolCall };

const failed = (r: string) => /^(ERROR|NOT DONE|DECLINED|EXPIRED)/.test(r);

function outcome(r: string, what: string, after: string): string {
  if (/^APPLIED/.test(r)) return after;
  if (/^DECLINED/.test(r)) return `OK, I did not ${what}. Nothing changed.`;
  if (/^EXPIRED/.test(r)) return `The approval expired, so I did not ${what}. Nothing changed.`;
  return `I could not ${what}: ${r.replace(/^(ERROR|NOT DONE):\s*/, "").split("\n")[0]}`;
}

/** The script: the next reply for the person's request, given the tool results so far. Exported for tests. */
export function nextReply(ask: string, ctx: Ctx, turn: Turn): Reply {
  const intent = parseIntent(ask);
  const n = turn.results.length;
  const last = turn.results[n - 1] ?? "";
  const lease = ctx.lease;

  const needLease = (): Reply => ({
    text: ctx.address
      ? "Open the rental you mean first (its page), or ask me to **find my rental**."
      : "Open a rental's page first, or connect your wallet so I can find your rentals.",
  });

  switch (intent.kind) {
    case "deposit":
    case "next":
    case "explain": {
      if (!lease) {
        if (!ctx.address) return needLease();
        if (n === 0) return { text: "Let me look up your rentals.", tool: { name: "list_leases", input: {} } };
        return { text: failed(last) ? outcome(last, "look up your rentals", "") : `${totalsLine(last)} Open one to see where its deposit is.` };
      }
      if (n === 0) return { text: "Let me check this rental.", tool: { name: "explain_status", input: { lease } } };
      if (failed(last)) return { text: outcome(last, "read this rental", "") };
      const p = payload(last) as { headline?: string; deposit?: { where?: string }; next?: { who: string; what: string; action: string }[]; you?: string; text?: string } | undefined;
      if (intent.kind === "explain") return { text: p?.text ?? "Here is the rental." };
      if (intent.kind === "deposit") return { text: `**${p?.headline ?? ""}**\n\nYour deposit: ${p?.deposit?.where ?? "see the card."}` };
      const mine = (p?.next ?? []).filter((s) => s.who === p?.you || s.who === "anyone");
      const list = (mine.length ? mine : (p?.next ?? [])).map((s) => `- ${s.what}`).join("\n");
      return { text: list ? `${p?.headline ?? ""}\n\n${mine.length ? "What you can do next:" : "What happens next:"}\n${list}` : "Nothing else can happen: this rental is closed." };
    }

    case "create": {
      if (n === 0) {
        if (!ctx.address) return { text: "Connect your wallet first: the rental is created by your own wallet." };
        if (!intent.rent || !intent.deposit) return { text: 'Tell me the rent and the deposit, e.g. "Create a rental for 3,400 baht a month with a 6,800 deposit for 0x…".' };
        if (!intent.renter) return { text: "Which wallet rents the scooter? Give the renter's address (0x…)." };
        return {
          text: `I'll prepare a rental of ฿${Number(intent.rent).toLocaleString("en-US")} a month with a ฿${Number(intent.deposit).toLocaleString("en-US")} deposit. It needs your approval.`,
          tool: {
            name: "prepare_create_lease",
            input: { renter: intent.renter, rent: intent.rent, deposit: intent.deposit, currency: "THB", termMonths: intent.termMonths },
          },
        };
      }
      const lease = /Rental address: (0x[0-9a-fA-F]{40})/.exec(last)?.[1];
      return { text: outcome(last, "create the rental", `Done: the rental offer is on-chain${lease ? ` at \`${lease}\`` : ""}. Next, the renter funds the deposit and first month.`) };
    }

    case "ai_split": {
      if (!lease) return needLease();
      if (n === 0) return { text: "I'll run the AI return inspection on this rental's photos.", tool: { name: "inspect_return", input: { lease } } };
      if (n === 1) {
        if (failed(last)) return { text: outcome(last, "run the inspection", "") };
        const p = payload(last);
        return { text: "The inspection proposes a split. I'll prepare it as your proposal; it needs your approval.", tool: { name: "prepare_propose_settlement", input: { lease, inspection: p } } };
      }
      return { text: outcome(last, "propose the split", "Proposed. The other side can now accept, counter or open a dispute.") };
    }

    case "dispute": {
      if (!lease) return needLease();
      if (n === 0) return { text: "I'll prepare the dispute. It needs your approval.", tool: { name: "prepare_dispute", input: { lease } } };
      return { text: outcome(last, "open the dispute", "The dispute is open. The deposit is frozen until the dispute desk rules.") };
    }

    case "goto":
      if (n === 0) return { tool: { name: "open_page", input: { path: intent.path } } };
      return { text: failed(last) ? outcome(last, `open ${intent.label}`, "") : `Opened ${intent.label}.` };

    case "find":
      if (!ctx.address) return { text: "Connect your wallet so I can find your rentals." };
      if (n === 0) return { text: "Looking up your rentals as renter.", tool: { name: "list_leases", input: { role: ctx.path === "/landlord" ? "owner" : "renter" } } };
      return { text: failed(last) ? outcome(last, "look up your rentals", "") : `${totalsLine(last)}` };

    case "decisions":
      if (!ctx.address) return { text: "Connect the dispute desk's wallet so I can see its cases." };
      if (n === 0) return { tool: { name: "list_leases", input: { role: "arbiter" } } };
      if (failed(last)) return { text: outcome(last, "look up the cases", "") };
      {
        const disputed = Number(/(\d+) in dispute/.exec(last)?.[1] ?? 0);
        return { text: disputed ? `${disputed} rental(s) are in dispute and need your decision. Open one to rule on the split.` : "Nothing needs your decision right now." };
      }

    case "simple":
      return {
        text:
          "KeyEscrow keeps a scooter rental deposit safe without anyone holding your passport.\n\n" +
          "- The renter pays the deposit and the rent into a small smart contract on BNB Chain, not to the shop.\n" +
          "- At pickup and return, photos are taken; an AI inspector compares them and proposes how to split the deposit.\n" +
          "- Owner and renter accept the split, or a neutral dispute desk decides. If someone stays silent too long, the deposit goes back to the renter.\n\n" +
          "Nobody can take the deposit alone.",
      };

    case "help":
      return {
        text:
          "I'm the demo model, so I only know a few requests. Try:\n\n" +
          "- **Where is my deposit?** or **What happens next?** on a rental\n" +
          "- **Create a rental for 3,400 baht a month with a 6,800 deposit for 0x…**\n" +
          "- **Propose the AI split**, **Open a dispute**, **Go to the dispute desk**\n" +
          "- **Find my rental**, **What needs my decision?**, **Explain KeyEscrow simply**",
      };
  }
}

function totalsLine(result: string): string {
  return /TOTALS \(exact[^)]*\): ([^\n]*)/.exec(result)?.[1]?.replace(/^(\d+) rental\(s\)/, "You have $1 rental(s)") ?? "Here are your rentals.";
}

export function mockModel(): AssistantModel {
  return {
    id: MOCK_MODEL_ID,
    mock: true,
    async step(req: ModelRequest): Promise<ModelResponse> {
      if (req.signal.aborted) throw new DOMException("aborted", "AbortError");
      const { ask, ctx, turn } = readConversation(req.messages);
      const reply = nextReply(ask, ctx, turn);
      const content: Anthropic.ContentBlockParam[] = [];
      if (reply.text) {
        content.push({ type: "text", text: reply.text });
        // Stream it in small pieces, like a real model.
        for (const piece of reply.text.match(/\S+\s*|\s+/g) ?? []) req.onText(piece);
      }
      if (reply.tool) content.push({ type: "tool_use", id: `toolu_demo_${req.messages.length}`, name: reply.tool.name, input: reply.tool.input });
      return { content, stopReason: reply.tool ? "tool_use" : "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
}

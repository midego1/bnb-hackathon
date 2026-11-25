/**
 * Ask AI's run loop: one run per message (or per approve/decline answer). It sends the conversation to the model,
 * runs read tools at once, turns a prepare_* call into an approval card (and ends the run, waiting), and continues
 * after the person approved (and signed with their own wallet) or declined. Every card is built here from the action's
 * own result. Framework-agnostic: standard fetch/streams only, state through the AssistantStore interface.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { parseEventLogs, type Address, type Hex } from "viem";
import { escrowFactoryAbi } from "../contracts";
import { actionContext, ActionError, type ActionContext, type ActionHost } from "../actions/context";
import { explainLease } from "../actions/explain";
import { readLease, roleOf, type LeaseSnapshot } from "../actions/lease";
import { executeAction, jsonSafe } from "../actions/run";
import type { Prepared } from "../actions/simulate";
import { loadChat, putApproval, expireApproval, resolvePending, saveChat, takeApproval, APPROVAL_TTL_MS, type Approval } from "./approvals";
import { approvalCard, doneCard, leaseCard, leaseListCard, listTotalsText, type Card, type ListedLease, type Rates } from "./cards";
import type { AssistantEvent, AssistantState } from "./events";
import { estimateTokens, LIMITS, TokenBudget, usageTokens } from "./limits";
import type { AssistantModel } from "./model";
import { pageLabel, safeAppPath } from "./paths";
import { SYSTEM_PROMPT } from "./prompt";
import type { AssistantStore } from "./store";
import { findTool, stepLabel, toolSpecs, type AssistantTool } from "./tools";
import { untrusted } from "./untrusted";

export type RunContext = {
  path: string;
  lease?: Address;
  /** The connected wallet (the one that signs); absent when none is connected. */
  address?: Address;
  chainId: number;
};

export type RunRequest =
  | { chatId: string; message: string; context: RunContext }
  | { chatId: string; resume: { approvalId: string; decision: "approve" | "decline"; txHashes?: Hex[]; error?: string }; context: RunContext };

export type EngineDeps = {
  store: AssistantStore;
  model: AssistantModel;
  host: ActionHost;
  budget: TokenBudget;
  /** Runs the AI return inspection for a rental (the web host wires POST /api/settlement's service). */
  inspect?: (lease: LeaseSnapshot) => Promise<unknown>;
  now?: () => number;
  newId?: () => string;
};

type Emit = (e: AssistantEvent) => void;

const CHAIN_NAME: Record<number, string> = { 31337: "local anvil (demo chain)", 97: "BSC testnet" };

export async function runAssistant(req: RunRequest, deps: EngineDeps, emit: Emit, signal: AbortSignal): Promise<void> {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const runId = newId();
  let stepNo = 0;
  const stepId = () => `${runId.slice(0, 8)}-${++stepNo}`;
  const status = (state: AssistantState, text: string) => emit({ type: "status", state, text });

  emit({ type: "run_started", runId, chatId: req.chatId, model: deps.model.id, mock: deps.model.mock });

  const chat = await loadChat(deps.store, req.chatId, now());
  let changesApplied = 0;
  let rates: Rates | undefined;
  const getRates = async () => {
    if (rates || !deps.host.prices) return rates;
    try {
      const q = await deps.host.prices();
      rates = { THB: q.rates.USDT.THB, USD: q.rates.USDT.USD, mock: q.mock };
    } catch {
      /* cards then show mUSDT only */
    }
    return rates;
  };
  let ctx: ActionContext;
  try {
    ctx = actionContext(deps.host, req.context.chainId);
  } catch (err) {
    emit({ type: "error", code: "unsupported_chain", message: (err as Error).message });
    emit({ type: "run_finished", reason: "error" });
    return;
  }

  // ---- 1. What the person said, or their answer to the waiting change -------------------------------------------
  if ("message" in req) {
    const text = req.message.trim().slice(0, LIMITS.maxMessageChars);
    if (JSON.stringify(chat.messages).length > LIMITS.maxChatBytes) {
      emit({ type: "error", code: "chat_full", message: "This chat is too long. Start a new chat." });
      emit({ type: "run_finished", reason: "limit" });
      return;
    }
    const pageContext = await describeContext(ctx, req.context);
    const content: Anthropic.ContentBlockParam[] = [];
    if (chat.pending) {
      // A new message instead of an answer: the waiting change expires and the model is told it was not made.
      await expireApproval(deps.store, chat.chatId);
      content.push(...resolvePending(chat.pending, "EXPIRED: The person sent a new message instead of approving. Nothing was changed.", true));
      chat.pending = undefined;
    }
    content.push({ type: "text", text: untrusted("page context", pageContext) }, { type: "text", text });
    chat.messages.push({ role: "user", content });
    chat.counters = { steps: 0, tools: 0 };
  } else {
    const r = req.resume;
    if (!chat.pending || chat.pending.approvalId !== r.approvalId) {
      emit({ type: "error", code: "approval_mismatch", message: "This approval does not match the change that is waiting. Nothing was changed." });
      emit({ type: "run_finished", reason: "error" });
      return;
    }
    const taken = await takeApproval(deps.store, chat.chatId, r.approvalId, now());
    let answer: string;
    let isError = true;
    if (!taken.ok) {
      answer = `EXPIRED: ${taken.message} Nothing was changed.`;
      emit({ type: "step", id: stepId(), kind: "change", label: "Approval expired, not done", state: "expired" });
    } else if (r.decision === "decline") {
      answer = "DECLINED: The person declined this change. Nothing was changed.";
      emit({ type: "step", id: stepId(), kind: "change", label: `Declined: ${taken.approval.title}`, state: "declined" });
    } else {
      status("changing", "Confirming the change on chain…");
      const sid = stepId();
      emit({ type: "step", id: sid, kind: "change", label: `Confirming: ${taken.approval.title}…`, state: "running" });
      const confirmed = await confirmSteps(ctx, taken.approval, r.txHashes ?? [], signal);
      if (confirmed.ok) {
        isError = false;
        changesApplied = confirmed.txs.length;
        const lease = confirmed.lease ?? taken.approval.lease;
        answer =
          `APPLIED: ${confirmed.txs.length} change(s) confirmed on ${CHAIN_NAME[ctx.chainId] ?? `chain ${ctx.chainId}`}: ${taken.approval.title}.\n` +
          confirmed.txs.map((t) => `- ${t.description}: ${t.hash}`).join("\n") +
          (lease ? `\nRental address: ${lease}` : "");
        emit({ type: "step", id: sid, kind: "change", label: `${taken.approval.title}: confirmed`, state: "done" });
        emit({ type: "card", stepId: sid, card: doneCard(ctx.chainId, taken.approval.title, confirmed.txs, lease) });
        const path = lease ? safeAppPath(`/lease/${lease}`) : null;
        if (path) emit({ type: "navigate", path, label: pageLabel(path) });
      } else {
        answer = `NOT DONE: ${confirmed.error}`;
        emit({ type: "step", id: sid, kind: "change", label: `${taken.approval.title}: not done`, state: "failed", detail: confirmed.error });
      }
    }
    chat.messages.push({ role: "user", content: resolvePending(chat.pending, answer, isError) });
    chat.pending = undefined;
  }

  // ---- 2. The model loop -------------------------------------------------------------------------------------------
  const loopLen = chat.messages.length;
  const timeout = AbortSignal.timeout(LIMITS.runMs);
  const runSignal = AbortSignal.any([signal, timeout]);
  const tools = toolSpecs();

  const finish = async (reason: "done" | "waiting" | "stopped" | "limit" | "error") => {
    await saveChat(deps.store, chat, now());
    if (reason !== "waiting") status("idle", "");
    emit({ type: "run_finished", reason, ...(changesApplied ? { changesApplied } : {}) });
  };

  try {
    for (;;) {
      if (runSignal.aborted) return await finish(timeout.aborted && !signal.aborted ? "limit" : "stopped");
      if (chat.counters.steps >= LIMITS.stepsPerMessage) {
        emit({ type: "error", code: "limit", message: `I stopped after ${LIMITS.stepsPerMessage} steps for one message. Ask again in smaller parts.` });
        // Keep the history valid: the last message is the person's (tool results); close it with a short note.
        chat.messages.push({ role: "assistant", content: [{ type: "text", text: "(Stopped: step limit for one message.)" }] });
        return await finish("limit");
      }
      status("reading", "Thinking…");

      const body = { system: SYSTEM_PROMPT, tools, messages: chat.messages };
      const estimate = estimateTokens(body) + LIMITS.maxTokensPerStep;
      if (!deps.model.mock && !(await deps.budget.reserve(estimate))) {
        emit({ type: "error", code: "budget", message: "Ask AI has used up today's token budget on this server. Try again tomorrow." });
        return await finish("limit");
      }
      chat.counters.steps++;
      let response;
      try {
        response = await deps.model.step({
          system: SYSTEM_PROMPT,
          tools,
          messages: chat.messages,
          maxTokens: LIMITS.maxTokensPerStep,
          signal: runSignal,
          onText: (text) => emit({ type: "text_delta", text }),
        });
      } catch (err) {
        if (runSignal.aborted) {
          // Cut off after it was sent: keep the whole reservation (output before the stop is billed).
          return await finish(timeout.aborted && !signal.aborted ? "limit" : "stopped");
        }
        throw err;
      }
      if (!deps.model.mock) await deps.budget.settle(estimate, usageTokens(response.usage));
      chat.messages.push({ role: "assistant", content: response.content });

      const uses = response.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use");
      if (uses.length === 0) return await finish("done");

      const results: (Anthropic.ToolResultBlockParam | null)[] = [];
      let waiting: Approval | undefined;
      let overLimit = false;
      for (const use of uses) {
        chat.counters.tools++;
        const tool = findTool(use.name);
        let content: string;
        let isError = false;
        if (chat.counters.tools > LIMITS.toolCallsPerMessage) {
          overLimit = true;
          content = `ERROR: Tool call limit (${LIMITS.toolCallsPerMessage} per message) reached. Not run.`;
          isError = true;
        } else if (!tool) {
          content = `ERROR: There is no tool called ${use.name}.`;
          isError = true;
        } else if (tool.kind === "prepare" && waiting) {
          content = "NOT DONE: Only one change can wait for approval at a time. Prepare it again after the person answered the first one.";
          isError = true;
        } else if (tool.kind === "prepare") {
          const r = await prepareChange(tool, use, req.context, ctx, deps, chat.chatId, newId(), now(), getRates, emit, stepId());
          if ("approval" in r) {
            waiting = r.approval;
            results.push(null);
            continue;
          }
          content = r.error;
          isError = true;
        } else {
          const r = await runRead(tool, use, req.context, ctx, deps, getRates, emit, stepId(), runSignal);
          content = r.content;
          isError = r.isError;
        }
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      }

      if (waiting) {
        await putApproval(deps.store, waiting);
        chat.pending = { approvalId: waiting.id, toolUseId: waiting.toolUseId, results };
        status("waiting", "Waiting for your approval");
        return await finish("waiting");
      }
      chat.messages.push({ role: "user", content: results as Anthropic.ToolResultBlockParam[] });
      if (overLimit) {
        emit({ type: "error", code: "limit", message: `I stopped after ${LIMITS.toolCallsPerMessage} tool calls for one message.` });
        chat.messages.push({ role: "assistant", content: [{ type: "text", text: "(Stopped: tool call limit for one message.)" }] });
        return await finish("limit");
      }
    }
  } catch (err) {
    const message = (err as { code?: string; message?: string }).code ? (err as Error).message : "Ask AI ran into a problem. Try again.";
    if (!(err as { code?: string }).code) console.error("assistant run failed", (err as Error)?.message);
    emit({ type: "error", code: (err as { code?: string }).code ?? "internal_error", message });
    // Back to the history as it was when the loop started, so the next message starts from a valid conversation.
    chat.messages.length = loopLen;
    await finish("error");
  }
}

/** Page context for the model (marked untrusted): where the person is, which wallet, which role on the rental in view. */
async function describeContext(ctx: ActionContext, c: RunContext) {
  let role: string | undefined;
  let leaseStatus: string | undefined;
  if (c.lease) {
    try {
      const l = await readLease(ctx, c.lease);
      leaseStatus = l.status;
      role = c.address ? (roleOf(l, c.address) ?? "not a party") : undefined;
    } catch {
      /* not a rental on this chain: the model finds out when it reads it */
    }
  }
  return {
    path: c.path,
    chainId: ctx.chainId,
    chain: CHAIN_NAME[ctx.chainId] ?? `chain ${ctx.chainId}`,
    ...(c.lease ? { lease: c.lease } : {}),
    ...(leaseStatus ? { leaseStatus } : {}),
    ...(c.address ? { address: c.address } : { address: null, note: "No wallet connected." }),
    ...(role ? { role } : {}),
  };
}

const errorText = (err: unknown) => (err instanceof ActionError ? err.message : err instanceof Error && err.name === "ZodError" ? "Invalid input." : "Something went wrong reading the chain.");

/** Server-set inputs: the connected wallet and the chain. The model never chooses who acts. */
function withServerFields(tool: AssistantTool, input: Record<string, unknown>, c: RunContext, ctx: ActionContext) {
  const out: Record<string, unknown> = { ...input, chainId: ctx.chainId };
  delete out.from;
  delete out.viewer;
  if (tool.name === "explain_status" && c.address) out.viewer = c.address;
  if (tool.name === "list_leases") {
    out.limit = 50;
    if (!out.party && c.address) out.party = c.address;
  }
  if (tool.kind === "prepare" && c.address) out.from = c.address;
  return out;
}

async function runRead(
  tool: AssistantTool,
  use: Anthropic.ToolUseBlockParam,
  c: RunContext,
  ctx: ActionContext,
  deps: EngineDeps,
  getRates: () => Promise<Rates | undefined>,
  emit: Emit,
  sid: string,
  signal: AbortSignal,
): Promise<{ content: string; isError: boolean }> {
  const input = (use.input ?? {}) as Record<string, unknown>;
  const kind = tool.kind === "page" ? "page" : "read";
  emit({ type: "status", state: "reading", text: stepLabel(tool, false) });
  emit({ type: "step", id: sid, kind, label: stepLabel(tool, false), state: "running" });
  const fail = (message: string) => {
    emit({ type: "step", id: sid, kind, label: stepLabel(tool, false).replace(/…$/, ""), state: "failed", detail: message });
    return { content: `ERROR: ${message}`, isError: true };
  };

  if (tool.kind === "page") {
    const path = safeAppPath(input.path);
    if (!path) return fail(`${String(input.path).slice(0, 60)} is not a page Ask AI may open.`);
    emit({ type: "step", id: sid, kind, label: stepLabel(tool, true), state: "done", detail: pageLabel(path) });
    emit({ type: "navigate", path, label: pageLabel(path) });
    return { content: `Opened ${path} (${pageLabel(path)}) for the person.`, isError: false };
  }

  if (tool.kind === "inspect") {
    if (!deps.inspect) return fail("The AI inspection is not available on this server.");
    try {
      const address = String(input.lease ?? "") as Address;
      const l = await readLease(ctx, address);
      if (/^0x0+$/.test(l.checkInHash) || /^0x0+$/.test(l.checkOutHash)) {
        return fail("This rental has no pickup and return photos on-chain yet. Add them on the rental page first.");
      }
      const result = await deps.inspect(l);
      emit({ type: "step", id: sid, kind, label: stepLabel(tool, true), state: "done" });
      return { content: untrusted("inspect_return", jsonSafe(result)), isError: false };
    } catch (err) {
      return fail(err instanceof ActionError ? err.message : `The AI inspection failed: ${(err as Error)?.message ?? "unknown error"}`);
    }
  }

  const action = tool.action!;
  try {
    const parsed = action.input.safeParse(withServerFields(tool, input, c, ctx));
    if (!parsed.success) return fail(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    const args = parsed.data as Record<string, unknown>;
    if (tool.name === "list_leases" && !args.party) return fail("No wallet is connected, so there is no wallet to list rentals for.");
    const [result, r] = await Promise.all([executeAction(action, args, deps.host), getRates()]);
    if (signal.aborted) return { content: "ERROR: Stopped.", isError: true };
    let card: Card | undefined;
    let note: string | undefined;
    if (tool.name === "get_lease" || tool.name === "explain_status") {
      const l = await readLease(ctx, args.lease as Address);
      card = leaseCard(l, explainLease(l, c.address), r);
    } else if (tool.name === "list_leases") {
      const res = result as { leases: ListedLease[] };
      const perRole = new Map<string, number>();
      for (const l of res.leases) perRole.set(l.role, (perRole.get(l.role) ?? 0) + 1);
      const list = leaseListCard(String(args.party), ctx.chainId, res.leases, r, [...perRole.values()].some((n) => n >= 50));
      card = list;
      note = listTotalsText(list);
    }
    emit({ type: "step", id: sid, kind, label: stepLabel(tool, true), state: "done" });
    if (card) emit({ type: "card", stepId: sid, card });
    return { content: untrusted(tool.name, jsonSafe(result), note), isError: false };
  } catch (err) {
    return fail(errorText(err));
  }
}

async function prepareChange(
  tool: AssistantTool,
  use: Anthropic.ToolUseBlockParam,
  c: RunContext,
  ctx: ActionContext,
  deps: EngineDeps,
  chatId: string,
  approvalId: string,
  now: number,
  getRates: () => Promise<Rates | undefined>,
  emit: Emit,
  sid: string,
): Promise<{ approval: Approval } | { error: string }> {
  const action = tool.action!;
  emit({ type: "status", state: "reading", text: stepLabel(tool, false) });
  emit({ type: "step", id: sid, kind: "change", label: stepLabel(tool, false), state: "running" });
  const fail = (message: string) => {
    emit({ type: "step", id: sid, kind: "change", label: `Could not prepare: ${tool.title}`, state: "failed", detail: message });
    return { error: `ERROR: ${message}` };
  };
  if (!c.address) return fail("No wallet is connected. Ask the person to connect their wallet first; nothing was prepared.");
  const parsed = action.input.safeParse(withServerFields(tool, (use.input ?? {}) as Record<string, unknown>, c, ctx));
  if (!parsed.success) return fail(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`);
  const input = parsed.data as Record<string, unknown>;
  try {
    const [prepared, lease, rates] = await Promise.all([
      executeAction(action, input, deps.host) as Promise<Prepared>,
      typeof input.lease === "string" ? readLease(ctx, input.lease as Address) : Promise.resolve(undefined),
      getRates(),
    ]);
    const role = lease ? (roleOf(lease, c.address) ?? "anyone") : "owner";
    const expiresAt = now + APPROVAL_TTL_MS;
    const steps = prepared.steps.map((s) => ({ ...s, to: s.to as Address }));
    const card = approvalCard({
      id: approvalId,
      action: action.name,
      title: action.title,
      summary: prepared.summary,
      signer: c.address,
      signerRole: { owner: "Owner", renter: "Renter", arbiter: "Dispute desk", anyone: "You" }[role],
      chainId: ctx.chainId,
      steps: steps.map((s) => ({ description: s.description, function: s.function, to: s.to })),
      expiresAt,
      lease,
      input,
      expected: prepared.expected,
      rates,
    });
    emit({ type: "step", id: sid, kind: "change", label: `Waiting for you: ${action.title}`, state: "waiting" });
    emit({ type: "approval_required", stepId: sid, card, txs: steps.map((s) => ({ to: s.to, data: s.data, value: s.value })) });
    return {
      approval: {
        id: approvalId,
        chatId,
        toolUseId: use.id,
        action: action.name,
        title: action.title,
        chainId: ctx.chainId,
        from: c.address,
        steps,
        ...(lease ? { lease: lease.address } : {}),
        card,
        createdAt: now,
        expiresAt,
      },
    };
  } catch (err) {
    return fail(errorText(err));
  }
}

type Confirmed = { ok: true; txs: { hash: Hex; description: string }[]; lease?: Address } | { ok: false; error: string };

/**
 * Check what the browser reports against the approval: one mined, successful transaction per approved step, sent by
 * the approved wallet to the approved contract with exactly the approved calldata. Anything else is "not done".
 */
export async function confirmSteps(ctx: ActionContext, a: Approval, hashes: Hex[], signal: AbortSignal): Promise<Confirmed> {
  if (hashes.length === 0) return { ok: false, error: "Nothing was signed." };
  if (hashes.length > a.steps.length) return { ok: false, error: "More transactions were reported than were approved." };
  const txs: { hash: Hex; description: string }[] = [];
  let lease: Address | undefined;
  for (const [i, hash] of hashes.entries()) {
    const step = a.steps[i];
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, error: `Step ${i + 1}: not a transaction hash.` };
    let tx, receipt;
    for (let attempt = 0; ; attempt++) {
      try {
        [tx, receipt] = await Promise.all([ctx.client.getTransaction({ hash }), ctx.client.getTransactionReceipt({ hash })]);
        break;
      } catch {
        if (attempt >= 5 || signal.aborted) return { ok: false, error: `Step ${i + 1}: transaction ${hash} was not found on chain.` };
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (tx.from.toLowerCase() !== a.from.toLowerCase()) return { ok: false, error: `Step ${i + 1} was sent by ${tx.from}, not by the approved wallet ${a.from}.` };
    if (tx.to?.toLowerCase() !== step.to.toLowerCase() || tx.input.toLowerCase() !== step.data.toLowerCase()) {
      return { ok: false, error: `Step ${i + 1} is not the transaction that was approved.` };
    }
    if (receipt.status !== "success") return { ok: false, error: `Step ${i + 1} (${step.description}) was reverted on chain.` };
    txs.push({ hash, description: step.description });
    if (a.action === "prepare_create_lease") {
      const created = parseEventLogs({ abi: escrowFactoryAbi, logs: receipt.logs, eventName: "LeaseCreated" })[0];
      if (created) lease = (created.args as { escrow: Address }).escrow;
    }
  }
  if (txs.length < a.steps.length) {
    return { ok: false, error: `Only ${txs.length} of ${a.steps.length} steps were signed; the rest was not done.` };
  }
  return { ok: true, txs, ...(lease ? { lease } : {}) };
}

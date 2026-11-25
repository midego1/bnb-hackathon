/**
 * HTTP face of Ask AI (standard Request/Response, so it runs in Next and on Workers):
 *   POST /api/assistant         {chatId, message | resume, context}  -> text/event-stream of AssistantEvent
 *   POST /api/assistant/reset   {chatId}                             -> expires what waits in the chat, drops it
 *   GET  /api/assistant         -> {mock, model}  (the panel's "Demo model" badge)
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { expireApproval, peekApproval, resetChat } from "./approvals";
import { runAssistant, type EngineDeps, type RunRequest } from "./engine";
import { eventStream } from "./events";
import { allowRequest, LIMITS } from "./limits";
import { leaseInView, safeAppPath } from "./paths";

const address = z
  .string()
  .refine((s) => isAddress(s, { strict: false }))
  .transform((s) => getAddress(s) as Address);

const ContextSchema = z
  .object({
    path: z.string().max(200).default("/"),
    address: address.optional().nullable(),
    chainId: z.number().int(),
  })
  .strict();

const chatId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
/** The chat's model pick; the server only ever uses an allowed one (lib/assistant/model.ts resolveModel). */
const model = z.string().max(64).optional();

export const RunBodySchema = z.union([
  z.object({ chatId, message: z.string().trim().min(1).max(LIMITS.maxMessageChars), model, context: ContextSchema }).strict(),
  z
    .object({
      chatId,
      resume: z
        .object({
          approvalId: z.string().min(8).max(64),
          decision: z.enum(["approve", "decline"]),
          txHashes: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).max(10).optional(),
          error: z.string().max(300).optional(),
        })
        .strict(),
      model,
      context: ContextSchema,
    })
    .strict(),
]);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Who is asking, for the rate limit: the wallet if one is connected, else the client IP. */
function callerKey(req: Request, wallet?: string | null): string {
  if (wallet) return `w:${wallet.toLowerCase()}`;
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "local";
  return `ip:${ip}`;
}

export async function handleRun(req: Request, deps: EngineDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { error: "The request body must be JSON.", code: "invalid_input" });
  }
  const parsed = RunBodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: "Invalid Ask AI request.", code: "invalid_input" });
  const body = parsed.data;
  if (!(await allowRequest(deps.store, callerKey(req, body.context.address), deps.now?.()))) {
    return json(429, { error: "Too many requests. Wait a minute and try again.", code: "rate_limited" });
  }

  // The path only tells the model where the person is; the rental in view is derived from it (checked address).
  const path = body.context.path.split(/[?#]/)[0];
  const context = {
    path: safeAppPath(path) ?? path.replace(/[^\w/.-]/g, "").slice(0, 80),
    lease: leaseInView(path),
    address: body.context.address ?? undefined,
    chainId: body.context.chainId,
  };
  const request: RunRequest =
    "message" in body
      ? { chatId: body.chatId, message: body.message, context }
      : { chatId: body.chatId, resume: { ...body.resume, txHashes: body.resume.txHashes as Hex[] | undefined }, context };

  // The chat's model pick, checked against the allowlist; a refused pick is never used (the default answers).
  const picked = deps.modelFor?.(body.model);
  const runDeps: EngineDeps = picked ? { ...deps, model: picked.model, refusedModel: picked.refused ? String(body.model).slice(0, 64) : undefined } : deps;

  const { stream, emit, close } = eventStream();
  // The run stops when the person presses Stop or closes the tab (the request is aborted).
  void runAssistant(request, runDeps, emit, req.signal)
    .catch((err) => {
      console.error("assistant run crashed", (err as Error)?.message);
      emit({ type: "error", code: "internal_error", message: "Ask AI ran into a problem. Try again." });
      emit({ type: "run_finished", reason: "error" });
    })
    .finally(close);
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
  });
}

export async function handleReset(req: Request, deps: Pick<EngineDeps, "store">): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { error: "The request body must be JSON.", code: "invalid_input" });
  }
  const parsed = z.object({ chatId, approvalOnly: z.boolean().optional() }).strict().safeParse(raw);
  if (!parsed.success) return json(400, { error: "Invalid request.", code: "invalid_input" });
  const had = (await peekApproval(deps.store, parsed.data.chatId)) !== undefined;
  if (parsed.data.approvalOnly) await expireApproval(deps.store, parsed.data.chatId);
  else await resetChat(deps.store, parsed.data.chatId);
  return json(200, { ok: true, expired: had });
}

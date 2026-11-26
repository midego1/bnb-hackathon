/**
 * The model behind Ask AI: Claude through @anthropic-ai/sdk when the server has ANTHROPIC_API_KEY, else (or with
 * ASSISTANT_MOCK=1) a deterministic scripted model (mock.ts) that calls the same tools. The key is server env only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropicBusy } from "@/lib/server/settlement/vision";
import type { TokenUsage } from "./limits";
import { mockModel } from "./mock";

export type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL = "claude-sonnet-5-5";
/** The ONLY models Ask AI may use (server-enforced): no Opus, no Fable, nothing else. */
export const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const isAllowedModel = (m: unknown): m is AllowedModel => typeof m === "string" && (ALLOWED_MODELS as readonly string[]).includes(m);


export type ModelRequest = {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  signal: AbortSignal;
  onText: (delta: string) => void;
};

export type ModelResponse = {
  content: Anthropic.ContentBlockParam[];
  stopReason: string | null;
  usage: TokenUsage;
};

export interface AssistantModel {
  readonly id: string;
  readonly mock: boolean;
  step(req: ModelRequest): Promise<ModelResponse>;
}

export class ModelError extends Error {
  constructor(
    readonly code: "refusal" | "truncated" | "unavailable" | "auth" | "busy",
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/** The server's default: ASSISTANT_MODEL when it is one of the two allowed models, else Sonnet 5.5. */
export function modelId(env: Env): AllowedModel {
  const m = env.ASSISTANT_MODEL?.trim();
  return isAllowedModel(m) ? m : DEFAULT_MODEL;
}

/**
 * The model for one request: the chat's pick when it is allowed, else the server default. `refused` is true when a
 * pick was sent that is not on the allowlist (it is never used).
 */
export function resolveModel(requested: unknown, env: Env): { id: AllowedModel; refused: boolean } {
  if (requested === undefined || requested === null || requested === "") return { id: modelId(env), refused: false };
  if (isAllowedModel(requested)) return { id: requested, refused: false };
  return { id: DEFAULT_MODEL, refused: true };
}

export function isMocked(env: Env): boolean {
  return env.ASSISTANT_MOCK === "1" || !env.ANTHROPIC_API_KEY;
}

export function modelFromEnv(env: Env, requested?: unknown): AssistantModel {
  if (isMocked(env)) return mockModel();
  return new ClaudeModel(env.ANTHROPIC_API_KEY!, resolveModel(requested, env).id);
}

export class ClaudeModel implements AssistantModel {
  readonly mock = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly id: AllowedModel,
  ) {
    if (!isAllowedModel(id)) throw new Error("Ask AI only runs on Claude Sonnet 5.5 or Claude Haiku 5.5.");
    // fetch-based client: runs on Node and Workers alike.
    this.client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  }

  async step(req: ModelRequest): Promise<ModelResponse> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.id,
        max_tokens: req.maxTokens,
        // The system prompt and the tool list are the stable, cached prefix (cache_control on the last tool too).
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        tools: req.tools as Anthropic.Beta.BetaTool[],
        messages: req.messages as Anthropic.Beta.BetaMessageParam[],
        output_config: { effort: "low" },
        // No server-side refusal fallback: it could answer with a model outside the two allowed ones.
      },
      { signal: req.signal },
    );
    stream.on("text", (delta) => req.onText(delta));
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (req.signal.aborted) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new ModelError("auth", "The server's Anthropic API key was refused.");
      }
      // 429, 5xx/529, out of credit, network: say so plainly, the person can simply ask again.
      if (anthropicBusy(err)) throw new ModelError("busy", "AI is busy, try again.");
      if (err instanceof Anthropic.APIError) throw new ModelError("unavailable", "The model could not answer right now. Try again in a moment.");
      throw err;
    }
    const u = message.usage;
    // Counts only: never the conversation or the key.
    console.log("assistant: model call", this.id, `in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0}`);
    if (message.stop_reason === "refusal") throw new ModelError("refusal", "The model declined this request.");
    if (message.stop_reason === "max_tokens") throw new ModelError("truncated", "The answer was cut off. Ask a narrower question.");
    // Keep every block (thinking blocks included) so the next request can replay them unchanged.
    const content = message.content.filter((b) => b.type !== "fallback") as unknown as Anthropic.ContentBlockParam[];
    return { content, stopReason: message.stop_reason, usage: message.usage };
  }
}

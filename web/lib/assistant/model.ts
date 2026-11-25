/**
 * The model behind Ask AI: Claude through @anthropic-ai/sdk when the server has ANTHROPIC_API_KEY, else (or with
 * ASSISTANT_MOCK=1) a deterministic scripted model (mock.ts) that calls the same tools. The key is server env only.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "./limits";
import { mockModel } from "./mock";

export type Env = Record<string, string | undefined>;

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"] as const;

/** Models that take the server-side refusal fallback ("default" routes by refusal category). */
const FALLBACK_CAPABLE = new Set<string>(["claude-sonnet-5-5"]);

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
    readonly code: "refusal" | "truncated" | "unavailable" | "auth" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export function modelId(env: Env): string {
  const m = env.ASSISTANT_MODEL?.trim();
  return m && (ALLOWED_MODELS as readonly string[]).includes(m) ? m : DEFAULT_MODEL;
}

export function isMocked(env: Env): boolean {
  return env.ASSISTANT_MOCK === "1" || !env.ANTHROPIC_API_KEY;
}

export function modelFromEnv(env: Env): AssistantModel {
  if (isMocked(env)) return mockModel();
  return new ClaudeModel(env.ANTHROPIC_API_KEY!, modelId(env));
}

export class ClaudeModel implements AssistantModel {
  readonly mock = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly id: string,
  ) {
    // fetch-based client: runs on Node and Workers alike.
    this.client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  }

  async step(req: ModelRequest): Promise<ModelResponse> {
    const fallbacks = FALLBACK_CAPABLE.has(this.id);
    const stream = this.client.beta.messages.stream(
      {
        model: this.id,
        max_tokens: req.maxTokens,
        // The system prompt and the tool list are the stable, cached prefix (cache_control on the last tool too).
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        tools: req.tools as Anthropic.Beta.BetaTool[],
        messages: req.messages as Anthropic.Beta.BetaMessageParam[],
        output_config: { effort: "low" },
        ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
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
      if (err instanceof Anthropic.RateLimitError) throw new ModelError("rate_limited", "The model is busy right now. Try again in a minute.");
      if (err instanceof Anthropic.APIError) throw new ModelError("unavailable", "The model could not answer right now. Try again in a moment.");
      throw err;
    }
    if (message.stop_reason === "refusal") throw new ModelError("refusal", "The model declined this request.");
    if (message.stop_reason === "max_tokens") throw new ModelError("truncated", "The answer was cut off. Ask a narrower question.");
    // Keep every block (thinking blocks included) so the next request can replay them unchanged.
    const content = message.content.filter((b) => b.type !== "fallback") as unknown as Anthropic.ContentBlockParam[];
    return { content, stopReason: message.stop_reason, usage: message.usage };
  }
}

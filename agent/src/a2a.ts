import { randomUUID } from "node:crypto";
import type { DataPart, Message, Part } from "@a2a-js/sdk";
import { A2AError, type AgentExecutor, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { errorPayload, inspectMoveOut, type InspectDeps } from "./inspect.ts";
import { SKILL_ID } from "./card.ts";

/**
 * Pull the inspection request out of an A2A message: the first data part, or a text part holding JSON. A `skill`
 * key is accepted (and must name our skill) so generic A2A callers can use the {"skill": ..., ...} envelope.
 */
export function requestFromParts(parts: Part[]): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const data = parts.find((p): p is DataPart => p.kind === "data")?.data;
  let body: unknown = data;
  if (body === undefined) {
    const text = parts.find((p) => p.kind === "text");
    if (text && text.kind === "text") {
      try {
        body = JSON.parse(text.text);
      } catch {
        return { ok: false, error: `send the inspection request as a data part (or JSON text); see skill "${SKILL_ID}"` };
      }
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: `send the inspection request as a data part; see skill "${SKILL_ID}"` };
  }
  const { skill, ...rest } = body as Record<string, unknown>;
  if (skill !== undefined && skill !== SKILL_ID) {
    return { ok: false, error: `unknown skill ${JSON.stringify(skill)}; this agent offers "${SKILL_ID}"` };
  }
  return { ok: true, body: rest };
}

/** A2A executor: one request/response skill, answered with a single agent message carrying a data part. */
export class InspectorExecutor implements AgentExecutor {
  /** `deps` is called per request so tests can pin the clock. */
  constructor(private readonly deps: () => InspectDeps) {}

  execute = async (context: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const req = requestFromParts(context.userMessage?.parts ?? []);
    let data: Record<string, unknown>;
    if (!req.ok) {
      data = { error: req.error, status: 400 };
    } else {
      try {
        data = { ...(await inspectMoveOut(req.body, this.deps())) };
      } catch (err) {
        data = errorPayload(err);
      }
    }
    const message: Message = {
      kind: "message",
      role: "agent",
      messageId: randomUUID(),
      parts: [{ kind: "data", data }],
      contextId: context.contextId,
      taskId: context.taskId,
    };
    eventBus.publish(message);
    eventBus.finished();
  };

  cancelTask = async (): Promise<void> => {
    throw A2AError.unsupportedOperation("cancel");
  };
}

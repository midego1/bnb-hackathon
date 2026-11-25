import { randomUUID } from "node:crypto";
import type { DataPart, Message, Part } from "@a2a-js/sdk";
import { A2AError, type AgentExecutor, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { errorPayload, inspectMoveOut, type InspectDeps } from "./inspect.ts";
import { SKILL_ID } from "./card.ts";
import { errorBody, findAction, jsonSafe, runAction, type ActionHost } from "./shared.ts";

/**
 * Pull the request out of an A2A message: the first data part, or a text part holding JSON. A `skill` key picks the
 * skill: inspect_move_out (the default) or one of the rental actions (get_lease, prepare_fund, ...).
 */
export function requestFromParts(
  parts: Part[],
): { ok: true; skill: string; body: Record<string, unknown> } | { ok: false; error: string } {
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
  if (skill !== undefined && skill !== SKILL_ID && !(typeof skill === "string" && findAction(skill))) {
    return { ok: false, error: `unknown skill ${JSON.stringify(skill)}; see the agent card for the skills this agent offers` };
  }
  return { ok: true, skill: (skill as string | undefined) ?? SKILL_ID, body: rest };
}

/** A2A executor: request/response skills, each answered with a single agent message carrying a data part. */
export class InspectorExecutor implements AgentExecutor {
  /** `deps` is called per request so tests can pin the clock; `actions` serves the rental-action skills. */
  constructor(
    private readonly deps: () => InspectDeps,
    private readonly actions: ActionHost | null = null,
  ) {}

  execute = async (context: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const req = requestFromParts(context.userMessage?.parts ?? []);
    let data: Record<string, unknown>;
    if (!req.ok) {
      data = { error: req.error, status: 400 };
    } else if (req.skill !== SKILL_ID) {
      try {
        if (!this.actions) throw new Error("rental actions are not enabled on this agent");
        data = jsonSafe(await runAction(req.skill, req.body, this.actions)) as Record<string, unknown>;
      } catch (err) {
        const { status, body } = errorBody(err);
        data = { ...body, status };
      }
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

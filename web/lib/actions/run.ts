/** Runs an action definition: validate input, check role + status preconditions, then read or prepare + simulate. */
import type { z } from "zod";
import { ActionError, actionContext, type ActionHost } from "./context";
import { findAction, type Action } from "./definitions";
import { readLease, roleOf, ROLE_LABEL, type LeaseSnapshot } from "./lease";
import { prepareCalls } from "./simulate";

export function issues(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function parseInput(action: Action, raw: unknown): Record<string, unknown> {
  const r = action.input.safeParse(raw ?? {});
  if (!r.success) {
    const list = issues(r.error);
    const first = list[0];
    throw new ActionError(400, "invalid_input", `Invalid input for ${action.name}: ${first.path ? `${first.path}: ` : ""}${first.message}`, list);
  }
  return r.data as Record<string, unknown>;
}

/** Run with input that already passed `action.input` (the MCP SDK validates before calling us). */
export async function executeAction(action: Action, input: Record<string, unknown>, host: ActionHost): Promise<unknown> {
  const ctx = actionContext(host, input.chainId as number | undefined);
  if (action.kind === "read") return action.run(input as never, ctx);

  let lease: LeaseSnapshot | undefined;
  const from = input.from as `0x${string}`;
  if (typeof input.lease === "string") {
    lease = await readLease(ctx, input.lease as `0x${string}`);
    if (action.statuses && !action.statuses.includes(lease.status)) {
      throw new ActionError(409, "precondition_failed", `${action.name} needs the rental to be ${action.statuses.join(" or ")}; it is ${lease.status}.`, {
        status: lease.status,
      });
    }
    if (!action.roles.includes("anyone")) {
      const role = roleOf(lease, from);
      if (!role || !action.roles.includes(role)) {
        throw new ActionError(
          409,
          "precondition_failed",
          `Only ${action.roles.map((r) => ROLE_LABEL[r]).join(" or ")} can do this; ${from} is ${role ? ROLE_LABEL[role] : "not part of this rental"}.`,
          { role },
        );
      }
    }
  }
  const plan = await action.build(input as never, { ctx, lease });
  return prepareCalls(ctx, from, plan.calls, plan.summary, plan.pick);
}

export async function runAction(name: string, raw: unknown, host: ActionHost): Promise<unknown> {
  const action = findAction(name);
  if (!action) throw new ActionError(404, "unknown_action", `Unknown action ${name}. See /api/v1/openapi.json for the list.`);
  return executeAction(action, parseInput(action, raw), host);
}

/** JSON.stringify replacer for results: bigints as decimal strings. */
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Any thrown value -> {status, body} with a plain message. */
export function errorBody(err: unknown): { status: number; body: { error: string; code: string; details?: unknown } } {
  if (err instanceof ActionError) return { status: err.status, body: jsonSafe(err.toJSON()) as never };
  return { status: 500, body: { error: "Something went wrong on the server.", code: "internal_error" } };
}

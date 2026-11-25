/**
 * The REST face of the actions: GET /api/v1/<read action>?..., POST /api/v1/<prepare action> {json}.
 * Framework-agnostic (standard Request/Response), so the same handler runs in Next and on Workers.
 */
import type { ActionHost } from "./context";
import { ACTIONS, findAction, type Action } from "./definitions";
import { errorBody, executeAction, jsonSafe, parseInput } from "./run";

export const API_BASE = "/api/v1";

export type Route = { action: string; method: "GET" | "POST"; path: string };

export const methodOf = (a: Action): Route["method"] => (a.kind === "read" ? "GET" : "POST");

/** One route per action, derived from the definitions. */
export const ROUTES: readonly Route[] = ACTIONS.map((a) => ({ action: a.name, method: methodOf(a), path: `${API_BASE}/${a.name}` }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function handleActionRequest(req: Request, name: string, host: ActionHost): Promise<Response> {
  const action = findAction(name);
  if (!action) return json(404, { error: `Unknown action ${name}. See ${API_BASE}/openapi.json.`, code: "unknown_action" });
  const method = methodOf(action);
  if (req.method !== method) {
    return json(405, { error: `${action.name} is called with ${method}.`, code: "method_not_allowed" }, { allow: method });
  }
  try {
    let raw: unknown;
    if (method === "GET") {
      raw = Object.fromEntries(new URL(req.url).searchParams);
    } else {
      try {
        raw = await req.json();
      } catch {
        return json(400, { error: "The request body must be JSON.", code: "invalid_input" });
      }
    }
    const result = await executeAction(action, parseInput(action, raw), host);
    return json(200, jsonSafe(result));
  } catch (err) {
    const { status, body } = errorBody(err);
    if (status >= 500) console.error(`api/v1/${name} failed`, (err as Error)?.message);
    return json(status, body);
  }
}

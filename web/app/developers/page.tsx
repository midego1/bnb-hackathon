import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { ACTIONS, toolDescription, type Action } from "@/lib/actions/definitions";
import { inputJsonSchema } from "@/lib/actions/openapi";
import { API_BASE, methodOf } from "@/lib/actions/rest";

export const metadata: Metadata = { title: "Developers · KeyEscrow" };

/** Static docs page for the /api/v1 actions, generated from the same definitions as the API and the MCP tools. */
export default function DevelopersPage() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title="Developers">
        Every rental action is one definition that works as a REST endpoint, an MCP tool for AI agents and the web app&apos;s form
        validation. Reads return JSON. <code>prepare_*</code> actions return unsigned transactions, already simulated on the chain,
        for your own wallet to sign: KeyEscrow never holds your key.
      </PageTitle>

      <div className="mb-8 space-y-3 text-sm text-muted">
        <p>
          OpenAPI 3.1: <a className="underline" href={`${API_BASE}/openapi.json`}>{API_BASE}/openapi.json</a>. MCP: the same actions are tools
          on the KeyEscrow Inspector agent (<code>POST /mcp</code>, see docs/AGENT.md for the Claude config). Amounts: mUSDT has 6 decimals;
          inputs take human amounts like <code>&quot;441.18&quot;</code>, outputs give <code>units</code> (base units) and <code>display</code>.
        </p>
        <pre className="overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">BASE=http://127.0.0.1:3000   # this app</pre>
      </div>

      <div className="space-y-6">
        {ACTIONS.map((a) => (
          <ActionDoc key={a.name} action={a} />
        ))}
      </div>
    </section>
  );
}

function curl(a: Action): string {
  const path = `$BASE${API_BASE}/${a.name}`;
  if (methodOf(a) === "GET") {
    const qs = new URLSearchParams(Object.entries(a.example).map(([k, v]) => [k, String(v)])).toString();
    return `curl -s "${path}?${qs}"`;
  }
  return `curl -s -X POST "${path}" \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(a.example)}'`;
}

function ActionDoc({ action: a }: { action: Action }) {
  const schema = inputJsonSchema(a.input);
  const props = Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>);
  return (
    <article id={a.name} className="rounded-2xl border border-border bg-surface p-5" data-testid={`action-${a.name}`}>
      <h2 className="flex flex-wrap items-baseline gap-2 text-lg font-semibold">
        <code>{a.name}</code>
        <span className="text-sm font-normal text-subtle">
          {methodOf(a)} {API_BASE}/{a.name} · {a.title}
        </span>
      </h2>
      <p className="mt-2 text-sm text-muted">{toolDescription(a)}</p>
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-subtle">
          <tr>
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Type</th>
            <th className="py-1 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {props.map(([name, p]) => (
            <tr key={name} className="border-t border-border align-top">
              <td className="py-1 pr-3 font-mono">
                {name}
                {schema.required?.includes(name) ? "" : "?"}
              </td>
              <td className="py-1 pr-3">{typeLabel(p)}</td>
              <td className="py-1">
                {p.title ? <strong className="font-medium">{String(p.title)}. </strong> : null}
                {String(p.description ?? "")}
                {p.default !== undefined ? ` Default ${JSON.stringify(p.default)}.` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-muted p-3 text-xs">{curl(a)}</pre>
    </article>
  );
}

function typeLabel(p: Record<string, unknown>): string {
  const unit = p["x-unit"] ? ` (${String(p["x-unit"])})` : "";
  if (Array.isArray(p.enum)) return p.enum.join(" | ");
  if (Array.isArray(p.anyOf)) return (p.anyOf as Record<string, unknown>[]).map((x) => (x.const !== undefined ? String(x.const) : String(x.type))).join(" | ") + unit;
  if (Array.isArray(p.type)) return p.type.join(" | ") + unit;
  return String(p.type ?? "object") + unit;
}

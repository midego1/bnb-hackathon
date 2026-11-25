import type { Metadata } from "next";
import { CurlExample } from "@/components/CurlExample";
import { PageTitle } from "@/components/ui";
import { ACTIONS, toolDescription, type Action } from "@/lib/actions/definitions";
import { inputJsonSchema } from "@/lib/actions/openapi";
import { API_BASE, methodOf } from "@/lib/actions/rest";
import { getDictionary } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/t";
import { TOKEN } from "@/lib/contracts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary())("dev.metaTitle") };
}

/**
 * Static docs page for the /api/v1 actions, generated from the same definitions as the API and the MCP tools. The
 * page's own words follow the language; the action titles and descriptions stay English (they are the API's docs).
 */
export default async function DevelopersPage() {
  const t = await getDictionary();
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <PageTitle title={t.h("dev.title")}>
        {t("dev.lead.before")}
        <code>prepare_*</code>
        {t("dev.lead.after")}
      </PageTitle>

      <div className="mb-8 space-y-3 text-sm text-muted-foreground">
        <p>
          {t("dev.notes.openapi")}
          <a className="underline" href={`${API_BASE}/openapi.json`}>
            {API_BASE}/openapi.json
          </a>
          {t("dev.notes.mcp")}
          <code>POST /mcp</code>
          {t("dev.notes.config", { symbol: TOKEN.symbol, decimals: TOKEN.decimals })}
          <code>&quot;441.18&quot;</code>
          {t("dev.notes.outputs")}
          <code>units</code>
          {t("dev.notes.base")}
          <code>display</code>
          {t("dev.notes.end")}
        </p>
        <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs">BASE=http://127.0.0.1:3000   # this app</pre>
      </div>

      <div className="space-y-6">
        {ACTIONS.map((a) => (
          <ActionDoc key={a.name} action={a} t={t} />
        ))}
      </div>
    </section>
  );
}

function ActionDoc({ action: a, t }: { action: Action; t: T }) {
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
      <p className="mt-2 text-sm text-muted-foreground">{toolDescription(a)}</p>
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-subtle">
          <tr>
            <th className="py-1 pr-3 font-medium">{t("dev.field")}</th>
            <th className="py-1 pr-3 font-medium">{t("dev.type")}</th>
            <th className="py-1 font-medium">{t("dev.meaning")}</th>
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
                {p.default !== undefined ? t("dev.default", { value: JSON.stringify(p.default) }) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <CurlExample path={`$BASE${API_BASE}/${a.name}`} method={methodOf(a)} example={a.example} />
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

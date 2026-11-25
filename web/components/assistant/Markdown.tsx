"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { safeAppPath } from "@/lib/assistant/paths";

/**
 * Plain Markdown for Ask AI's answers: paragraphs, lists, headings (as bold lines), bold, italic, inline code, code
 * blocks and links. Never images, HTML or diagrams: everything is React text, so nothing in an answer can load a
 * resource or run code. An in-app link opens only an allowed page; an external link always shows its full URL.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-lg bg-surface-muted p-2 font-mono text-xs whitespace-pre-wrap">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const rows: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) rows.push(lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {rows.map((r, j) => (
            <li key={j}>{inline(r)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++]);
    const heading = /^#{1,6}\s+/.test(para[0]);
    blocks.push(
      <p key={key++} className={heading ? "font-semibold" : undefined}>
        {para.map((p, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(p.replace(/^#{1,6}\s+/, ""))}
          </span>
        ))}
      </p>,
    );
  }
  return <div className="space-y-2 text-sm leading-relaxed break-words">{blocks}</div>;
}

const TOKEN = /(`[^`]+`)|(!?\[[^\]]*\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={k++} className="rounded bg-surface-muted px-1 font-mono text-[0.85em] break-all">{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<LinkOut key={k++} raw={t} />);
    else if (m[3]) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (m[4]) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else if (m[5]) out.push(<External key={k++} href={t} />);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function LinkOut({ raw }: { raw: string }) {
  const m = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(raw)!;
  const [, bang, label, href] = m;
  // Images are never loaded: show their text.
  if (bang) return <span className="text-subtle">[image: {label || "no description"}]</span>;
  const internal = safeAppPath(href);
  if (internal) {
    return (
      <Link href={internal} className="underline underline-offset-2">
        {label || internal}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(href)) return <External href={href} label={label} />;
  return <span>{label}</span>;
}

/** External link: the full URL is always the visible text. */
function External({ href, label }: { href: string; label?: string }) {
  let url: string;
  try {
    url = new URL(href).toString();
  } catch {
    return <span>{href}</span>;
  }
  return (
    <>
      {label && label !== href ? `${label} ` : null}
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
        {url}
      </a>
    </>
  );
}

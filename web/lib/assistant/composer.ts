/**
 * The panel's composer helpers (client-safe, pure): suggestions that fit the page in view, slash commands, and the
 * follow-along guard. Suggestions come from the path only.
 */
import type { Lang } from "../i18n/locales";
import { leaseInView } from "./paths";

/** A prompt the empty chat offers. `fill` = put it in the field (it ends open) instead of sending it. */
export type Suggestion = { label: string; prompt: string; fill?: boolean };

const SIMPLE: Suggestion = { label: "Explain KeyScrow simply", prompt: "Explain KeyScrow simply" };
const FIND: Suggestion = { label: "Find my rental", prompt: "Find my rental" };
const DESK: Suggestion = { label: "Go to the dispute desk", prompt: "Go to the dispute desk" };

export function suggestionsFor(path: string): Suggestion[] {
  const p = path.split(/[?#]/)[0];
  if (leaseInView(p)) {
    return [
      { label: "Where is my deposit?", prompt: "Where is my deposit?" },
      { label: "What happens next?", prompt: "What happens next?" },
      { label: "Explain this rental", prompt: "Explain this rental" },
      { label: "Propose the AI split", prompt: "Propose the AI split" },
    ];
  }
  switch (p) {
    case "/app/subscriptions":
      return [
        { label: "How does a subscription work?", prompt: "How does a monthly scooter subscription work, and how do I cancel it?" },
        { label: "My subscriptions", prompt: "Find my rentals" },
        SIMPLE,
      ];
    case "/tenant":
      return [FIND, { label: "Where is my deposit?", prompt: "Where is my deposit?" }, SIMPLE];
    case "/landlord":
      return [
        { label: "Create a rental", prompt: "Create a rental for 3,400 baht a month with a 6,800 deposit for ", fill: true },
        { label: "Find my rentals", prompt: "Find my rentals" },
        SIMPLE,
      ];
    case "/arbiter":
      return [{ label: "What needs my decision?", prompt: "What needs my decision?" }, FIND, SIMPLE];
    case "/demo":
    case "/how-it-works":
      return [SIMPLE, DESK, FIND];
    default:
      return [SIMPLE, FIND, DESK];
  }
}

export type SlashCommand = { name: string; description: string; prompt?: string };

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/status", description: "Where is the deposit of this rental?", prompt: "Where is my deposit?" },
  { name: "/explain", description: "Explain this rental in plain words", prompt: "Explain this rental" },
  { name: "/next", description: "What happens next, and who must act?", prompt: "What happens next?" },
  { name: "/new", description: "Start a new chat" },
  { name: "/model", description: "Pick the model: /model sonnet or /model haiku" },
];

/**
 * Chinese for the suggestion labels and the command descriptions, keyed by the English. The prompts stay English:
 * they are what the assistant reads and what the mock engine matches. Phase 2 of i18n wires these into the panel.
 */
export const ZH_LABELS: Record<string, string> = {
  "Explain KeyScrow simply": "用简单的话解释 KeyScrow",
  "Find my rental": "找到我的租赁",
  "Go to the dispute desk": "前往争议处理台",
  "Where is my deposit?": "我的押金在哪里？",
  "What happens next?": "接下来会发生什么？",
  "Explain this rental": "解释这笔租赁",
  "Propose the AI split": "提出 AI 的分配方案",
  "Create a rental": "创建租赁",
  "Find my rentals": "找到我的租赁",
  "What needs my decision?": "哪些事需要我决定？",
  "Where is the deposit of this rental?": "这笔租赁的押金在哪里？",
  "Explain this rental in plain words": "用通俗的话解释这笔租赁",
  "What happens next, and who must act?": "接下来会发生什么，该谁操作？",
  "Start a new chat": "开始新对话",
  "Pick the model: /model sonnet or /model haiku": "选择模型：/model sonnet 或 /model haiku",
};

/** A suggestion label or command description in a language (English when there is no Chinese). */
export const composerLabel = (english: string, lang: Lang) => (lang === "zh" ? (ZH_LABELS[english] ?? english) : english);

/** Commands matching what is typed so far ("/" at the start of the field). */
export function matchCommands(text: string): SlashCommand[] {
  if (!text.startsWith("/") || /\s/.test(text.trim().slice(1)) || text.length > 12) return [];
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(text.trim().toLowerCase()));
}

/** What sending `text` means: a new chat, a prompt (commands expand, extra text is appended), or nothing. */
export function interpret(
  text: string,
): { kind: "new" } | { kind: "send"; prompt: string } | { kind: "model"; pick?: "sonnet" | "haiku"; unknown?: string } | { kind: "none" } {
  const t = text.trim();
  if (!t) return { kind: "none" };
  const m = /^(\/[a-z]+)\b\s*(.*)$/is.exec(t);
  if (m) {
    const cmd = SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase());
    if (cmd?.name === "/new") return { kind: "new" };
    if (cmd?.name === "/model") {
      // Only two models; anything else is not a pick (it is never sent anywhere).
      const arg = m[2].trim().toLowerCase();
      if (!arg) return { kind: "model" };
      if (/^(claude[- ])?sonnet( 5\.5| 5-5)?$/.test(arg) || arg === "claude-sonnet-5-5") return { kind: "model", pick: "sonnet" };
      if (/^(claude[- ])?haiku( 5\.5| 5-5)?$/.test(arg) || arg === "claude-haiku-5-5") return { kind: "model", pick: "haiku" };
      return { kind: "model", unknown: arg.slice(0, 40) };
    }
    if (cmd?.prompt) return { kind: "send", prompt: m[2] ? `${cmd.prompt} ${m[2]}` : cmd.prompt };
  }
  return { kind: "send", prompt: t };
}

/**
 * May the page move now? Never while the person types in a field outside the panel or has a dialog open.
 * `doc` is injectable for tests.
 */
export function canFollow(doc: Pick<Document, "activeElement" | "querySelector">, panel: Element | null): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (el && !(panel && panel.contains(el))) {
    const tag = el.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable) return false;
  }
  if (doc.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]')) return false;
  return true;
}

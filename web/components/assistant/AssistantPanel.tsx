"use client";

import { ArrowUp, Circle, Eye, EyeOff, Hand, History, PanelRightClose, PanelRightOpen, Sparkles, SquarePen, Square, X, Zap, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { interpret, matchCommands, suggestionsFor, type Suggestion as PromptSuggestion } from "@/lib/assistant/composer";
import { HistoryView, ReadOnlyChat } from "./AssistantHistory";
import { MIN_WIDTH } from "./constants";
import { ItemView } from "./ItemView";
import { MODEL_CHOICES, type ModelChoice, type useAssistantRun } from "./useAssistantRun";

type Assistant = ReturnType<typeof useAssistantRun>;

/** Above the panel (z-[65]): its menus and tooltips render in portals. */
const OVER_PANEL = "z-[80]";

/**
 * The Ask AI panel (Vercel AI Elements on shadcn/ui; loaded lazily by AssistantProvider): header (follow along, new chat, widen, close), status line, the conversation (steps, server cards,
 * approval cards, answers), suggestions for the page in view, and the composer with slash commands and Stop.
 */
export function AssistantPanel({
  ref,
  assistant,
  path,
  follow,
  onFollow,
  wide,
  onWidth,
  onWide,
  onClose,
}: {
  ref: Ref<HTMLElement>;
  assistant: Assistant;
  path: string;
  follow: boolean;
  onFollow: (v: boolean) => void;
  wide: boolean;
  onWidth: (w: number) => void;
  onWide: () => void;
  onClose: () => void;
}) {
  const { run, send, stop, newChat, approve, decline, history, continueChat, renameChat, deleteChat, setModel, freshen } = assistant;
  const [view, setView] = useState<"chat" | "history" | { read: string }>("chat");
  const [note, setNote] = useState<string | null>(null);
  const current = MODEL_CHOICES.find((m) => m.id === (run.model ?? run.defaultModel)) ?? MODEL_CHOICES[0];
  const modelLabel = run.mock ? "Demo model" : current.short;
  const pickModel = (id: ModelChoice) => {
    setModel(id);
    const m = MODEL_CHOICES.find((x) => x.id === id)!;
    setNote(run.mock ? `${m.label} picked for this chat. This server has no Anthropic key, so the demo model answers.` : `${m.label} answers in this chat.`);
  };
  // The one-screen stages (/demo, /how-it-works: `data-demo-stage`) keep their full width while they are pinned to the
  // window (the `stage` variant: desktop, at least 720px tall): there the panel floats bottom right instead of taking a
  // column, and app/globals.css does not pad the page. On a shorter window, or a tablet, the stage scrolls like any
  // page, so the panel takes its column and the page reflows beside it (a float would sit on the last rows for good).
  const floating = path === "/demo" || path === "/how-it-works";
  const [draft, setDraft] = useState("");
  const [cmdIndex, setCmdIndex] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const waiting = run.items.some((x) => x.kind === "approval" && (x.state === "waiting" || x.state === "signing"));
  const commands = matchCommands(draft);

  useEffect(() => {
    freshen();
    input.current?.focus();
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (text: string) => {
    const what = interpret(text);
    if (what.kind === "none" || run.busy) return;
    setDraft("");
    setNote(null);
    if (what.kind === "new") newChat();
    else if (what.kind === "model") {
      if (what.pick) pickModel(what.pick === "haiku" ? "claude-haiku-5-5" : "claude-sonnet-5-5");
      else if (what.unknown) setNote(`Ask AI only offers Claude Sonnet 5.5 and Claude Haiku 5.5 (/model sonnet, /model haiku).`);
      else setNote(`Model for this chat: ${run.mock ? "Demo model (no Anthropic key)" : current.label}. Pick one with /model sonnet or /model haiku.`);
    } else void send(what.prompt);
  };

  const pick = (s: PromptSuggestion) => {
    if (s.fill) {
      setDraft(s.prompt);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.setSelectionRange(s.prompt.length, s.prompt.length);
      });
    } else submit(s.prompt);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => onWidth(Math.min(Math.max(window.innerWidth - ev.clientX, MIN_WIDTH), Math.min(900, window.innerWidth * 0.7)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The panel is the only place with tooltips: their provider lives here, so Radix's popper stays out of every page
  // (the panel itself loads lazily, client only; see AssistantProvider).
  return (
    <TooltipProvider delayDuration={300}>
      <aside
        ref={ref}
        aria-label="Ask AI"
        data-testid="assistant-panel"
        data-assistant-state={run.state}
        data-floating={floating || undefined}
        className={`fixed inset-x-0 bottom-0 z-[65] flex h-[78dvh] flex-col rounded-t-2xl border border-border bg-background text-foreground shadow-2xl md:inset-x-auto md:top-0 md:right-0 md:h-auto md:w-[var(--assistant-width)] md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none ${
          floating
            ? "stage:top-auto stage:right-4 stage:bottom-4 stage:h-[min(58dvh,560px)] stage:w-[min(var(--assistant-width),420px)] stage:rounded-2xl stage:border-y stage:border-r stage:shadow-2xl"
            : ""
        }`}
      >
        <div
          onPointerDown={startResize}
          className={`absolute inset-y-0 left-0 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border-strong md:block ${floating ? "stage:hidden" : ""}`}
          aria-hidden
        />
        <header className="flex min-w-0 items-center gap-1.5 border-b border-border py-2 pr-2 pl-3">
          <Sparkles aria-hidden className="size-4 text-(--assistant-waiting)" />
          <h2 className="shrink-0 text-sm font-semibold whitespace-nowrap">Ask AI</h2>
          {run.mock && (
            <Badge
              variant="secondary"
              data-testid="assistant-mock-badge"
              title="No Anthropic key on this server: a scripted demo model answers."
              className="h-auto rounded-full px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border"
            >
              Demo model
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="assistant-model"
                data-model={run.model ?? run.defaultModel}
                title="Model for this chat"
                className="h-auto gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border"
              >
                {modelLabel}
                <ChevronDown aria-hidden className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={`${OVER_PANEL} w-56`} data-testid="assistant-model-menu">
              <DropdownMenuRadioGroup value={current.id} onValueChange={(v) => pickModel(v as ModelChoice)}>
                {MODEL_CHOICES.map((m) => (
                  <DropdownMenuRadioItem key={m.id} value={m.id} data-testid={`assistant-model-${m.word}`}>
                    {m.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {run.mock && <DropdownMenuLabel className="px-2 pt-1 pb-0.5 text-[11px] font-normal text-subtle">No Anthropic key on this server: the demo model answers.</DropdownMenuLabel>}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto flex items-center gap-0.5">
            <IconButton label="History" pressed={view !== "chat"} onClick={() => setView(view === "chat" ? "history" : "chat")} testId="assistant-history">
              <History />
            </IconButton>
            <IconButton label={follow ? "Follow along is on: the page goes to what Ask AI changes or opens" : "Follow along is off"} pressed={follow} onClick={() => onFollow(!follow)} testId="assistant-follow">
              {follow ? <Eye /> : <EyeOff />}
            </IconButton>
            <IconButton label="New chat" onClick={() => (newChat(), setView("chat"), setNote(null))} testId="assistant-new">
              <SquarePen />
            </IconButton>
            <IconButton label={wide ? "Narrow the panel" : "Widen to half the window"} onClick={onWide} testId="assistant-widen" className="hidden md:inline-flex">
              {wide ? <PanelRightClose /> : <PanelRightOpen />}
            </IconButton>
            <IconButton label="Close (Ctrl+J)" onClick={onClose} testId="assistant-close">
              <X />
            </IconButton>
          </span>
        </header>
        {run.state !== "idle" && (
          <div data-testid="assistant-status" data-state={run.state} className={run.state === "waiting" ? "bg-(--assistant-waiting-soft)" : ""}>
            <div data-assistant-bar="" />
            <p className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium" role="status">
              <span aria-hidden className="inline-flex text-(--assistant-tone)" {...(run.state === "waiting" ? {} : { "data-assistant-pulse": "" })}>
                {run.state === "waiting" ? <Hand className="size-3.5" /> : run.state === "changing" ? <Zap className="size-3.5" /> : <Circle className="size-2.5 fill-current" />}
              </span>
              {run.statusText || (run.state === "waiting" ? "Waiting for your approval" : "Working…")}
            </p>
          </div>
        )}

        {view === "history" ? (
          <HistoryView
            chats={history}
            openId={run.chatId}
            onOpen={(id) => setView(id === run.chatId ? "chat" : { read: id })}
            onRename={renameChat}
            onDelete={deleteChat}
          />
        ) : typeof view === "object" && history.find((c) => c.id === view.read) ? (
          <ReadOnlyChat
            chat={history.find((c) => c.id === view.read)!}
            onBack={() => setView("history")}
            onContinue={() => {
              continueChat(view.read);
              setView("chat");
            }}
          />
        ) : (
          <>
            <Conversation className="min-h-0" initial="instant" data-testid="assistant-log">
              <ConversationContent className="gap-3 px-3 py-3" scrollClassName="[scrollbar-gutter:stable]!">
                {run.items.length === 0 ? (
                  <div className="space-y-3 pt-6">
                    <p className="text-center text-sm text-muted-foreground">Ask about your rentals, or tell Ask AI what to do. Every change waits for your approval.</p>
                    <div className="flex flex-col gap-2" data-testid="assistant-suggestions">
                      {suggestionsFor(path).map((s) => (
                        <Suggestion
                          key={s.label}
                          suggestion={s.prompt}
                          onClick={() => pick(s)}
                          className="h-auto justify-start rounded-xl border-border bg-surface px-3 py-2 text-left text-sm font-normal whitespace-normal hover:border-border-hover hover:bg-surface dark:border-border dark:bg-surface dark:hover:bg-surface"
                        >
                          {s.label}
                          {s.fill ? "…" : ""}
                        </Suggestion>
                      ))}
                    </div>
                  </div>
                ) : (
                  run.items.map((item) => <ItemView key={item.id} item={item} onApprove={approve} onDecline={decline} />)
                )}
              </ConversationContent>
              <ConversationScrollButton aria-label="Scroll to the latest" className="bottom-3 size-8" />
            </Conversation>

            <form
              className="border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit(draft);
              }}
            >
              {note && (
                <p className="mb-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground" data-testid="assistant-note">
                  {note}
                </p>
              )}
              {commands.length > 0 && (
                // Driven by the textarea (arrows, Tab / Enter, Esc): focus stays in the composer.
                <Command
                  shouldFilter={false}
                  value={commands[Math.min(cmdIndex, commands.length - 1)].name}
                  onValueChange={(v) => setCmdIndex(Math.max(0, commands.findIndex((c) => c.name === v)))}
                  className="mb-2 h-auto rounded-lg! border border-border bg-surface p-0"
                >
                  <CommandList data-testid="assistant-commands">
                    <CommandGroup className="p-1">
                      {commands.map((c) => (
                        <CommandItem key={c.name} value={c.name} title={c.prompt ?? c.description} onSelect={() => submit(c.name)} className="gap-2 px-2 py-1.5">
                          <span className="font-mono">{c.name}</span>
                          <span className="text-muted-foreground">{c.description}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              )}
              <InputGroup className="h-auto rounded-xl border-border-strong bg-field px-1 has-[[data-slot=input-group-control]:focus-visible]:border-border-hover has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/15 dark:bg-field">
                <InputGroupTextarea
                  ref={input}
                  value={draft}
                  rows={1}
                  maxLength={2000}
                  data-testid="assistant-input"
                  aria-label="Message Ask AI"
                  placeholder={waiting ? "Approve or decline the change first" : "Ask, or tell Ask AI what to do… ( / for commands)"}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setCmdIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (commands.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                      e.preventDefault();
                      setCmdIndex((i) => (i + (e.key === "ArrowDown" ? 1 : commands.length - 1)) % commands.length);
                    } else if (commands.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && draft.trim() !== commands[cmdIndex].name))) {
                      e.preventDefault();
                      setDraft(commands[cmdIndex].name);
                    } else if (e.key === "Escape" && commands.length) {
                      setDraft("");
                    } else if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit(draft);
                    }
                  }}
                  className="max-h-32 min-h-9 px-1.5 py-2 text-sm placeholder:text-subtle md:text-sm"
                />
                <InputGroupAddon align="inline-end" className="self-end pb-1.5">
                  {run.busy || run.state === "waiting" ? (
                    <InputGroupButton type="button" variant="secondary" size="xs" onClick={stop} data-testid="assistant-stop" className="h-7 bg-surface-strong px-2.5 text-sm text-foreground" aria-label="Stop">
                      <Square aria-hidden className="size-3 fill-current" />
                      Stop
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton type="submit" variant="default" size="icon-xs" data-testid="assistant-send" disabled={!draft.trim()} className="size-7 rounded-lg disabled:opacity-40" aria-label="Send">
                      <ArrowUp aria-hidden className="size-4" />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
              <p className="mt-1.5 text-center text-[11px] text-subtle">Changes wait for your approval and your wallet&apos;s signature. Answers can be wrong.</p>
            </form>
          </>
        )}
      </aside>
    </TooltipProvider>
  );
}

/** A header button: shadcn ghost icon Button with a Tooltip (label = accessible name). */
function IconButton({ label, onClick, children, pressed, testId, className = "" }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; testId: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          data-testid={testId}
          className={`text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground ${className}`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className={`${OVER_PANEL} max-w-60`}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

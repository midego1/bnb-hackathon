"use client";

import { ArrowUp, Circle, Eye, EyeOff, Hand, History, Sparkles, SquarePen, Square, X, Zap, ChevronDown } from "lucide-react";
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
import { composerLabel, interpret, matchCommands, suggestionsFor, type Suggestion as PromptSuggestion } from "@/lib/assistant/composer";
import { useT } from "@/lib/i18n/client";
import { HistoryView, ReadOnlyChat } from "./AssistantHistory";
import { ChatItems } from "./ItemView";
import { MODEL_CHOICES, type ModelChoice, type useAssistantRun } from "./useAssistantRun";

type Assistant = ReturnType<typeof useAssistantRun>;

/** Above the window (z-[75]): its menus and tooltips render in portals. */
const OVER_PANEL = "z-[80]";

/**
 * The Ask AI chat window (Vercel AI Elements on shadcn/ui; loaded lazily by AssistantProvider), floating above the
 * bubble bottom right, a full-height sheet on phones: header (model, history, follow along, new chat, close), status
 * line, the conversation as chat bubbles (steps, server cards and approval cards inside the assistant's), suggestions
 * for the page in view, and the composer with slash commands and Stop. Stays mounted once opened: closed, it is
 * invisible and inert, so it can scale and fade from the bubble (no motion with prefers-reduced-motion).
 */
export function AssistantPanel({
  ref,
  open,
  small,
  assistant,
  path,
  follow,
  onFollow,
  onClose,
}: {
  ref: Ref<HTMLElement>;
  open: boolean;
  /** The one-screen stages: the small bubble, a shorter window. */
  small: boolean;
  assistant: Assistant;
  path: string;
  follow: boolean;
  onFollow: (v: boolean) => void;
  onClose: () => void;
}) {
  const { run, send, stop, newChat, approve, decline, history, continueChat, renameChat, deleteChat, setModel, freshen } = assistant;
  const t = useT();
  const [view, setView] = useState<"chat" | "history" | { read: string }>("chat");
  const [note, setNote] = useState<string | null>(null);
  const current = MODEL_CHOICES.find((m) => m.id === (run.model ?? run.defaultModel)) ?? MODEL_CHOICES[0];
  const modelLabel = run.mock ? t("ai.demoModel") : current.short;
  const pickModel = (id: ModelChoice) => {
    setModel(id);
    const m = MODEL_CHOICES.find((x) => x.id === id)!;
    setNote(t(run.mock ? "ai.notePicked" : "ai.noteAnswers", { model: m.label }));
  };
  const [draft, setDraft] = useState("");
  const [cmdIndex, setCmdIndex] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const waiting = run.items.some((x) => x.kind === "approval" && (x.state === "waiting" || x.state === "signing"));
  const commands = matchCommands(draft);

  useEffect(() => {
    if (!open) return;
    freshen();
    input.current?.focus();
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (text: string) => {
    const what = interpret(text);
    if (what.kind === "none" || run.busy) return;
    setDraft("");
    setNote(null);
    if (what.kind === "new") newChat();
    else if (what.kind === "model") {
      if (what.pick) pickModel(what.pick === "haiku" ? "claude-haiku-5-5" : "claude-sonnet-5-5");
      else if (what.unknown) setNote(t("ai.noteOnly"));
      else setNote(t("ai.noteModel", { model: run.mock ? t("ai.demoModelNoKey") : current.label }));
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

  // The panel is the only place with tooltips: their provider lives here, so Radix's popper stays out of every page
  // (the panel itself loads lazily, client only; see AssistantProvider).
  return (
    <TooltipProvider delayDuration={300}>
      <aside
        ref={ref}
        id="assistant-window"
        aria-label={t("ai.name")}
        inert={!open}
        data-testid="assistant-panel"
        data-open={open || undefined}
        data-assistant-state={run.state}
        className={`fixed inset-0 z-[75] flex origin-bottom-right pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:p-0 flex-col overflow-hidden bg-background text-foreground transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none sm:inset-auto sm:right-4 sm:w-[400px] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl sm:border sm:border-border sm:shadow-xl ${
          small ? "sm:bottom-14 sm:h-[min(560px,62dvh)]" : "sm:bottom-[5.5rem] sm:h-[min(640px,80vh,calc(100dvh-7rem))]"
        } ${open ? "visible scale-100 opacity-100" : "pointer-events-none invisible translate-y-2 scale-90 opacity-0"}`}
      >
        <header className="flex min-w-0 items-center gap-1.5 border-b border-border py-2 pr-2 pl-3">
          <Sparkles aria-hidden className="size-4 text-(--assistant-waiting)" />
          <h2 className="shrink-0 text-sm font-semibold whitespace-nowrap">{t("ai.name")}</h2>
          {run.mock && (
            <Badge
              variant="secondary"
              data-testid="assistant-mock-badge"
              title={t("ai.mockTitle")}
              className="h-auto rounded-full px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border"
            >
              {t("ai.demoModel")}
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
                title={t("ai.modelTitle")}
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
              {run.mock && <DropdownMenuLabel className="px-2 pt-1 pb-0.5 text-[11px] font-normal text-subtle">{t("ai.mockMenu")}</DropdownMenuLabel>}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-auto flex items-center gap-0.5">
            <IconButton label={t("ai.history")} pressed={view !== "chat"} onClick={() => setView(view === "chat" ? "history" : "chat")} testId="assistant-history">
              <History />
            </IconButton>
            <IconButton label={follow ? t("ai.followOn") : t("ai.followOff")} pressed={follow} onClick={() => onFollow(!follow)} testId="assistant-follow">
              {follow ? <Eye /> : <EyeOff />}
            </IconButton>
            <IconButton label={t("ai.newChat")} onClick={() => (newChat(), setView("chat"), setNote(null))} testId="assistant-new">
              <SquarePen />
            </IconButton>
            <IconButton label={t("ai.close")} onClick={onClose} testId="assistant-close">
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
              {run.statusText || (run.state === "waiting" ? t("ai.waitingApproval") : t("ai.working"))}
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
                    <p className="text-center text-sm text-muted-foreground">{t("ai.empty")}</p>
                    <div className="flex flex-col gap-2" data-testid="assistant-suggestions">
                      {suggestionsFor(path).map((s) => (
                        <Suggestion
                          key={s.label}
                          suggestion={s.prompt}
                          onClick={() => pick(s)}
                          className="h-auto justify-start rounded-xl border-border bg-surface px-3 py-2 text-left text-sm font-normal whitespace-normal hover:border-border-hover hover:bg-surface dark:border-border dark:bg-surface dark:hover:bg-surface"
                        >
                          {composerLabel(s.label, t.lang)}
                          {s.fill ? "…" : ""}
                        </Suggestion>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ChatItems items={run.items} onApprove={approve} onDecline={decline} />
                )}
              </ConversationContent>
              <ConversationScrollButton aria-label={t("ai.scrollLatest")} className="bottom-3 size-8" />
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
                        <CommandItem key={c.name} value={c.name} title={c.prompt ?? composerLabel(c.description, t.lang)} onSelect={() => submit(c.name)} className="gap-2 px-2 py-1.5">
                          <span className="font-mono">{c.name}</span>
                          <span className="text-muted-foreground">{composerLabel(c.description, t.lang)}</span>
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
                  aria-label={t("ai.inputLabel")}
                  placeholder={waiting ? t("ai.placeholderWaiting") : t("ai.placeholder")}
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
                    <InputGroupButton type="button" variant="secondary" size="xs" onClick={stop} data-testid="assistant-stop" className="h-7 bg-surface-strong px-2.5 text-sm text-foreground" aria-label={t("ai.stop")}>
                      <Square aria-hidden className="size-3 fill-current" />
                      {t("ai.stop")}
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton type="submit" variant="default" size="icon-xs" data-testid="assistant-send" disabled={!draft.trim()} className="size-7 rounded-lg disabled:opacity-40" aria-label={t("ai.send")}>
                      <ArrowUp aria-hidden className="size-4" />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
              <p className="mt-1.5 text-center text-[11px] text-subtle">{t("ai.footer")}</p>
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

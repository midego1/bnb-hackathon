"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canFollow } from "@/lib/assistant/composer";
import { safeAppPath } from "@/lib/assistant/paths";
import dynamic from "next/dynamic";
import { AssistantBubble } from "./AssistantBubble";
import { AssistantEdge } from "./AssistantEdge";
import { useAssistantRun } from "./useAssistantRun";

type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };
const AssistantContext = createContext<Ctx | null>(null);

/** The chat window loads on first open, not with every page. */
const AssistantPanel = dynamic(() => import("./AssistantPanel").then((m) => m.AssistantPanel), { ssr: false });

export function useAssistantPanel(): Ctx {
  const c = useContext(AssistantContext);
  if (!c) throw new Error("useAssistantPanel outside AssistantProvider");
  return c;
}

const FOLLOW_KEY = "keyescrow.assistant.follow";
/** The one-screen stages: a small bubble, clear of their controls (see AssistantBubble). */
const STAGES = ["/demo", "/how-it-works", "/pitch"];

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* private mode: the setting lasts for this page only */
  }
}

/**
 * Ask AI: the launcher bubble (bottom right), the floating chat window above it (a full-height sheet on phones), the
 * window-edge light and Cmd+J / Ctrl+J. Everything is fixed on top of the page, which never reflows;
 * `html[data-assistant-open]` marks the open state. Only the app shell mounts this provider, so the landing page and
 * the live judge demo (/stage, /r) have no bubble.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return (
    <AssistantContext.Provider value={ctx}>
      {children}
      {/* The path is request-time data: stream the assistant in (no prerender block). */}
      <Suspense fallback={null}>
        <AssistantRoot open={open} setOpen={setOpen} />
      </Suspense>
    </AssistantContext.Provider>
  );
}

function AssistantRoot({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const [follow, setFollowState] = useState(true);
  // Mounted from the first open on, so it can animate closed and keeps its view and draft between opens.
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const panelRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Restore the saved setting after hydration (the server render uses the default).
    const f = readStorage(FOLLOW_KEY);
    queueMicrotask(() => {
      if (f === "0") setFollowState(false);
    });
  }, []);

  const setFollow = useCallback((v: boolean) => {
    setFollowState(v);
    writeStorage(FOLLOW_KEY, v ? "1" : "0");
  }, []);

  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  /** Follow along: move the page to what Ask AI changed or opened, unless off or the person is busy. */
  const onNavigate = useCallback(
    (path: string) => {
      const safe = safeAppPath(path);
      if (!safe || !followRef.current) return false;
      if (!canFollow(document, panelRef.current)) return false;
      if (window.location.pathname !== safe) router.push(safe);
      return true;
    },
    [router],
  );

  const assistant = useAssistantRun({ path: pathname, onNavigate });

  useEffect(() => {
    const root = document.documentElement;
    if (open) {
      root.setAttribute("data-assistant-open", "");
      queueMicrotask(() => setLoaded(true));
    } else {
      root.removeAttribute("data-assistant-open");
      // Closing with focus inside the (now inert) window: give it back to the bubble.
      if (panelRef.current?.contains(document.activeElement)) bubbleRef.current?.focus();
    }
  }, [open]);

  // The bubble's dot: a change waiting for approval, or a reply that came in while the window was closed.
  const state = assistant.run.state;
  const count = assistant.run.items.length;
  const [seen, setSeen] = useState(count);
  useEffect(() => {
    if (open || count < seen) queueMicrotask(() => setSeen(count));
  }, [open, count, seen]);
  const dot = state === "waiting" ? "waiting" : !open && count > seen ? "unread" : null;

  // "(Approval needed)" in the tab title while a change waits.
  useEffect(() => {
    if (state !== "waiting") return;
    const prefix = "(Approval needed) ";
    const apply = () => {
      if (!document.title.startsWith(prefix)) document.title = prefix + document.title;
    };
    apply();
    const titleEl = document.querySelector("title");
    const obs = titleEl ? new MutationObserver(apply) : null;
    if (titleEl) obs!.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => {
      obs?.disconnect();
      if (document.title.startsWith(prefix)) document.title = document.title.slice(prefix.length);
    };
  }, [state, pathname]);

  const small = STAGES.includes(pathname);
  return (
    <>
      <AssistantEdge state={state} />
      {(open || loaded) && (
        <AssistantPanel
          ref={panelRef}
          open={open}
          small={small}
          assistant={assistant}
          path={pathname}
          follow={follow}
          onFollow={setFollow}
          onClose={() => setOpen(false)}
        />
      )}
      <AssistantBubble ref={bubbleRef} open={open} onToggle={() => setOpen(!open)} dot={dot} small={small} />
    </>
  );
}

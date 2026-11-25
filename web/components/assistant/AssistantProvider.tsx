"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { canFollow } from "@/lib/assistant/composer";
import { safeAppPath } from "@/lib/assistant/paths";
import { AssistantEdge } from "./AssistantEdge";
import dynamic from "next/dynamic";
import { MIN_WIDTH } from "./constants";
import { useAssistantRun } from "./useAssistantRun";

type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };
const AssistantContext = createContext<Ctx | null>(null);

/** The panel UI loads on first open, not with every page. */
const AssistantPanel = dynamic(() => import("./AssistantPanel").then((m) => m.AssistantPanel), { ssr: false });

export function useAssistantPanel(): Ctx {
  const c = useContext(AssistantContext);
  if (!c) throw new Error("useAssistantPanel outside AssistantProvider");
  return c;
}

const FOLLOW_KEY = "keyescrow.assistant.follow";
const WIDTH_KEY = "keyescrow.assistant.width";
const DEFAULT_WIDTH = 400;

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
 * Ask AI: the panel (right column on desktop, bottom sheet on phones), the window-edge light and Cmd+J / Ctrl+J.
 * Renders no wrapper element, so page layout (the one-screen /demo) is untouched; while open on desktop the page gets
 * room on the right through `html[data-assistant-open]` (app/globals.css).
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
  const [width, setWidthState] = useState(DEFAULT_WIDTH);
  const [wide, setWide] = useState(false);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Restore saved settings after hydration (the server render uses the defaults).
    const f = readStorage(FOLLOW_KEY);
    const w = Number(readStorage(WIDTH_KEY));
    queueMicrotask(() => {
      if (f === "0") setFollowState(false);
      if (Number.isFinite(w) && w >= MIN_WIDTH) setWidthState(w);
    });
  }, []);

  const setFollow = useCallback((v: boolean) => {
    setFollowState(v);
    writeStorage(FOLLOW_KEY, v ? "1" : "0");
  }, []);
  const setWidth = useCallback((w: number) => {
    setWidthState(w);
    setWide(false);
    writeStorage(WIDTH_KEY, String(Math.round(w)));
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

  // Room for the panel on desktop, and the width it takes.
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute("data-assistant-open", "");
    else root.removeAttribute("data-assistant-open");
    root.style.setProperty("--assistant-width", wide ? "50vw" : `${width}px`);
  }, [open, width, wide]);

  // "(Approval needed)" in the tab title while a change waits.
  const state = assistant.run.state;
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

  return (
    <>
      <AssistantEdge state={state} />
      {open && (
        <AssistantPanel
          ref={panelRef}
          assistant={assistant}
          path={pathname}
          follow={follow}
          onFollow={setFollow}
          wide={wide}
          onWidth={setWidth}
          onWide={() => setWide((w) => !w)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

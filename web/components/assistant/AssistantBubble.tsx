"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { FOLD_MEDIA } from "@/lib/fold";
import { useT } from "@/lib/i18n/client";

/**
 * The Ask AI launcher: a round bubble fixed bottom right (the only entry point besides Cmd+J / Ctrl+J). A dot shows
 * a change waiting for approval (violet) or a reply that arrived while the window was closed. `small` on the
 * one-screen stages (/demo, /how-it-works, /pitch), so it stays clear of their controls. Phones: 48 px, above the home
 * bar (safe area), on every page; the page column keeps that much room at its end (components/shell/AppShell.tsx) and
 * the bubble steps aside while the window (a full-height sheet there) is open. While a button, link or field is under
 * its spot (a primary action at the bottom of the screen), it tucks into the right-hand page gutter as a small tab,
 * still tappable and still showing its dot, and comes back when the spot is free.
 */
export function AssistantBubble({
  ref,
  open,
  onToggle,
  dot,
  small,
}: {
  ref: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onToggle: () => void;
  dot: "waiting" | "unread" | null;
  small: boolean;
}) {
  const t = useT();
  const tucked = useTucked(ref);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      aria-label={t("ai.name")}
      aria-expanded={open}
      aria-controls="assistant-window"
      title={t("ai.entryTitle")}
      data-testid="assistant-bubble"
      data-dot={dot ?? undefined}
      data-tucked={tucked || undefined}
      className={`fixed z-[75] inline-flex items-center justify-center rounded-full border border-border bg-background text-foreground shadow-xl transition hover:scale-105 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:scale-100 ${
        small ? "right-1 bottom-1 size-8" : "right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] size-14"
      } max-sm:right-3 max-sm:bottom-[calc(0.75rem+env(safe-area-inset-bottom))] max-sm:size-12 ${open ? "max-sm:hidden" : ""} ${tucked ? "max-sm:translate-x-[46px] fold:translate-x-[56px]" : ""}`}
    >
      {open ? (
        <ChevronDown aria-hidden className={small ? "size-4 max-sm:size-5" : "size-6 max-sm:size-5"} />
      ) : (
        <Sparkles aria-hidden className={`text-(--assistant-waiting) ${small ? "size-4 max-sm:size-5" : "size-6 max-sm:size-5"}`} />
      )}
      {dot && !open && (
        <span
          data-testid="assistant-bubble-dot"
          className={`absolute top-0 right-0 rounded-full ring-2 ring-background ${small ? "size-2.5 max-sm:size-3" : "size-3.5 max-sm:size-3"} ${dot === "waiting" ? "bg-(--assistant-waiting)" : "bg-primary"}`}
        >
          <span className="sr-only">{t(dot === "waiting" ? "ai.waitingApproval" : "ai.unread")}</span>
        </span>
      )}
    </button>
  );
}

/** Phones and unfolded foldables: is a button, link or field under the bubble's own spot (its layout box, not the tucked one)? */
function useTucked(ref: RefObject<HTMLButtonElement | null>) {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const phone = window.matchMedia(`(max-width: 639.98px), ${FOLD_MEDIA}`);
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // offsetLeft/Top of a fixed element: its place in the viewport, without the tuck transform. The bubble is round:
        // a control is under it when the control's nearest point is inside the circle.
        const r = el.offsetWidth / 2;
        const [cx, cy] = [el.offsetLeft + r, el.offsetTop + r];
        const under = (c: Element) => {
          if (el.contains(c) || c.closest("#assistant-window")) return false;
          const b = c.getBoundingClientRect();
          const dx = Math.max(b.left - cx, 0, cx - b.right);
          const dy = Math.max(b.top - cy, 0, cy - b.bottom);
          return b.width > 1 && b.height > 1 && dx * dx + dy * dy < r * r;
        };
        setTucked(phone.matches && [...document.querySelectorAll("a[href], button, input, select, textarea, [role='button']")].some(under));
      });
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    // Data that loads later puts new buttons under the bubble without a scroll: re-check (once per frame).
    const changed = new MutationObserver(check);
    changed.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      changed.disconnect();
    };
  }, [ref]);
  return tucked;
}

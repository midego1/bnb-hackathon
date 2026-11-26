import { useId, type ReactNode, type Ref } from "react";
import { LogoMark } from "@/components/LogoMark";
import { ArrowIcon, PassportIcon, PersonIcon, ShopIcon } from "./icons";
import { LED_COLS, LED_ROWS, ledDots } from "./led";
import "./board.css";

/**
 * The LED money board: three stations (renter, this rental's escrow, owner) and the two coin tracks between them.
 * Shared by the landing page's example rental (MoneyFlow.tsx) and /duo's live rental (components/stage/DuoView.tsx).
 */

/**
 * One state of the board: what is at each station right now (so the three always add up to what the renter started
 * with, less the fee) and which way the money is moving.
 */
export type FlowFrame = {
  renter: string;
  escrow: string;
  owner: string;
  /** Renter and escrow: "fwd" pays in, "rev" refunds. */
  a?: { dir: "fwd" | "rev"; tag: string };
  /** Escrow to owner. */
  b?: { tag: string };
  fee?: boolean;
};

/**
 * An amount on an LED panel whose dots are BNB coins, as in the artwork (docs/marketing/coins.py): a disc in the
 * station's colour with the official BNB Chain logomark on it. Decorative: the caller prints the same amount as text for
 * screen readers.
 */
function DotNum({ text }: { text: string }) {
  // One coin per 1 x 1 cell; its own id because the coin takes the colour of this panel's station.
  const coin = useId();
  return (
    <svg viewBox={`0 0 ${LED_COLS} ${LED_ROWS}`} className="mk-dotnum" aria-hidden>
      <defs>
        <pattern id={coin} width="1" height="1" patternUnits="userSpaceOnUse">
          <circle cx=".5" cy=".5" r=".45" className="mk-coin" />
          {/* The official file, unchanged: its mark fills a circle of radius .42 around the cell's centre. */}
          <image href="/marketing/bnb-symbol.svg" x=".08" y=".08" width=".84" height=".84" />
        </pattern>
      </defs>
      <rect width={LED_COLS} height={LED_ROWS} fill={`url(#${coin})`} className="mk-dot-off" />
      {/* Keyed by the amount, so the panel "refreshes" (CSS) whenever it changes. Each lit dot is its cell, filled with a coin. */}
      <path key={text} d={ledDots(text).map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")} fill={`url(#${coin})`} className="mk-dot-on" />
    </svg>
  );
}

function Station(p: { tone: "renter" | "escrow" | "owner"; icon: ReactNode; who: string; sub?: string; value: string; label: string; note?: ReactNode; noteOn?: boolean }) {
  return (
    // A station with nothing in it goes dim: only the stations that hold money glow.
    <div className={`mk-station mk-station-${p.tone}`} data-empty={/[1-9]/.test(p.value) ? undefined : ""}>
      <p className="mk-station-who">
        {p.icon}
        <span>
          {p.who}
          {p.sub && <small>{p.sub}</small>}
        </span>
      </p>
      <div className="mk-station-read">
        <DotNum text={p.value} />
        <p>
          <span className="sr-only">{p.value} </span>
          {p.label}
        </p>
      </div>
      {p.note && <p className={`mk-station-note ${p.noteOn === false ? "invisible" : ""}`}>{p.note}</p>}
    </div>
  );
}

/** A row of LED dots between two stations; lit dots chase in the direction the money moves (CSS), under an amount tag. */
function Track({ dir, tag }: { dir?: "fwd" | "rev"; tag?: string }) {
  return (
    <div className="mk-track" data-flow={dir ?? "off"} aria-hidden>
      {tag && (
        <span className="mk-track-tag">
          {tag}
          <ArrowIcon />
        </span>
      )}
    </div>
  );
}

/** What the board's words say; the landing page and /duo each bring their own (in the active language). */
export type BoardLabels = { label: string; renter: string; escrow: string; escrowSub: string; owner: string; renterHas: string; held: string; ownerHas: string; passport: string; fee: string };

/** One frame of the board. `trackKey` re-mounts the tracks when the money moves again, so their animation restarts. */
export function MoneyBoard({ labels, frame: f, trackKey, ref }: { labels: BoardLabels; frame: FlowFrame; trackKey: string; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="mk-board" role="group" aria-label={labels.label}>
      <Station
        tone="renter"
        icon={<PersonIcon />}
        who={labels.renter}
        value={f.renter}
        label={labels.renterHas}
        note={
          <>
            <PassportIcon />
            {labels.passport}
          </>
        }
      />
      <Track key={`a${trackKey}`} dir={f.a?.dir} tag={f.a?.tag} />
      <Station tone="escrow" icon={<LogoMark className="h-7 w-7 shrink-0" />} who={labels.escrow} sub={labels.escrowSub} value={f.escrow} label={labels.held} />
      <Track key={`b${trackKey}`} dir={f.b && "fwd"} tag={f.b?.tag} />
      <Station tone="owner" icon={<ShopIcon />} who={labels.owner} value={f.owner} label={labels.ownerHas} note={labels.fee} noteOn={!!f.fee} />
    </div>
  );
}

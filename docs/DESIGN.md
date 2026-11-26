# Design notes

Two surfaces share one set of colour tokens (`web/app/globals.css`, light and dark).

## The app (`/app`, the role pages, `/demo`, `/how-it-works`)

A working tool: slate neutrals, the amber of the logo for emphasis, status colours (success, warning, danger, info) for
state only. Left sidebar shell (`web/components/shell`). Geist for text, Geist Mono for addresses and amounts.

## The marketing page (`/`)

`web/app/(marketing)`, `web/components/marketing`. A server component outside the app shell: no wallet
providers. Its client code is the theme button, the language switch, Next's links and one island of its own, the money
board (`MoneyFlow.tsx`). It renders per request because its words follow the language cookie (`web/lib/i18n`).

- **Idea.** The page is the street the product lives on: the first screen is an LED signboard picture of a Thai soi at
  night with a scooter rental shop, and the promise is written over it like a shop sign. The street comes back once,
  dimmer, behind the closing ask.
- **Story, top to bottom.** The problem and the promise (hero, then "today" against "with KeyEscrow" as two LED
  tiles), proof that it is real (four linked claims under the hero, then the contract table), how the money moves
  (the board), who decides (AI inspection, deadlines), what a shop gets (subscriptions, Fleet Vault, dispute desk),
  the agent surface, the fee, the roadmap (each phase says "Live on testnet" or "Planned"), and the three ways in.
- **Three ways in.** "Play the live demo" (amber), "Rent our Mystery Box" and "Open the app" (outline), in the hero
  and again in the closing; "How it works" is a text link. On a phone the first is full width and the other two share
  a row, and the header carries EN / 中文 instead of "Open the app".
- **The money board.** The page's one authored moment: three LED panels (renter, escrow, owner) set in a 5x9 dot
  font (`led.ts`), two tracks of dots between them, and the four steps as buttons. Each panel shows what is at that
  station now, so the amounts move from left to right and back; a panel holding nothing goes dim. Lit dots chase
  along a track in the direction the money moves, under a tag with the amount. It plays once when it scrolls into
  view and every step and both endings (no new damage, new damage) can be pressed. On phones the board stands
  upright and fits one screen with its controls.
- **Colour.** Three kinds of band. *Night* (`.mk-night`, indigo `#0d0b2a`, the same in both themes: it is a picture of
  night) for the hero, the money board, the deadlines, the agents section, the closing and the footer. *Amber*
  (`.mk-amber`, `#fbbf24`) once, for the fee. Everything else on the theme tokens. The night and amber bands re-point
  the tokens, so the same utilities (`text-muted`, `border-border`, ...) work inside them. Teal, pink and amber name
  the three stations of the board (renter, owner, escrow), as the street has them; the escrow panel wears the dotted
  pink frame of the artwork's shop sign.
- **Type.** Kanit, the Thai signage grotesque, self-hosted: 800 for the hero and section headings, 500 for
  sub-headings and buttons. Geist for reading, about 70 characters a line. Geist Mono only for code, addresses and
  money. Kanit ships as a Latin subset: Chinese headlines and the baht sign fall back to the system face.
- **Shapes.** Pill buttons in three fills (amber, outline, ink). Hairline rules instead of cards. Authored SVG icons on
  one 24-unit grid with 2-unit round strokes.
- **Motion.** The street moves (a slow sideways drift away from the headline, the sign and doorway breathing like
  neon, scroll parallax where the browser supports scroll-driven animation) and the money board plays. All of it is
  off under `prefers-reduced-motion`: the street stands still, the board never starts on its own, its active track is
  simply lit, and every state is still one press away.
- **Layout.** From 1280 px the headline lies over the left of the picture, behind a scrim. Below that the headline
  sits in the sky and the street follows in the normal flow, so copy never lands on the lit shop; phones get an upright
  crop of the scene.
- **Honesty rules.** Every fact on the page comes from `web/lib/marketing.ts`, and `web/tests/marketing.test.ts`
  compares those with the deployment files, the contracts, the README and [BUSINESS.md](BUSINESS.md). Say "testnet"
  wherever it is testnet and "planned" wherever it is planned. Example amounts are labelled as the worked example
  from BUSINESS.md.

Artwork pipeline: [marketing/README.md](marketing/README.md).

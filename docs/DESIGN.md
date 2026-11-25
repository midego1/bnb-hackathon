# Design notes

Two surfaces share one set of colour tokens (`web/app/globals.css`, light and dark).

## The app (`/app`, the role pages, `/demo`, `/how-it-works`)

A working tool: slate neutrals, the amber of the logo for emphasis, status colours (success, warning, danger, info) for
state only. Left sidebar shell (`web/components/shell`). Geist for text, Geist Mono for addresses and amounts.

## The marketing page (`/`)

`web/app/(marketing)`, `web/components/marketing`. A static server component outside the app shell: no wallet
providers, and its only client code is the theme button and Next's links.

- **Idea.** The page is the street the product lives on: the first screen is an LED signboard picture of a Thai soi at
  night with a scooter rental shop, and the promise is written over it like a shop sign.
- **Colour.** Three kinds of band. *Night* (`.mk-night`, indigo `#0d0b2a`, the same in both themes: it is a picture of
  night) for the hero, the deadlines, the agents section and the footer. *Amber* (`.mk-amber`, `#fbbf24`) once, for the
  fee. Everything else on the theme tokens. The night and amber bands re-point the tokens, so the same utilities
  (`text-muted`, `border-border`, ...) work inside them. Teal and pink appear only where the street has them (the
  deadline lanes, the vault split).
- **Type.** Kanit, the Thai signage grotesque, self-hosted: 800 for the hero and section headings, 500 for
  sub-headings and buttons. Geist for reading. Geist Mono only for code, addresses and money.
- **Shapes.** Pill buttons in three fills (amber, outline, ink). Hairline rules instead of cards. Authored SVG icons on
  one 24-unit grid with 2-unit round strokes.
- **Motion.** Only the street moves: a slow sideways drift away from the headline, the sign and doorway breathing like
  neon, and scroll parallax where the browser supports scroll-driven animation. All CSS, all off under
  `prefers-reduced-motion`.
- **Layout.** From 1280 px the headline lies over the left of the picture, behind a scrim. Below that the headline
  sits in the sky and the street follows in the normal flow, so copy never lands on the lit shop; phones get an upright
  crop of the scene.
- **Honesty rules.** Every fact on the page comes from `web/lib/marketing.ts`, and `web/tests/marketing.test.ts`
  compares those with the deployment files and the contracts. Say "testnet" wherever it is testnet. Example amounts
  are labelled as the worked example from [BUSINESS.md](BUSINESS.md).

Artwork pipeline: [marketing/README.md](marketing/README.md).

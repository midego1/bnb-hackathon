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
- **Story, top to bottom.** Find a scooter (the search, then the demo listings it filters), why the deposit is safe
  ("today" against "with KeyScrow" as two LED tiles, the money board, AI inspection, deadlines), listing your own
  scooter (subscriptions, Fleet Vault, dispute desk), proof that it is real (four linked claims, then the contract
  table), the agent surface, the fee, the roadmap (each phase says "Live on testnet" or "Planned"), and the three
  ways in.
- **The search.** The hero's main action, in the manner of a rental marketplace: one light rounded bar on the night
  artwork with Where (the four cities of the demo listings), When and How long, and an amber Search button. It is a
  plain GET form to `/#listings` inside a small island (`Search.tsx`), so the address carries the search and the
  server filters the grid. On phones the bar is one pill that sums up the choice and opens the fields when tapped.
- **The listing grid.** Cards without ratings or reviews: a real photo of the model (Wikimedia Commons, credited on
  `/credits`; the LED look stays for the hero and the marketing tiles), name, area, the price for the chosen length with the other price beside it, the
  deposit, and a "Deposit protected by escrow" badge. One column on phones, two from 640 px, three from 1024 px. Each
  card is one link to the listing's page in the app, where "Rent it" starts a real testnet rental. Every card and the
  section say "demo listing".
- **Three ways in.** "Play the live demo", "Rent our Mystery Box" and "Open the app": smaller outline pills under the
  search in the hero, full-size buttons in the closing; "How it works" is a text link. On phones the header carries
  EN / 中文 instead of "Open the app".
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
- **Coins.** Every dot of the LED pictures (the street, the two tiles, the listing pictures) and of the money board is a
  tiny BNB coin: a disc with the official BNB Chain logomark on it, as large as the coin allows
  (`docs/marketing/coins.py`; the board draws the same coin as SVG from the official file). Lit marks are the official
  yellow `#F0B90B` and dim ones darker; the disc follows its spot in the picture (the night stays indigo, pale light
  turns gold, the red scooter and the teal awning keep their colours), so the street still reads. Now and then a soft
  band of light sweeps across the street's coins, and across a listing's picture on hover: CSS only, an overlay that
  leaves the gaps dark, and never under `prefers-reduced-motion`. The logo's use needs BNB Chain's approval (see
  [marketing/README.md](marketing/README.md#the-bnb-mark)).
- **Type.** Kanit, the Thai signage grotesque, self-hosted: 800 for the hero and section headings, 500 for
  sub-headings and buttons. Geist for reading, about 70 characters a line. Geist Mono only for code, addresses and
  money. Kanit ships as a Latin subset: Chinese headlines and the baht sign fall back to the system face.
- **Shapes.** Pill buttons in three fills (amber, outline, ink). Hairline rules instead of cards. Authored SVG icons on
  one 24-unit grid with 2-unit round strokes.
- **Motion.** The street moves (a slow sideways drift away from the headline, the sign and doorway breathing like
  neon, the sign's letters dimming briefly now and then like a tube about to go, the front scooter's headlight slowly
  sweeping the road, scroll parallax where the browser supports scroll-driven animation) and the money board plays.
  The two lights are CSS overlays placed in the picture's own pixels (`.mk-fx` in `landing.css`), so they stay on the
  sign and the lamp at every width; on phones they are softer and come less often. All of it is off under
  `prefers-reduced-motion`: the street stands still (the headlight simply shines), the board never starts on its own,
  its active track is simply lit, and every state is still one press away.
- **Layout.** From 1280 px the headline lies over the left of the picture, behind a scrim. Below that the headline
  sits in the sky and the street follows in the normal flow, so copy never lands on the lit shop; phones get an upright
  crop of the scene.
- **Honesty rules.** Every fact on the page comes from `web/lib/marketing.ts`, and `web/tests/marketing.test.ts`
  compares those with the deployment files, the contracts, the README and [BUSINESS.md](BUSINESS.md). Say "testnet"
  wherever it is testnet and "planned" wherever it is planned. Example amounts are labelled as the worked example
  from BUSINESS.md.

Artwork pipeline: [marketing/README.md](marketing/README.md).

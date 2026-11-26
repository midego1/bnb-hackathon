# Submission kit

Everything for the BNB Bangkok (HackQuest) submission. Videos and screenshots were recorded on a local anvil chain
with the seeded demo world (`pnpm testnet:world rehearse`: 3 shops, 10 renters, 15 rentals), 26 Nov 2026.

| File | What |
| --- | --- |
| [HACKQUEST.md](HACKQUEST.md) | Ready-to-paste form fields: name, one-liner, descriptions, BNB Chain, the sponsor tracks, links, test counts |
| [deck.pdf](deck.pdf) | 10-slide pitch deck, 1920×1080 ([deck.html](deck.html) is the source) |
| [duo.mp4](duo.mp4) · [.webm](duo.webm) | **The hero video (59 s).** `/duo/mystery-box`: the renter's phone on the left, the rental company on the right. Rent, pickup photo, return photo, AI split, the owner accepts, settled |
| [demo-guided.mp4](demo-guided.mp4) · [.webm](demo-guided.webm) | `/demo`, Guided, happy path, one click from start to the balanced final summary (90 s) |
| [eli5.mp4](eli5.mp4) · [.webm](eli5.webm) | `/how-it-works`, the cartoon with the "Both agree" ending (71 s) |
| [tour.mp4](tour.mp4) · [.webm](tour.webm) | App tour (77 s): landing, search, a listing with a real photo, a rental page in dispute, `/backoffice` with the demo shops, `/arbiter` with the renter's and owner's history cards, Ask AI answering "what is this renter's history?" |
| [screenshots/](screenshots/) | PNGs at 1470×830 (the phone at 390×844 @2x), light unless noted |

Screenshots:

| File | What |
| --- | --- |
| `01-landing.png` | Landing: the LED hero and the search |
| `02-duo.png` | `/duo/mystery-box`, settled |
| `03-rental.png` | Rental page: a rental in dispute, money in baht, the next step |
| `04-arbiter-history.png` | Dispute desk: the case with the renter's and the owner's history cards |
| `05-backoffice.png` | Back office: the demo shops' rentals read from the chain |
| `06-mobile-r.png` | `/r/mystery-box` on a phone: the AI inspection's split, ready to propose |
| `07-ios.png` | The iOS app (from [ios/screenshots](../../ios/screenshots)) |
| `08-sponsors.png` | `/sponsors`: one card per sponsor track with its live state (a local Worker preview with the public Atlas feeds and no CMC key, so the CMC sub-chip says *Waiting for key*; the live site has CMC live) |
| `09-landing-dark.png` | Landing, dark |
| `10-rental-dark.png` | Rental page, dark |
| `11-sponsors-dark.png` | `/sponsors`, dark |

Recorded with Playwright (Chromium, 1470×830, light, EN) against a local production build with the demo accounts on,
then encoded with ffmpeg (H.264 CRF 30, VP9 CRF 40). The AI inspection is the deterministic demo inspector and
Ask AI the offline demo model (no model keys). Nothing touched a public chain.

Render the deck again: open `deck.html` in Chromium at 1920×1080 and print to PDF with backgrounds, or with
Playwright: `page.pdf({ width: "1920px", height: "1080px", printBackground: true })`.

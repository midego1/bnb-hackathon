# Submission kit

Everything for the BNB Bangkok (HackQuest) submission, recorded from the live site on BSC testnet on 25 Nov 2026.

| File | What |
| --- | --- |
| [HACKQUEST.md](HACKQUEST.md) | Ready-to-paste form fields: name, one-liner, descriptions, BNB Chain and CMC x Atlas usage, links |
| [deck.pdf](deck.pdf) | 10-slide pitch deck, 1920×1080 ([deck.html](deck.html) is the source) |
| [demo-guided.mp4](demo-guided.mp4) · [.webm](demo-guided.webm) | `/demo`, Guided, happy path, live on BSC testnet from start to final balances (4:45) |
| [tour.mp4](tour.mp4) · [.webm](tour.webm) | 85 s tour: landing → `/app` → a rental → Fleet owner → `/developers` → Ask AI "Where is my deposit?" |
| [eli5.mp4](eli5.mp4) · [.webm](eli5.webm) | `/how-it-works`, the "Both agree" ending (70 s) |
| [screenshots/](screenshots/) | 8 PNGs at 1470×830 |

Recorded with Playwright at 1470×830 against <https://keyescrow-web.mdgooijer.workers.dev>, light theme. The demo
run settled rental [`0x09adDfd6…ebA6`](https://testnet.bscscan.com/address/0x09adDfd6c49A066b7122Cc5A8048bEd5af74ebA6).
The tour, the Fleet owner screenshot and the Ask AI screenshot use a **read-only** injected wallet that only reports
the live demo owner's public address (`0x10cA…fC7f`) and refuses every signature, so nothing was signed or sent.
Ask AI runs the demo model on the live site (no model key).

Render the deck again: open `deck.html` in Chromium at 1920×1080 and print to PDF with backgrounds, or with
Playwright: `page.pdf({ width: "1920px", height: "1080px", printBackground: true })`.

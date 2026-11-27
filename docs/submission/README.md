# Submission kit

Everything for the BNB Bangkok (HackQuest) submission. Videos and screenshots were recorded on a local anvil chain
with the seeded demo world (`pnpm testnet:world rehearse`: 3 shops, 10 renters, 15 rentals), 26 Nov 2026.

| File | What |
| --- | --- |
| [HACKQUEST.md](HACKQUEST.md) | Ready-to-paste form fields: name, one-liner, descriptions, BNB Chain, the sponsor tracks, links, test counts |
| [deck.pdf](deck.pdf) | 11-slide pitch deck, 1920×1080 ([deck.html](deck.html) is the source). Slide 4 shows the native iPhone app in CSS phone frames, so no live phone is needed on stage |
| [deck-cover.jpg](deck-cover.jpg) | Slide 1 at 960×540, the deck preview on `/media` (`pdftoppm -f 1 -l 1 -scale-to-x 960 -scale-to-y -1 -jpeg -jpegopt quality=80 deck.pdf`) |
| [duo.mp4](duo.mp4) · [.webm](duo.webm) | **The hero video (64 s).** `/duo`: two phones and a vault. The renter's phone on the left (drawn as the KeyScrow iPhone app), the shop owner's phone on the right, and between them the rental's escrow as a vault with its amount in LED and a pile of coins. The phone opens on the catalogue; picking the Honda Click 125i switches the whole screen to it (฿250 for a day + ฿6,800 deposit). Test money, pay into escrow (the vault fills: ฿7,050 locked), pickup photo, return photo, AI split (the coins take the split's colours: ฿6,206 back, ฿594 to the owner, the rent), the owner presses Accept on their phone, settled (the vault drains back to the renter and on to the owner, one coin is the KeyScrow fee, ฿25). With sound: an English voice-over ([duo-voiceover.md](duo-voiceover.md), Piper `en_GB-cori-high`), soft coin clinks as the vault fills and drains, a tick per step, a chime at Settled and a quiet pad under the voice. Picture: [`web/scripts/record-duo.mjs`](../../web/scripts/record-duo.mjs); sound: [`web/scripts/duo-audio.sh`](../../web/scripts/duo-audio.sh) |
| [duo-voiceover.md](duo-voiceover.md) | The hero video's voice-over: the lines with their start times (read by `duo-audio.sh`), the voice and its licence, the sound design |
| [livingbrain.mp4](livingbrain.mp4) | **The Living Brain memory video (3:54)**, recorded on the live site: the open demo dispute with the renter's and the owner's history cards (on-chain facts + one Living Brain entry per wallet per settled rental), Ask AI retrieving and connecting them, `/sponsors` and `/integrations`, and how an entry is written. English voice-over (Piper `en_GB-cori-high`). Picture: [`web/scripts/record-livingbrain.mjs`](../../web/scripts/record-livingbrain.mjs); poster [livingbrain-poster.jpg](livingbrain-poster.jpg) |
| [livingbrain-voiceover.md](livingbrain-voiceover.md) | The Living Brain video's voice-over: story, lines with start times, the voice and its licence |
| [demo-guided.mp4](demo-guided.mp4) · [.webm](demo-guided.webm) | `/demo`, Guided, happy path, one click from start to the balanced final summary (90 s) |
| [eli5.mp4](eli5.mp4) · [.webm](eli5.webm) | `/how-it-works`, the cartoon with the "Both agree" ending (71 s) |
| [tour.mp4](tour.mp4) · [.webm](tour.webm) | App tour (77 s): landing, search, a listing with a real photo, a rental page in dispute, `/backoffice` with the demo shops, `/arbiter` with the renter's and owner's history cards, Ask AI answering "what is this renter's history?" |
| [screenshots/](screenshots/) | PNGs at 1470×830 (the phone at 390×844 @2x), light unless noted |

Screenshots:

| File | What |
| --- | --- |
| `01-landing.png` | Landing: the LED hero and the search |
| `02-duo.png` | `/duo/honda-click-125i`, settled: the renter's phone (iPhone app look) with "Your ฿6,206 are back" and the split bar, the empty vault with ฿6,206 back to the renter, ฿819 to the owner, KeyScrow fee ฿25, the on-chain receipt, and the owner's phone |
| `02-duo-dark.png` | The same, dark |
| `03-rental.png` | Rental page: a rental in dispute, money in baht, the next step |
| `04-arbiter-history.png` | Dispute desk: the case with the renter's and the owner's history cards |
| `05-backoffice.png` | Back office: the demo shops' rentals read from the chain |
| `06-mobile-r.png` | `/r/mystery-box` on a phone: the AI inspection's split, ready to propose |
| `07-ios.png` | The iOS app in its LED sign design (Settings > Design), four Simulator screens in CSS phone frames: browse the catalogue (prices in LED digits), a listing in 中文, pay into escrow, settled (from [ios/screenshots](../../ios/screenshots)) |
| `ios/*.jpg` | JPEG copies of those four screens for the deck (Chromium embeds JPEGs as they are; the PNGs made deck.pdf 5 MB instead of 3) |
| `08-sponsors.png` | `/sponsors`: one card per sponsor track with its live state (a local Worker preview with the public Atlas feeds and no CMC key, so the CMC sub-chip says *Waiting for key*; the live site has CMC live) |
| `09-landing-dark.png` | Landing, dark |
| `10-rental-dark.png` | Rental page, dark |
| `11-sponsors-dark.png` | `/sponsors`, dark |

Recorded with Playwright (Chromium, 1470×830, light, EN) against a local production build with the demo accounts on,
then encoded with ffmpeg (H.264 CRF 30, VP9 CRF 40). The other videos are silent; `duo.mp4`/`.webm` get their audio
afterwards from `web/scripts/duo-audio.sh` (the picture is copied, not re-encoded): voice at −16 LUFS, AAC 160 kb/s
in the MP4, Opus 128 kb/s in the WebM. `duo.gif` has no sound. The AI inspection is the deterministic demo inspector and
Ask AI the offline demo model (no model keys). Nothing touched a public chain.

Render the deck again: open `deck.html` in Chromium at 1920×1080 and print to PDF with backgrounds, or with
Playwright: `page.pdf({ width: "1920px", height: "1080px", printBackground: true })`.

Everything here (and the iOS screenshots, brand icons and main docs) is downloadable on the app's `/media` page, one by one
or as one .zip; `web/scripts/media.mjs` copies and zips them before every web build.

Credits: the voice-over is spoken by [Piper](https://github.com/rhasspy/piper) (MIT) with the `en_GB-cori-high` voice
from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (MIT), trained by Bryce Beattie on LibriVox
recordings (public domain). The sound effects and the pad are synthesized with ffmpeg; no recorded samples or music.

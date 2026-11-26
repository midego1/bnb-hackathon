# Marketing page artwork

The landing page at `/` (`web/app/(marketing)`) opens on an LED dot-matrix picture of a Thai street at night with a
scooter rental shop and compares "Today" with "With KeyEscrow" in two LED tiles. Every dot of these pictures is a tiny
BNB coin: a disc with the official BNB Chain logomark on it. The drawings are our own, not photos; the logomark is BNB
Chain's (see "The BNB mark" below). The listing cards show real, credited photos instead (Wikimedia Commons; the
catalogue `web/data/listings.json`, the files under `web/public/listings/photos/`, the credits on `/credits`).

| Step | What | Where |
| --- | --- | --- |
| 1 | The street, drawn as vector art by `scene.py` (the scooter is the demo's Honda Click from `web/public/demo/checkin-left-side.svg`, redrawn for night) | `street-wide.svg` (2400x1200), `street-tall.svg` (1200x2000, phones) |
| 2 | The two comparison tiles, drawn by `tiles.py` for an 80x60 LED grid: a passport and cash in a shop drawer, and the KeyEscrow mark under a ฿6,800 sign | `today.svg`, `escrow.svg` (960x720), not committed |
| 3 | Rasterised with `rsvg-convert`. The shop sign uses Kanit ExtraBold (OFL), which must be installed as a system font or the sign falls back to another face: Kanit from Google Fonts, or `web/app/(marketing)/fonts/kanit-800-latin.woff2` converted to TTF with fontTools and given the family name `Kanit` (name IDs 16 and 17) | not committed |
| 4 | Turned into coins by `coins.py`: the colour treatment of [dotfx](https://github.com/thibaud360/dotfx)'s `led` preset, one coin per LED cell instead of a round dot: a disc in the picture's colour with the official BNB logomark (`web/public/marketing/bnb-symbol.svg`) on its face, as large as the coin allows. Lit marks are the official yellow `#F0B90B`, dim ones darker (with the square of the brightness, so the night keeps its colour); the bloom only lights the gaps, so a lit mark stays exactly `#F0B90B`. Cell 10 for the street, cell 12 for the tiles | not committed |
| 5 | Resized and encoded by `coins.py` (Pillow): AVIF quality 44 at speed 2, WebP quality 60, one JPEG fallback at quality 74 | `web/public/marketing/street-{wide,tall}-*.{avif,webp,jpg}`, `{today,escrow}-{480,960}.{avif,webp}`, `{today,escrow}-960.jpg` |
| 6 | The social card (1200x630): `og.html` (the wide LED picture, the headline and the ฿6,800 escrow sign) screenshotted in Chromium. Not redrawn with coins yet: it still shows the round dots | `web/public/marketing/og-v2.jpg` |

```bash
python3 docs/marketing/scene.py /tmp/art
python3 docs/marketing/tiles.py /tmp/art
rsvg-convert -w 2400 /tmp/art/street-wide.svg -o /tmp/art/street-wide.png
rsvg-convert -w 1200 /tmp/art/street-tall.svg -o /tmp/art/street-tall.png
rsvg-convert -w 960 /tmp/art/today.svg -o /tmp/art/today.png
rsvg-convert -w 960 /tmp/art/escrow.svg -o /tmp/art/escrow.png
# coins.py needs numpy and Pillow with AVIF (the same as dotfx)
python3 docs/marketing/coins.py /tmp/art/street-wide.png 10 web/public/marketing/street-wide --widths 1000 1600 2400 --jpg 1600
python3 docs/marketing/coins.py /tmp/art/street-tall.png 10 web/public/marketing/street-tall --widths 600 900 1200 --jpg 900
python3 docs/marketing/coins.py /tmp/art/today.png 12 web/public/marketing/today --widths 480 960 --jpg 960
python3 docs/marketing/coins.py /tmp/art/escrow.png 12 web/public/marketing/escrow --widths 480 960 --jpg 960

for f in /tmp/art/listings/*.png; do
  python3 docs/marketing/coins.py "$f" 12 "web/public/listings/$(basename "$f" .png)" --widths 480 960 --jpg 960
done

# the social card: screenshot og.html, then save the PNG as JPEG (Pillow, quality 86)
cd web && pnpm exec playwright screenshot --viewport-size "1200,630" --wait-for-timeout 800 \
  "file://$PWD/../docs/marketing/og.html" /tmp/art/og.png
```

The ฿6,800 in the escrow tile and on the card is set in the page's own 5x9 dot font
(`web/components/marketing/led.ts`), one font pixel per LED cell. The money board draws the same coin in the browser:
an SVG pattern per LED panel (`MoneyFlow.tsx`, a disc in the station's colour under `bnb-symbol.svg`) and
`web/public/marketing/bnb-coin.svg` for the dots of its tracks (an amber disc with the official path, unchanged).

## The BNB mark

BNB and the BNB logo are trademarks of BNB Chain; used to reference BNB Chain.

`web/public/marketing/bnb-symbol.svg` is BNB Chain's own logomark file, byte for byte as published with its brand
guidelines (<https://www.bnbchain.org/en/brand-guidelines>, "BNB Chain_Symbol_Yellow.svg", SHA-256
`b8ff1ce0b5af2e2d9bcf5ec89fedd5224079f4f7267e306e23e8d691024f5eff`); `coins.py` refuses any other shape of file.
Those guidelines ask projects to seek BNB Chain's approval before using the logo, and say it is not to be altered in
shape, form or colour, not smaller than 15 px wide and not placed on busy backgrounds. Dimming the mark on dark coins
and using it a few pixels wide in a picture goes against the last three, so this use needs that approval.
`pickup-left.webp` and `return-left.webp` are WebP copies of the demo photos in `web/public/demo/walkthrough/`.
The display typeface is Kanit (Cadson Demak, SIL Open Font License), self-hosted from
`web/app/(marketing)/fonts/`; nothing is requested from another origin.

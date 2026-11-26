# Marketing page artwork

The landing page at `/` (`web/app/(marketing)`) opens on an LED dot-matrix picture of a Thai street at night with a
scooter rental shop and compares "Today" with "With KeyEscrow" in two LED tiles. All of it is our own drawing, not a
photo and not third-party art. The listing cards below them show real, credited photos instead (Wikimedia Commons; the
catalogue `web/data/listings.json`, the files under `web/public/listings/photos/`, the credits on `/credits`).

| Step | What | Where |
| --- | --- | --- |
| 1 | The street, drawn as vector art by `scene.py` (the scooter is the demo's Honda Click from `web/public/demo/checkin-left-side.svg`, redrawn for night) | `street-wide.svg` (2400x1200), `street-tall.svg` (1200x2000, phones) |
| 2 | The two comparison tiles, drawn by `tiles.py` for an 80x60 LED grid: a passport and cash in a shop drawer, and the KeyEscrow mark under a ฿6,800 sign | `today.svg`, `escrow.svg` (960x720), not committed |
| 3 | Rasterised with `rsvg-convert` (the shop sign uses Kanit ExtraBold, OFL) | not committed |
| 4 | Run through [dotfx](https://github.com/thibaud360/dotfx), preset `led`: cell 10 for the street, cell 12 for the tiles | not committed |
| 5 | Resized and encoded as AVIF, WebP and one JPEG fallback (Pillow) | `web/public/marketing/street-{wide,tall}-*.{avif,webp,jpg}`, `{today,escrow}-{480,960}.{avif,webp}`, `{today,escrow}-960.jpg` |
| 6 | The social card (1200x630): `og.html` (the wide LED picture, the headline and the ฿6,800 escrow sign) screenshotted in Chromium | `web/public/marketing/og-v2.jpg` |

```bash
python3 docs/marketing/scene.py /tmp/art
python3 docs/marketing/tiles.py /tmp/art
rsvg-convert -w 2400 /tmp/art/street-wide.svg -o /tmp/art/street-wide.png
rsvg-convert -w 1200 /tmp/art/street-tall.svg -o /tmp/art/street-tall.png
rsvg-convert -w 960 /tmp/art/today.svg -o /tmp/art/today.png
rsvg-convert -w 960 /tmp/art/escrow.svg -o /tmp/art/escrow.png
python3 dotfx.py /tmp/art/street-wide.png --preset led --width 2400 --cell 10 -o /tmp/led
python3 dotfx.py /tmp/art/street-tall.png --preset led --width 1200 --cell 10 -o /tmp/led
python3 dotfx.py /tmp/art/today.png --preset led --width 960 --cell 12 -o /tmp/led
python3 dotfx.py /tmp/art/escrow.png --preset led --width 960 --cell 12 -o /tmp/led
# then resize: wide 1000 / 1600 / 2400 px, tall 600 / 900 / 1200 px; AVIF quality 48, WebP quality 68, JPEG quality 72
# tiles: 480 / 960 px; AVIF quality 50, WebP quality 70, JPEG quality 74

# the social card: screenshot og.html, then save the PNG as JPEG (Pillow, quality 86)
cd web && pnpm exec playwright screenshot --viewport-size "1200,630" --wait-for-timeout 800 \
  "file://$PWD/../docs/marketing/og.html" /tmp/art/og.png
```

The ฿6,800 in the escrow tile and on the card is set in the page's own 5x9 dot font
(`web/components/marketing/led.ts`), one font pixel per LED cell.
`pickup-left.webp` and `return-left.webp` are WebP copies of the demo photos in `web/public/demo/walkthrough/`.
The display typeface is Kanit (Cadson Demak, SIL Open Font License), self-hosted from
`web/app/(marketing)/fonts/`; nothing is requested from another origin.

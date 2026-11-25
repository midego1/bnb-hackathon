# Marketing page artwork

The landing page at `/` (`web/app/(marketing)`) opens on an LED dot-matrix picture of a Thai street at night with a
scooter rental shop. It is our own drawing, not a photo and not third-party art.

| Step | What | Where |
| --- | --- | --- |
| 1 | The scene, drawn as vector art by `scene.py` (the scooter is the demo's Honda Click from `web/public/demo/checkin-left-side.svg`, redrawn for night) | `street-wide.svg` (2400x1200), `street-tall.svg` (1200x2000, phones) |
| 2 | Rasterised with `rsvg-convert` (the sign uses Kanit ExtraBold, OFL) | not committed |
| 3 | Run through [dotfx](https://github.com/thibaud360/dotfx), preset `led`, cell 10 | not committed |
| 4 | Resized and encoded as AVIF, WebP and one JPEG fallback (Pillow) | `web/public/marketing/street-{wide,tall}-*.{avif,webp,jpg}` |
| 5 | The social card (1200x630): the wide LED picture plus the headline | `web/public/marketing/og.jpg` |

```bash
python3 docs/marketing/scene.py /tmp/art
rsvg-convert -w 2400 /tmp/art/street-wide.svg -o /tmp/art/street-wide.png
rsvg-convert -w 1200 /tmp/art/street-tall.svg -o /tmp/art/street-tall.png
python3 dotfx.py /tmp/art/street-wide.png --preset led --width 2400 --cell 10 -o /tmp/led
python3 dotfx.py /tmp/art/street-tall.png --preset led --width 1200 --cell 10 -o /tmp/led
# then resize: wide 1000 / 1600 / 2400 px, tall 600 / 900 / 1200 px; AVIF quality 48, WebP quality 68, JPEG quality 72
```

`pickup-left.webp` and `return-left.webp` are WebP copies of the demo photos in `web/public/demo/walkthrough/`.
The display typeface is Kanit (Cadson Demak, SIL Open Font License), self-hosted from
`web/app/(marketing)/fonts/`; nothing is requested from another origin.

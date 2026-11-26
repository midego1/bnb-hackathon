# KeyEscrow intro shot

A 1.75 s intro for the pitch video, drawn in code (`render.py`: cairo + ffmpeg, no browser). Renders go
**outside git** (default `/home/orcasrv/visuals/keyescrow/intro/`); only the generator lives here.

## The shot (120 BPM, one event per beat)

| step | time @120 | frame @60 | what happens |
| --- | --- | --- | --- |
| 0 | 0.00 s | 0 | downbeat: scooter whips across a night street with wavy amber/pink/teal trails, dot-grid flash, flicks its key up |
| 1 | 0.50 s | 30 | the KeyEscrow mark pops in (overshoot), a teal seal ring starts drawing round it |
| 1.5 | 0.75 s | 45 | the key slides into the keyhole: click, keyhole flash, the seal ring closes |
| 2 | 1.00 s | 60 | **big hit**: "KeyEscrow" slams in (zoom + squash and stretch), shoves the mark left, camera shake, burst |
| 2.5 | 1.25 s | 75 | tagline slides up: "Scooter deposits, held on BNB Chain" |
| 3 | 1.50 s | 90 | accent: amber pill on "BNB Chain", keyhole glint |
| 3.5 | 1.75 s | 105 | end (105 frames, 0–104) |

The impact frames (30, 45, 60) are the frames *on* the beat: the motion-blur shutter opens at the frame time,
so the beat frame shows the hit pose.

Brand only: colours from `web/app/globals.css` and `web/app/(marketing)/landing.css` (night band, amber, pink, teal),
the mark from `web/app/icon.svg`, Kanit 500/800 (OFL) from `web/app/(marketing)/fonts`, the street art from
`web/public/marketing`. The scooter and key are drawn in `render.py`. No third-party logos; "BNB Chain" is text.

## Setup (user space, once)

```sh
python3 -m venv ~/visuals/keyescrow/.venv
~/visuals/keyescrow/.venv/bin/pip install cairocffi numpy pillow fonttools brotli uharfbuzz imageio-ffmpeg
```

Needs the system `libcairo2` (present on most Linux boxes). `imageio-ffmpeg` brings an ffmpeg with libx264 and
prores_ks; a system `ffmpeg` on PATH is used first if there is one.

## Render

```sh
PY=~/visuals/keyescrow/.venv/bin/python
$PY media/intro/render.py                       # everything at 120 BPM
$PY media/intro/render.py --bpm 128             # another tempo: every event moves to the new beat grid
$PY media/intro/render.py --bpm 92 --beats-per-step 0.5   # slow song: events on half beats (stays under 2 s)
$PY media/intro/render.py --offset 0.08         # first downbeat 80 ms into the clip (pre-roll)
$PY media/intro/render.py --duration 2.0        # longer hold on the end frame
$PY media/intro/render.py --only main,gif       # subset: main,alpha,vertical,gif,contact
$PY media/intro/render.py --scale 0.5 --stills 0,30,45,60,104 --out /tmp/x   # quick drafts of single frames
```

Length = `offset + 3.5 steps`, one step = `60 / bpm * beats_per_step` s. At 120 BPM: 1.75 s. It stays under 2 s for
any tempo of 105 BPM and up; below that use `--beats-per-step 0.5` (double time). To re-choreograph, edit
`TIMELINE` at the top of `render.py` (positions in steps).

Outputs (in `--out`):

- `intro_1080p60.mp4` — H.264, 1920x1080, 60 fps, full background
- `intro_alpha.mov` — ProRes 4444 with alpha (transparent background, for keying over footage)
- `intro_alpha_png/` + `intro_alpha_png.zip` — the same as a straight-alpha PNG sequence
- `intro_vertical_1080x1920.mp4` — 9:16 relayout (mark over wordmark, two-line tagline)
- `intro_preview.gif` — small preview (< 5 MB)
- `contact.png` — six frames, one per event

Full render takes about a minute on 8 cores.

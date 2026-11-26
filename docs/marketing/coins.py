#!/usr/bin/env python3
"""Turns a rasterised drawing into the landing page's coin matrix and encodes it for the web.

    python3 docs/marketing/coins.py PNG CELL OUT_PREFIX --widths 1000 1600 2400 --jpg 1600

The look of dotfx's `led` preset (same colour boost, one dot per CELL x CELL block, black gaps, a little bloom), but each
dot is a tiny BNB coin: a disc with the official BNB Chain logomark on its face (web/public/marketing/bnb-symbol.svg,
from bnbchain.org's brand guidelines, shape and proportions unchanged), as large as the coin allows so that it still
reads at a few pixels. The cell's brightness drives the coin: lit marks are the official yellow #F0B90B, dim ones darker.
The disc keeps the picture's colour (dark cells are dim coins in the colour of the night, pale light turns gold, a strong
colour such as the red scooter stays its colour), so the picture still reads.

Writes OUT_PREFIX-<w>.avif and .webp for every width and OUT_PREFIX-<jpg>.jpg. Needs numpy and Pillow with AVIF (the
same as dotfx). See README.md in this folder for the whole pipeline.
"""
import argparse
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

MARK_SVG = Path(__file__).resolve().parents[2] / "web/public/marketing/bnb-symbol.svg"
BNB = np.array([0xF0, 0xB9, 0x0B], np.float32) / 255  # the official yellow
DARK_GOLD = np.array([0xA8, 0x76, 0x08], np.float32) / 255  # the face of a lit coin

# Coin geometry in cell units (the cell is 1 x 1): the coin's radius and the mark's (the logomark fits a circle of
# radius 48 around the centre of its 96 x 96 box).
R, MARK_R = 0.45, 0.42
# Gold sets in from this brightness (max channel, 0..1) and is complete at 1; saturated colours take less of it.
GOLD_FROM, KEEP_COLOUR = 0.45, 0.85
# From this brightness up the mark is the official yellow; below it darker, falling off with the square of the
# brightness so that the dim marks of the night sky do not turn it olive.
MARK_FULL = 0.8


def mark_polygons(svg: Path) -> list[list[tuple[float, float]]]:
    """The logomark's outlines in its 96 x 96 box. The official file is one path of absolute M, L, H, V and Z commands,
    and its pieces never overlap, so filling each outline draws it exactly."""
    d = re.fullmatch(r'\s*<svg[^>]*viewBox="0 0 96 96"[^>]*>\s*<path d="([^"]+)" fill="#F0B90B"/>\s*</svg>\s*', svg.read_text())
    assert d, f"{svg} is not the official 96 x 96 one-path logomark"
    polys, x, y = [], 0.0, 0.0
    for cmd, args in re.findall(r"([MLHVZ])([^MLHVZ]*)", d.group(1)):
        n = [float(v) for v in re.findall(r"-?\d*\.?\d+", args)]
        if cmd == "M":
            polys.append([])
        if cmd in "ML":
            for i in range(0, len(n), 2):
                x, y = n[i], n[i + 1]
                polys[-1].append((x, y))
        elif cmd == "H":
            x = n[-1]
            polys[-1].append((x, y))
        elif cmd == "V":
            y = n[-1]
            polys[-1].append((x, y))
    return polys


def coin_masks(cell: int, ss: int = 8) -> dict[str, np.ndarray]:
    """How much of each pixel of one cell each part covers, anti-aliased by ss x ss supersampling."""
    n = cell * ss
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n - 0.5
    disc = np.hypot(x, y) <= R
    canvas = Image.new("L", (n, n))
    k = MARK_R / 48 * n  # px per logomark unit
    for poly in mark_polygons(MARK_SVG):
        ImageDraw.Draw(canvas).polygon([(n / 2 + (px - 48) * k, n / 2 + (py - 48) * k) for px, py in poly], fill=255)
    mark = np.asarray(canvas) > 127
    assert MARK_R < R < 0.5 and not (mark & ~disc).any(), "the mark sits on the coin, the coin inside its cell"
    down = lambda m: m.astype(np.float32).reshape(cell, ss, cell, ss).mean(axis=(1, 3))
    return {"face": down(disc & ~mark), "mark": down(mark), "disc": down(disc)}


def coin_colours(g: np.ndarray) -> dict[str, np.ndarray]:
    """The colour of each part of each coin, from the cell colours g (rows x cols x 3, 0..1)."""
    v = g.max(axis=2, keepdims=True)
    saturation = (v - g.min(axis=2, keepdims=True)) / np.maximum(v, 1e-6)
    gold = np.clip((v - GOLD_FROM) / (1 - GOLD_FROM), 0, 1) * (1 - KEEP_COLOUR * saturation)
    level = np.clip(v / MARK_FULL, 0, 1) ** 2
    mix = lambda a, b, w: a * (1 - w) + b * w
    return {
        # Dark under a lit mark, so the yellow stands out; lighter under a dim one, so the night keeps its colour.
        "face": mix(g, DARK_GOLD * v, gold * 0.35) * (0.6 + 0.35 * (1 - level)),
        "mark": BNB * level,
    }


def coins(img: Image.Image, cell: int) -> Image.Image:
    # dotfx `led`: saturation 1.2, brightness 0.92, contrast 1.25, then one colour per cell.
    img = ImageEnhance.Color(img.convert("RGB")).enhance(1.2)
    img = ImageEnhance.Contrast(ImageEnhance.Brightness(img).enhance(0.92)).enhance(1.25)
    cols, rows = img.width // cell, img.height // cell
    g = np.asarray(img.resize((cols, rows), Image.BOX), np.float32) / 255
    masks, colours = coin_masks(cell), coin_colours(g)
    tile = lambda m: np.tile(m, (rows, cols))[..., None]
    out = sum(tile(masks[k]) * np.repeat(np.repeat(colours[k], cell, 0), cell, 1) for k in colours)
    # dotfx's bloom (glow 0.12), only in the gaps between the coins: lit coins glow and the marks keep their yellow.
    glow = np.asarray(Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(cell * 0.8)), np.float32) / 255
    out = out + glow * 0.12 * (1 - tile(masks["disc"]))
    return Image.fromarray((np.clip(out, 0, 1) * 255).round().astype(np.uint8))


if __name__ == "__main__":
    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("png")
    a.add_argument("cell", type=int, help="LED cell in px of the PNG (10 for the street, 12 for the 960 px pictures)")
    a.add_argument("out", help="output prefix, e.g. web/public/marketing/street-wide")
    a.add_argument("--widths", type=int, nargs="+", required=True)
    a.add_argument("--jpg", type=int, required=True, help="the width of the one JPEG fallback")
    o = a.parse_args()
    art = coins(Image.open(o.png), o.cell)
    for w in sorted(set(o.widths) | {o.jpg}):
        im = art if w == art.width else art.resize((w, round(art.height * w / art.width)), Image.LANCZOS)
        if w in o.widths:
            # q44 at speed 2 keeps the hero at the bytes of the round-dot version; dim coins blur a little, lit ones stay sharp.
            im.save(f"{o.out}-{w}.avif", quality=44, speed=2)
            im.save(f"{o.out}-{w}.webp", quality=60, method=6)
        if w == o.jpg:
            im.save(f"{o.out}-{w}.jpg", quality=74, optimize=True, progressive=True)
    print(f"{o.out}: {art.width}x{art.height}, widths {o.widths}, jpg {o.jpg}")

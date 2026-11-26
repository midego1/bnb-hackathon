#!/usr/bin/env python3
"""Draws the two tiles of the landing page's "Today / With KeyScrow" comparison (original vector art).

    python3 docs/marketing/tiles.py OUT_DIR      # writes today.svg and escrow.svg (960x720)

Both are drawn for an 80x60 LED grid (coins.py, cell 12): bold flat shapes, and the baht amount in a 5x9 dot font with
one font pixel per LED cell. See README.md in this folder for the rest of the pipeline.
"""
import sys
from pathlib import Path

W, H, CELL = 960, 720, 12

# 5x9 dot font, rows top to bottom ("#" is a lit dot). The same glyphs as the page's LED numerals
# (web/components/marketing/led.ts).
GLYPHS = {
    "0": ["", ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###.", ""],
    "6": ["", "..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###.", ""],
    "8": ["", ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###.", ""],
    ",": ["", "", "", "", "", "", "##", ".#", "#."],
    "฿": ["..#..", "####.", "#.#.#", "#.#.#", "####.", "#.#.#", "#.#.#", "####.", "..#.."],
}


def led_text(text: str, col: int, row: int, color: str) -> str:
    """`text` in the dot font, its top-left corner on LED cell (col, row)."""
    out, x = [], col
    for ch in text:
        glyph = GLYPHS[ch]
        for y, line in enumerate(glyph):
            for i, dot in enumerate(line):
                if dot == "#":
                    out.append(f'<rect x="{(x + i) * CELL}" y="{(row + y) * CELL}" width="{CELL}" height="{CELL}" fill="{color}"/>')
        x += max(len(line) for line in glyph) + 1
    return "".join(out)


def defs() -> str:
    return """
<defs>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d0b2a"/><stop offset="1" stop-color="#1b1648"/>
  </linearGradient>
  <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fde68a" stop-opacity="0.75"/><stop offset="0.5" stop-color="#fbbf24" stop-opacity="0.3"/>
    <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fbbf24" stop-opacity="0.6"/><stop offset="0.55" stop-color="#f59e0b" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#f59e0b" stop-opacity="0"/>
  </radialGradient>
</defs>"""


def passport(x: float, y: float, w: float, h: float, turn: float) -> str:
    """A burgundy booklet with a gold emblem and two gold lines; no country, no text."""
    return (
        f'<g transform="translate({x} {y}) rotate({turn})">'
        f'<rect width="{w}" height="{h}" rx="{w * 0.07:.0f}" fill="#be123c"/>'
        f'<rect width="{w * 0.12:.0f}" height="{h}" rx="{w * 0.05:.0f}" fill="#7f1230"/>'
        f'<circle cx="{w * 0.56:.0f}" cy="{h * 0.36:.0f}" r="{w * 0.2:.0f}" fill="none" stroke="#fbbf24" stroke-width="{w * 0.075:.0f}"/>'
        f'<circle cx="{w * 0.56:.0f}" cy="{h * 0.36:.0f}" r="{w * 0.07:.0f}" fill="#fbbf24"/>'
        f'<rect x="{w * 0.27:.0f}" y="{h * 0.68:.0f}" width="{w * 0.58:.0f}" height="{h * 0.075:.0f}" fill="#fbbf24"/>'
        f'<rect x="{w * 0.36:.0f}" y="{h * 0.83:.0f}" width="{w * 0.4:.0f}" height="{h * 0.055:.0f}" fill="#fbbf24" opacity="0.75"/>'
        "</g>"
    )


def banknotes(col: int, row: int) -> str:
    """A stack of three notes; the top one sits on the LED grid so its baht sign stays crisp."""
    w, h = 26 * CELL, 13 * CELL
    x, y = col * CELL, row * CELL
    out = [
        f'<rect x="{x - 36}" y="{y - 36}" width="{w}" height="{h}" fill="#14532d"/>',
        f'<rect x="{x - 18}" y="{y - 18}" width="{w}" height="{h}" fill="#15803d"/>',
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#166534"/>',
        f'<rect x="{x + CELL * 0.5}" y="{y + CELL * 0.5}" width="{w - CELL}" height="{h - CELL}" fill="none" stroke="#4ade80" stroke-width="{CELL}"/>',
        led_text("฿", col + 10, row + 2, "#dcfce7"),
        f'<rect x="{x + 3 * CELL}" y="{y + 5 * CELL}" width="{4 * CELL}" height="{3 * CELL}" fill="#4ade80"/>',
        f'<rect x="{x + 19 * CELL}" y="{y + 5 * CELL}" width="{4 * CELL}" height="{3 * CELL}" fill="#4ade80"/>',
    ]
    return "".join(out)


def today() -> str:
    """The counter today: an open drawer under a lamp, with the renter's passport and cash in it."""
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        defs(),
        f'<rect width="{W}" height="{H}" fill="url(#wall)"/>',
        # the hanging lamp and its cone of light
        '<rect x="474" y="0" width="12" height="36" fill="#6b72a6"/>',
        '<path d="M420 84 L444 36 L516 36 L540 84 Z" fill="#fbbf24"/>',
        '<path d="M420 84 L540 84 L860 600 L100 600 Z" fill="#fbbf24" opacity="0.1"/>',
        # the counter and the open drawer: side walls, floor, then the front panel with its lock
        '<rect x="0" y="132" width="960" height="588" fill="#231a52"/>',
        '<rect x="0" y="132" width="960" height="24" fill="#4a3f8f"/>',
        '<path d="M108 168 L852 168 L900 588 L60 588 Z" fill="#3b2f7a"/>',
        '<path d="M144 192 L816 192 L852 588 L108 588 Z" fill="#1a1238"/>',
        '<ellipse cx="480" cy="390" rx="400" ry="230" fill="url(#lamp)"/>',
        passport(180, 228, 240, 312, 0),
        banknotes(45, 23),
        '<rect x="36" y="588" width="888" height="108" rx="10" fill="#5b4fa8"/>',
        '<rect x="36" y="588" width="888" height="24" fill="#7c70c9"/>',
        '<rect x="432" y="624" width="96" height="60" rx="12" fill="#fbbf24"/>',
        '<circle cx="480" cy="644" r="11" fill="#1a1238"/><rect x="474" y="644" width="12" height="28" fill="#1a1238"/>',
        "</svg>",
    ]
    return "\n".join(parts)


def mark(x: float, y: float, size: float) -> str:
    """The earlier KeyScrow mark (a house with a keyhole on an amber tile), kept in the drawn tiles; the web mark is now the app icon (web/public/brand)."""
    s = size / 64
    return (
        f'<g transform="translate({x} {y}) scale({s})">'
        '<rect width="64" height="64" rx="14" fill="#f59e0b"/>'
        '<path d="M32 12 10 30h6v21h32V30h6L32 12Z" fill="#0f172a"/>'
        '<circle cx="32" cy="35" r="6" fill="#fbbf24"/>'
        '<path d="M29.5 38h5l1.5 9h-8l1.5-9Z" fill="#fbbf24"/>'
        "</g>"
    )


# A check mark on the LED grid, two dots thick.
CHECK = [".......##", "......##.", "##...##..", ".##.##...", "..###....", "...#....."]


def check(col: int, row: int, color: str) -> str:
    return "".join(
        f'<rect x="{(col + i) * CELL}" y="{(row + y) * CELL}" width="{CELL}" height="{CELL}" fill="{color}"/>'
        for y, line in enumerate(CHECK)
        for i, dot in enumerate(line)
        if dot == "#"
    )


def escrow() -> str:
    """With KeyScrow: the deposit on the sign, held by the mark, and the passport still with its owner (the check)."""
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        defs(),
        f'<rect width="{W}" height="{H}" fill="url(#wall)"/>',
        '<circle cx="354" cy="432" r="340" fill="url(#halo)"/>',
        # the sign: a pink bulb frame, one LED cell thick, around the amount
        f'<rect x="{21.5 * CELL}" y="{2.5 * CELL}" width="{37 * CELL}" height="{12 * CELL}" fill="#080720" stroke="#f472b6" stroke-width="{CELL}"/>',
        led_text("฿6,800", 24, 4, "#fbbf24"),
        mark(192, 264, 324),
        passport(624, 300, 168, 228, 5),
        '<circle cx="810" cy="540" r="84" fill="#0d0b2a"/>',
        '<circle cx="810" cy="540" r="70" fill="none" stroke="#2dd4bf" stroke-width="12"/>',
        check(63, 42, "#2dd4bf"),
        "</svg>",
    ]
    return "\n".join(parts)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    (out / "today.svg").write_text(today(), encoding="utf-8")
    (out / "escrow.svg").write_text(escrow(), encoding="utf-8")
    print(f"wrote {out / 'today.svg'} and {out / 'escrow.svg'}")

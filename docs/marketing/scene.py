#!/usr/bin/env python3
"""Draws the landing page's hero artwork: a Thai soi at dusk with a scooter rental shop (original vector art).

    python3 docs/marketing/scene.py OUT_DIR      # writes street-wide.svg (2400x1200) and street-tall.svg (1200x2000)

The scooter is the same one as the demo "photos" (web/public/demo/checkin-left-side.svg), redrawn for night.
See README.md in this folder for the rest of the pipeline (SVG -> PNG -> coins.py: LED coins -> AVIF/WebP/JPEG).
"""
import random
import sys
from pathlib import Path

FONT = "Kanit, sans-serif"


def defs() -> str:
    return """
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0a0f2c"/><stop offset="0.45" stop-color="#1f1a55"/>
    <stop offset="0.74" stop-color="#6d2466"/><stop offset="0.9" stop-color="#d9466a"/><stop offset="1" stop-color="#fb923c"/>
  </linearGradient>
  <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a2350"/><stop offset="1" stop-color="#0c0a22"/>
  </linearGradient>
  <linearGradient id="shopglow" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/>
  </linearGradient>
  <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fef3c7" stop-opacity="0.95"/><stop offset="0.35" stop-color="#fbbf24" stop-opacity="0.45"/>
    <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="pink" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#f472b6" stop-opacity="0.55"/><stop offset="1" stop-color="#f472b6" stop-opacity="0"/>
  </radialGradient>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="softer" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34"/></filter>
</defs>"""


def stars(w: int, h: int, n: int, seed: int) -> str:
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        out.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{rnd.choice([5, 6, 7])}" fill="#e0e7ff" opacity="{rnd.uniform(0.35, 0.9):.2f}"/>')
    return "".join(out)


def moon(x: float, y: float, r: float = 62) -> str:
    return (
        f'<circle cx="{x}" cy="{y}" r="{r * 2.4}" fill="url(#lamp)" opacity="0.45"/>'
        f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fef9c3"/>'
        f'<circle cx="{x + r * 0.42}" cy="{y - r * 0.2}" r="{r * 0.9}" fill="#161448"/>'
    )


def chedi(x: float, base: float, s: float = 1.0) -> str:
    """A temple spire in silhouette against the dusk, with a thin gold rim light. Origin: centre of its base."""
    body = "M-150 0 L-150 -40 L-118 -40 L-118 -74 L-92 -74 Q-88 -170 -34 -214 L-22 -262 L-12 -262 L-6 -420 L0 -470 L6 -420 L12 -262 L22 -262 L34 -214 Q88 -170 92 -74 L118 -74 L118 -40 L150 -40 L150 0 Z"
    return (
        f'<g transform="translate({x} {base}) scale({s})">'
        f'<path d="{body}" fill="#3a2a86"/>'
        '<path d="M0 -470 L6 -420 L12 -262 L22 -262 L34 -214 Q88 -170 92 -74" fill="none" stroke="#fbbf24" stroke-width="9" opacity="0.8"/>'
        "</g>"
    )


def skyline(w: int, base: float, seed: int) -> str:
    """Low shophouses far down the street: dark blocks with a few lit windows."""
    rnd = random.Random(seed)
    out, x = [], -20.0
    while x < w:
        bw, bh = rnd.uniform(120, 230), rnd.uniform(90, 250)
        out.append(f'<rect x="{x:.0f}" y="{base - bh:.0f}" width="{bw:.0f}" height="{bh:.0f}" fill="#231a52"/>')
        for wy in range(int(base - bh + 26), int(base - 30), 48):
            for wx in range(int(x + 20), int(x + bw - 30), 46):
                if rnd.random() < 0.3:
                    out.append(f'<rect x="{wx}" y="{wy}" width="24" height="24" fill="{rnd.choice(["#fbbf24", "#fde68a", "#67e8f9", "#f472b6"])}" opacity="0.85"/>')
        x += bw + rnd.uniform(0, 24)
    return "".join(out)


def pole(x: float, base: float, h: float = 620) -> str:
    """A concrete utility pole with a street lamp and a transformer box."""
    return (
        f'<g transform="translate({x} {base})">'
        f'<rect x="-11" y="{-h}" width="22" height="{h}" fill="#3b3470"/>'
        f'<rect x="-92" y="{-h + 40}" width="184" height="12" fill="#3b3470"/>'
        f'<rect x="-70" y="{-h + 92}" width="140" height="10" fill="#3b3470"/>'
        f'<rect x="-34" y="{-h + 130}" width="44" height="64" rx="6" fill="#4c4690"/>'
        f'<path d="M0 {-h + 250} q70 -60 132 -20" fill="none" stroke="#3b3470" stroke-width="12"/>'
        f'<circle cx="138" cy="{-h + 250}" r="170" fill="url(#lamp)"/>'
        f'<ellipse cx="138" cy="{-h + 238}" rx="34" ry="16" fill="#fef3c7"/>'
        "</g>"
    )


def wires(x1: float, y1: float, x2: float, y2: float, sag: float, n: int = 4) -> str:
    out = []
    for i in range(n):
        dy = i * 18
        mx = (x1 + x2) / 2
        out.append(f'<path d="M{x1} {y1 + dy} Q{mx} {max(y1, y2) + dy + sag + i * 14} {x2} {y2 + dy}" fill="none" stroke="#4a4388" stroke-width="5"/>')
    return "".join(out)


def bulbs(x1: float, y1: float, x2: float, y2: float, sag: float, n: int) -> str:
    """A string of festival bulbs."""
    colors = ["#f472b6", "#fbbf24", "#34d399", "#60a5fa", "#fb923c"]
    mx, my = (x1 + x2) / 2, max(y1, y2) + sag
    out = [f'<path d="M{x1} {y1} Q{mx} {my} {x2} {y2}" fill="none" stroke="#4a4388" stroke-width="4"/>']
    for i in range(1, n):
        t = i / n
        x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * mx + t**2 * x2
        y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * my + t**2 * y2
        out.append(f'<circle cx="{x:.0f}" cy="{y + 12:.0f}" r="13" fill="{colors[i % len(colors)]}"/>')
    return "".join(out)


def palm(x: float, base: float, s: float = 1.0) -> str:
    fronds = []
    for ang, ln in [(-160, 250), (-125, 270), (-95, 250), (-60, 280), (-25, 250), (10, 220), (-190, 220)]:
        fronds.append(f'<path d="M0 0 Q{ln * 0.5} {-ln * 0.42} {ln} {ln * 0.1} Q{ln * 0.5} {-ln * 0.2} 0 0 Z" fill="#1f7a5c" transform="rotate({ang})"/>')
    return (
        f'<g transform="translate({x} {base}) scale({s})">'
        '<path d="M-14 0 Q-34 -260 6 -520 L30 -520 Q0 -260 16 0 Z" fill="#4a3a6e"/>'
        f'<g transform="translate(18 -520)">{"".join(fronds)}</g>'
        "</g>"
    )


def scooter(x: float, base: float, s: float = 1.0, body: str = "#ef4444", light: bool = True, flip: bool = False) -> str:
    """The demo's Honda Click, side on, front wheel to the right. Origin: on the ground under the centre."""
    sx = -s if flip else s
    beam = (
        '<path d="M236 -212 L640 -260 L640 -60 Z" fill="#fde68a" opacity="0.2" filter="url(#soft)"/>'
        '<circle cx="232" cy="-204" r="92" fill="url(#lamp)"/>'
        if light
        else ""
    )
    return (
        f'<g transform="translate({x} {base}) scale({sx} {s})">'
        '<ellipse cx="0" cy="4" rx="250" ry="18" fill="#05040f" opacity="0.7"/>'
        f"{beam}"
        # wheels
        '<circle cx="-150" cy="-54" r="54" fill="#565a8a"/><circle cx="-150" cy="-54" r="25" fill="#cbd5e1"/>'
        '<circle cx="150" cy="-54" r="54" fill="#565a8a"/><circle cx="150" cy="-54" r="25" fill="#cbd5e1"/>'
        # body: rear cowl, floorboard, front fender
        f'<path d="M-204 -92 Q-184 -166 -92 -170 L10 -170 L42 -104 L112 -104 Q150 -152 202 -124 L222 -94 Q182 -94 150 -104 Q100 -94 80 -74 L-92 -74 Q-132 -104 -204 -92 Z" fill="{body}"/>'
        '<path d="M-92 -170 Q-82 -206 -22 -206 L30 -200 Q40 -190 24 -180 L-82 -173 Z" fill="#8f96c4"/>'
        '<rect x="-122" y="-94" width="232" height="22" rx="8" fill="#6b72a6"/>'
        # steering column, handlebar, leg shield, headlight, mirror, tail light
        '<path d="M150 -104 L182 -266" stroke="#8f96c4" stroke-width="13" stroke-linecap="round"/>'
        '<path d="M150 -272 L214 -278" stroke="#cbd5e1" stroke-width="11" stroke-linecap="round"/>'
        f'<path d="M176 -246 Q222 -236 228 -196 L202 -164 Q182 -196 162 -206 Z" fill="{body}"/>'
        '<ellipse cx="224" cy="-204" rx="13" ry="19" fill="#fef9c3"/>'
        '<path d="M188 -278 L168 -314" stroke="#8f96c4" stroke-width="5"/><ellipse cx="164" cy="-320" rx="15" ry="10" fill="#cbd5e1"/>'
        '<rect x="-230" y="-128" width="36" height="16" rx="4" fill="#fb923c"/>'
        "</g>"
    )


def shop(x: float, base: float) -> str:
    """A two-storey shophouse: lit rental shop below, signboard, shuttered floor above. Origin: bottom-left corner."""
    return (
        f'<g transform="translate({x} {base})">'
        # upper floor
        '<rect x="0" y="-760" width="820" height="330" fill="#2f2769"/>'
        '<rect x="-14" y="-786" width="848" height="30" fill="#463e8c"/>'
        '<rect x="70" y="-700" width="150" height="190" fill="#67e8f9" opacity="0.8"/>'
        '<rect x="140" y="-700" width="10" height="190" fill="#2f2769"/><rect x="70" y="-610" width="150" height="10" fill="#2f2769"/>'
        '<rect x="330" y="-700" width="150" height="190" fill="#1e1a4d"/>'
        '<rect x="590" y="-700" width="150" height="190" fill="#fbbf24" opacity="0.85"/>'
        '<rect x="660" y="-700" width="10" height="190" fill="#2f2769"/>'
        '<rect x="250" y="-560" width="64" height="44" rx="4" fill="#565a8a"/>'  # air-con unit
        '<rect x="30" y="-470" width="760" height="14" fill="#565a8a"/>'  # balcony rail
        + "".join(f'<rect x="{40 + i * 50}" y="-500" width="8" height="36" fill="#565a8a"/>' for i in range(15))
        # signboard with a neon frame
        + '<rect x="-30" y="-448" width="880" height="158" rx="10" fill="#150f3a"/>'
        '<rect x="-18" y="-436" width="856" height="134" rx="8" fill="none" stroke="#f472b6" stroke-width="10"/>'
        f'<text x="16" y="-338" font-family="{FONT}" font-weight="800" font-size="96" fill="#fde047" letter-spacing="8">SCOOTER</text>'
        f'<text x="540" y="-338" font-family="{FONT}" font-weight="800" font-size="96" fill="#f8fafc" letter-spacing="8">RENT</text>'
        # awning
        + "".join(f'<path d="M{-40 + i * 90} -290 h90 l-10 62 h-90 Z" fill="{"#14b8a6" if i % 2 else "#e2e8f0"}"/>' for i in range(10))
        # shop floor: lit interior with two parked scooters in silhouette and a counter
        + '<rect x="0" y="-232" width="820" height="232" fill="#241d58"/>'
        '<rect x="40" y="-228" width="740" height="228" fill="url(#shopglow)"/>'
        '<rect x="40" y="-228" width="740" height="30" fill="#fef9c3"/>'
        '<g fill="#b45309"><rect x="90" y="-150" width="250" height="16"/><rect x="90" y="-90" width="250" height="16"/>'
        '<rect x="540" y="-110" width="200" height="110"/></g>'
        '<rect x="0" y="-232" width="40" height="232" fill="#3b3478"/><rect x="780" y="-232" width="40" height="232" fill="#3b3478"/>'
        "</g>"
    )


def neighbour(x: float, base: float, w: float, h: float, seed: int) -> str:
    rnd = random.Random(seed)
    out = [f'<g transform="translate({x} {base})"><rect x="0" y="{-h}" width="{w}" height="{h}" fill="#28205e"/>']
    for wy in range(int(-h + 50), -180, 150):
        for wx in range(40, int(w - 90), 130):
            c = rnd.choice(["#1e1a4d", "#1e1a4d", "#fbbf24", "#67e8f9", "#f472b6"])
            out.append(f'<rect x="{wx}" y="{wy}" width="84" height="96" fill="{c}" opacity="0.85"/>')
    # a rolled-down shutter and a small lit noodle-stall window at street level
    out.append(f'<rect x="30" y="-170" width="{w - 60}" height="170" fill="#3b3478"/>')
    out.extend(f'<rect x="30" y="{-160 + i * 26}" width="{w - 60}" height="8" fill="#28205e"/>' for i in range(6))
    out.append("</g>")
    return "".join(out)


def road(w: int, top: float, h: float, lights: list[tuple[float, str, float]]) -> str:
    out = [f'<rect x="0" y="{top}" width="{w}" height="{h}" fill="url(#road)"/>', f'<rect x="0" y="{top}" width="{w}" height="14" fill="#6b72a6"/>']
    # wet-road reflections under each light source
    for x, color, width in lights:
        out.append(f'<ellipse cx="{x}" cy="{top + h * 0.5}" rx="{width}" ry="{h * 0.46}" fill="{color}" opacity="0.32" filter="url(#softer)"/>')
    for x in range(-60, w, 300):
        out.append(f'<rect x="{x}" y="{top + h * 0.62}" width="170" height="16" fill="#e2e8f0" opacity="0.6"/>')
    return "".join(out)


def wide() -> str:
    w, h, ground = 2400, 1200, 860
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
        defs(),
        f'<rect width="{w}" height="{h}" fill="url(#sky)"/>',
        stars(w, 520, 46, 7),
        moon(1040, 170),
        skyline(w, ground, 3),
        chedi(520, ground, 1.25),
        chedi(250, ground, 0.62),
        pole(1150, ground, 700),
        wires(-40, 180, 1150, 200, 90),
        wires(1150, 200, 2440, 160, 70),
        neighbour(2190, ground, 300, 700, 5),
        shop(1370, ground),
        '<circle cx="1790" cy="490" r="330" fill="url(#pink)"/>',
        bulbs(1160, 350, 1380, 430, 70, 7),
        palm(1238, ground, 0.95),
        road(w, ground, h - ground, [(1780, "#fbbf24", 420), (1290, "#fde68a", 170), (1790, "#f472b6", 200)]),
        scooter(1960, ground + 62, 0.8, body="#2dd4bf", light=False),
        scooter(1470, ground + 318, 1.36, body="#f43f5e"),
        "</svg>",
    ]
    return "\n".join(parts)


def tall() -> str:
    """Phone crop: the same street, composed upright with open sky above for the headline."""
    w, h, ground = 1200, 2000, 1570
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
        defs(),
        f'<rect width="{w}" height="{h}" fill="url(#sky)"/>',
        stars(w, 900, 40, 11),
        moon(930, 250, 56),
        skyline(w, ground, 9),
        pole(70, ground, 700),
        wires(70, 910, 1240, 770, 80),
        shop(170, ground),
        '<circle cx="590" cy="1200" r="330" fill="url(#pink)"/>',
        bulbs(80, 1060, 180, 1130, 50, 5),
        palm(120, ground, 0.8),
        road(w, ground, h - ground, [(590, "#fbbf24", 400), (160, "#fde68a", 140), (600, "#f472b6", 190)]),
        scooter(770, ground + 60, 0.72, body="#2dd4bf", light=False),
        scooter(500, ground + 345, 1.4, body="#f43f5e"),
        "</svg>",
    ]
    return "\n".join(parts)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    (out / "street-wide.svg").write_text(wide(), encoding="utf-8")
    (out / "street-tall.svg").write_text(tall(), encoding="utf-8")
    print(f"wrote {out / 'street-wide.svg'} and {out / 'street-tall.svg'}")

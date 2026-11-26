#!/usr/bin/env python3
"""Draws the pictures of the landing page's demo scooter listings (original vector art).

    python3 docs/marketing/scooters.py OUT_DIR      # writes <slug>.svg (960x720) for the six demo listings

One scooter-drawing function with a few parameters (shape, colours, wheels, seat, lights) and one backdrop per place.
Like tiles.py they are drawn for an 80x60 LED grid (dotfx, cell 12): bold flat shapes, no logos, no text.
The slugs are those of web/data/listings.json. See README.md in this folder for the rest of the pipeline.
"""
import sys
from pathlib import Path

W, H = 960, 720
GROUND = 600  # the road starts here

STEEL = "#8f96c4"
CHROME = "#cbd5e1"
TYRE = "#6f76ad"
LAMP = "#fef9c3"


def defs() -> str:
    return """
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d0b2a"/><stop offset="0.55" stop-color="#1f1a55"/>
    <stop offset="0.86" stop-color="#5b2163"/><stop offset="1" stop-color="#c2415f"/>
  </linearGradient>
  <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0d0b2a"/><stop offset="1" stop-color="#231c5c"/>
  </linearGradient>
  <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2a2350"/><stop offset="1" stop-color="#0c0a22"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fef3c7" stop-opacity="0.9"/><stop offset="0.4" stop-color="#fbbf24" stop-opacity="0.4"/>
    <stop offset="1" stop-color="#fbbf24" stop-opacity="0"/>
  </radialGradient>
</defs>"""


def wheels(wb: float, r: float) -> str:
    return "".join(
        f'<circle cx="{x}" cy="{-r}" r="{r}" fill="{TYRE}"/><circle cx="{x}" cy="{-r}" r="{r * 0.5:.0f}" fill="{CHROME}"/>'
        for x in (-wb, wb)
    )


def scooter(x: float, base: float, s: float, shape: str, body: str, accent: str, seat: str, wb: float, r: float, light: str = "shield") -> str:
    """A scooter seen from the side, front wheel to the right. Origin: on the ground under its centre.

    shape: "sport" (a commuter with a sharp rear cowl), "maxi" (long and low, a big nose and a windshield) or
    "retro" (a round steel body with a tall leg shield). light: "shield" puts the headlight on the front, "bar" a
    round one on the handlebar. accent: the second colour (stripe, tunnel or lower body).
    """
    p = [f'<g transform="translate({x} {base}) scale({s})">', f'<ellipse cx="0" cy="4" rx="{wb + 110}" ry="16" fill="#05040f" opacity="0.75"/>']
    p.append(wheels(wb, r))
    if shape == "sport":
        p += [
            f'<path d="M-204 -92 Q-184 -166 -92 -170 L10 -170 L42 -104 L112 -104 Q150 -152 202 -124 L222 -94 Q182 -94 150 -104 Q100 -94 80 -74 L-92 -74 Q-132 -104 -204 -92 Z" fill="{body}"/>',
            f'<path d="M-196 -112 L-60 -142 L-52 -124 L-190 -96 Z" fill="{accent}"/>',
            f'<path d="M-92 -170 Q-82 -206 -22 -206 L30 -200 Q40 -190 24 -180 L-82 -173 Z" fill="{seat}"/>',
            '<rect x="-122" y="-94" width="232" height="22" rx="8" fill="#6b72a6"/>',
            f'<path d="M150 -104 L182 -266" stroke="{STEEL}" stroke-width="13" stroke-linecap="round"/>',
            f'<path d="M150 -272 L214 -278" stroke="{CHROME}" stroke-width="11" stroke-linecap="round"/>',
            f'<path d="M176 -246 Q222 -236 228 -196 L202 -164 Q182 -196 162 -206 Z" fill="{body}"/>',
            '<circle cx="228" cy="-204" r="44" fill="url(#glow)"/>',
            f'<ellipse cx="224" cy="-204" rx="13" ry="19" fill="{LAMP}"/>',
            f'<path d="M188 -278 L168 -314" stroke="{STEEL}" stroke-width="5"/><ellipse cx="164" cy="-320" rx="15" ry="10" fill="{CHROME}"/>',
            '<rect x="-230" y="-128" width="36" height="16" rx="4" fill="#fb923c"/>',
        ]
    elif shape == "maxi":
        p += [
            f'<path d="M-250 -66 L-112 -58" stroke="{STEEL}" stroke-width="20" stroke-linecap="round"/>',  # the muffler
            f'<path d="M-262 -110 Q-250 -178 -150 -184 L-20 -180 L30 -118 L104 -112 Q160 -196 232 -156 L262 -100 Q216 -92 180 -108 Q128 -96 100 -70 L-118 -70 Q-170 -112 -262 -110 Z" fill="{body}"/>',
            f'<path d="M-118 -70 L100 -70 L104 -112 L30 -118 L-24 -136 L-116 -112 Z" fill="{accent}"/>',  # the tunnel between the feet
            f'<path d="M150 -262 Q250 -250 268 -170 L236 -124 Q206 -186 140 -204 Z" fill="{body}"/>',  # the nose
            '<path d="M178 -258 L214 -356 L236 -350 L252 -238 Z" fill="#a5f3fc" opacity="0.8"/>',  # the windshield
            f'<path d="M-176 -184 Q-166 -224 -104 -224 L-52 -216 Q-30 -240 24 -226 L40 -200 Q20 -180 -10 -180 L-166 -180 Z" fill="{seat}"/>',
            f'<path d="M166 -270 L226 -278" stroke="{CHROME}" stroke-width="11" stroke-linecap="round"/>',
            '<circle cx="262" cy="-176" r="44" fill="url(#glow)"/>',
            f'<ellipse cx="258" cy="-176" rx="12" ry="24" fill="{LAMP}"/>',
            f'<path d="M196 -278 L172 -318" stroke="{STEEL}" stroke-width="5"/><ellipse cx="168" cy="-324" rx="15" ry="10" fill="{CHROME}"/>',
            '<rect x="-290" y="-142" width="38" height="18" rx="4" fill="#fb923c"/>',
        ]
    else:  # retro
        p += [
            # cowl, floor and leg shield are one pressed-steel shape
            f'<path d="M-236 -70 Q-250 -186 -136 -196 L-24 -190 Q22 -152 32 -112 L108 -110 Q94 -200 146 -272 L192 -268 Q156 -180 170 -72 L-50 -72 Q-140 -52 -236 -70 Z" fill="{body}"/>',
            f'<path d="M-239 -90 Q-240 -116 -232 -126 L24 -122 L32 -100 L168 -98 L170 -72 L-50 -72 Q-140 -52 -236 -70 Z" fill="{accent}"/>',
            f'<path d="M{wb - 60} -{r + 30} Q{wb} -{2 * r + 56} {wb + 64} -{r + 38} L{wb + 42} -{r + 26} Q{wb} -{2 * r + 14} {wb - 38} -{r + 22} Z" fill="{body}"/>',  # the front fender
            f'<path d="M-158 -196 Q-146 -232 -80 -232 L-4 -226 Q14 -212 2 -194 Z" fill="{seat}"/>',
            f'<path d="M150 -286 L212 -290" stroke="{CHROME}" stroke-width="11" stroke-linecap="round"/>',
            f'<path d="M184 -290 L164 -326" stroke="{STEEL}" stroke-width="5"/><ellipse cx="160" cy="-332" rx="15" ry="10" fill="{CHROME}"/>',
            '<circle cx="-244" cy="-132" r="12" fill="#fb923c"/>',
        ]
        if light == "bar":
            p += ['<circle cx="196" cy="-262" r="46" fill="url(#glow)"/>', f'<circle cx="192" cy="-262" r="24" fill="{LAMP}"/>']
        else:
            p += ['<circle cx="180" cy="-196" r="44" fill="url(#glow)"/>', f'<ellipse cx="174" cy="-196" rx="13" ry="24" fill="{LAMP}"/>']
    p.append("</g>")
    return "".join(p)


def road() -> str:
    return (
        f'<rect x="0" y="{GROUND}" width="{W}" height="{H - GROUND}" fill="url(#road)"/>'
        f'<rect x="0" y="{GROUND}" width="{W}" height="8" fill="#463e8c"/>'
        + "".join(f'<rect x="{40 + i * 190}" y="672" width="96" height="10" fill="#565a8a" opacity="0.7"/>' for i in range(5))
    )


def moon(x: float, y: float, r: float = 44) -> str:
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fef9c3"/><circle cx="{x + r * 0.45}" cy="{y - r * 0.2}" r="{r * 0.9}" fill="#12103a"/>'


def chedi(x: float, base: float, s: float) -> str:
    """A temple spire in silhouette with a thin gold rim light (as in scene.py)."""
    body = "M-150 0 L-150 -40 L-118 -40 L-118 -74 L-92 -74 Q-88 -170 -34 -214 L-22 -262 L-12 -262 L-6 -420 L0 -470 L6 -420 L12 -262 L22 -262 L34 -214 Q88 -170 92 -74 L118 -74 L118 -40 L150 -40 L150 0 Z"
    return (
        f'<g transform="translate({x} {base}) scale({s})"><path d="{body}" fill="#5146ad"/>'
        '<path d="M0 -470 L6 -420 L12 -262 L22 -262 L34 -214 Q88 -170 92 -74" fill="none" stroke="#fbbf24" stroke-width="10" opacity="0.85"/></g>'
    )


def chiang_mai_temple() -> str:
    return (
        f'<rect width="{W}" height="{H}" fill="url(#sky)"/>'
        '<path d="M0 470 Q160 300 330 392 Q470 250 640 372 Q800 286 960 410 L960 600 L0 600 Z" fill="#231a52"/>'
        '<path d="M0 520 Q220 430 430 500 Q660 440 960 510 L960 600 L0 600 Z" fill="#2f2769"/>'
        + chedi(170, GROUND, 0.92)
        + moon(610, 100)
    )


def phuket_beach() -> str:
    palm = (
        '<path d="M120 600 Q150 420 132 250" fill="none" stroke="#4a3f8f" stroke-width="24" stroke-linecap="round"/>'
        + "".join(
            f'<path d="M132 250 Q{132 + dx * 0.55:.0f} {250 + dy - 46:.0f} {132 + dx} {250 + dy}" fill="none" stroke="#15803d" stroke-width="22" stroke-linecap="round"/>'
            for dx, dy in ((-130, 30), (-90, -70), (10, -110), (110, -60), (140, 40))
        )
    )
    return (
        f'<rect width="{W}" height="{H}" fill="url(#night)"/>'
        '<rect x="0" y="456" width="960" height="144" fill="#0f4a5c"/>'
        '<rect x="0" y="456" width="960" height="12" fill="#67e8f9" opacity="0.7"/>'
        '<rect x="560" y="500" width="260" height="10" fill="#67e8f9" opacity="0.35"/>'
        + moon(600, 120, 52)
        + palm
    )


def bangkok_towers() -> str:
    towers = [(20, 250, 120), (150, 330, 96), (262, 180, 132), (410, 300, 96), (540, 220, 110), (668, 350, 96), (780, 200, 150)]
    lit = ["#fbbf24", "#67e8f9", "#fde68a", "#f472b6"]
    out = [f'<rect width="{W}" height="{H}" fill="url(#sky)"/>']
    for n, (x, top, w) in enumerate(towers):
        out.append(f'<rect x="{x}" y="{top}" width="{w}" height="{GROUND - top}" fill="{"#231a52" if n % 2 else "#2a2163"}"/>')
        k = 0
        for wy in range(top + 24, GROUND - 60, 48):
            for wx in range(x + 18, x + w - 30, 48):
                k += 1
                if (k * 7 + n * 3) % 9 < 2 and wy < 430:
                    out.append(f'<rect x="{wx}" y="{wy}" width="24" height="24" fill="{lit[(k + n) % 4]}" opacity="0.7"/>')
    return "".join(out)


def phuket_old_town() -> str:
    """Shophouse fronts with arched openings, dimmed so the white scooter stands in front of them."""
    fronts = ["#9d5c8a", "#8f7a3c", "#3f8f86", "#6f6fb0"]
    out = [f'<rect width="{W}" height="{H}" fill="url(#night)"/>']
    for i, c in enumerate(fronts):
        x = i * 240
        out += [
            f'<rect x="{x}" y="120" width="240" height="480" fill="{c}" opacity="0.34"/>',
            f'<rect x="{x}" y="120" width="240" height="20" fill="{c}" opacity="0.8"/>',
            f'<path d="M{x + 72} 330 L{x + 72} 232 Q{x + 120} 172 {x + 168} 232 L{x + 168} 330 Z" fill="{"#fde68a" if i % 2 else "#12103a"}" opacity="0.75"/>',
            f'<rect x="{x}" y="120" width="10" height="480" fill="#12103a"/>',
        ]
    return "".join(out)


def pai_lights() -> str:
    bulbs = ["#fbbf24", "#f472b6", "#2dd4bf", "#fef9c3"]
    string = "".join(
        f'<circle cx="{60 + i * 84}" cy="{60 + 46 * (1 - ((i - 5) / 5) ** 2):.0f}" r="14" fill="{bulbs[i % 4]}"/>' for i in range(11)
    )
    return (
        f'<rect width="{W}" height="{H}" fill="url(#sky)"/>'
        '<path d="M0 420 Q200 250 400 380 Q560 270 720 360 Q850 300 960 380 L960 600 L0 600 Z" fill="#231a52"/>'
        '<path d="M0 510 Q260 400 520 490 Q760 420 960 500 L960 600 L0 600 Z" fill="#2f2769"/>'
        '<path d="M60 60 Q480 154 900 60" fill="none" stroke="#565a8a" stroke-width="5"/>'
        + string
    )


def chiang_mai_wall() -> str:
    """The old city wall: brick courses under a row of merlons, kept dim behind the scooter."""
    merlons = "".join(f'<rect x="{i * 96}" y="252" width="60" height="48" fill="#7c2d12"/>' for i in range(10))
    return (
        f'<rect width="{W}" height="{H}" fill="url(#night)"/>'
        + moon(300, 110)
        + merlons
        + '<rect x="0" y="296" width="960" height="304" fill="#7c2d12"/>'
        + "".join(f'<rect x="0" y="{344 + i * 60}" width="960" height="10" fill="#3b1206"/>' for i in range(4))
    )


#          slug                    backdrop            x    scale shape    body       accent     seat       wb   r   light
LISTINGS = [
    ("honda-click-125i", chiang_mai_temple, 540, 1.4, "sport", "#ef4444", "#fecaca", STEEL, 150, 54, "shield"),
    ("yamaha-nmax-155", phuket_beach, 520, 1.2, "maxi", "#60a5fa", "#2563eb", "#e2e8f0", 178, 56, "shield"),
    ("vespa-primavera-150", bangkok_towers, 510, 1.38, "retro", "#86efac", "#86efac", "#b45309", 140, 52, "bar"),
    ("honda-pcx-160", phuket_old_town, 500, 1.2, "maxi", "#f8fafc", "#94a3b8", "#64748b", 178, 56, "shield"),
    ("honda-scoopy", pai_lights, 520, 1.44, "retro", "#facc15", "#fef3c7", "#92400e", 130, 48, "bar"),
    ("yamaha-grand-filano", chiang_mai_wall, 510, 1.38, "retro", "#2dd4bf", "#f1f5f9", "#475569", 148, 54, "shield"),
]


def picture(backdrop, *scooter_args) -> str:
    return "\n".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
            defs(),
            backdrop(),
            road(),
            scooter(scooter_args[0], GROUND + 34, *scooter_args[1:]),
            "</svg>",
        ]
    )


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    for slug, backdrop, *args in LISTINGS:
        (out / f"{slug}.svg").write_text(picture(backdrop, *args), encoding="utf-8")
    print(f"wrote {len(LISTINGS)} pictures to {out}")

#!/usr/bin/env python3
"""KeyEscrow intro shot (under 2 s), drawn frame by frame with cairo and encoded with ffmpeg.

Story, one event per beat (120 BPM: a beat every 0.5 s):
  step 0    a scooter whips across a Bangkok night street, wavy amber/pink/teal trails; it flicks its key up
  step 1    the KeyEscrow mark (house + keyhole) pops in; a teal seal ring starts drawing round it
  step 1.5  the key drops into the keyhole: click, the seal ring closes (the deposit is locked)
  step 2    BIG HIT: "KeyEscrow" slams down with squash and stretch, shoves the mark left, camera shake
  step 2.5  tagline slides up: "Scooter deposits, held on BNB Chain"
  step 3    accent: "BNB Chain" gets an amber pill, the keyhole glints
  step 3.5  end (1.75 s at 120 BPM)

All timing lives in TIMELINE (in steps). One step = (60 / bpm) * beats_per_step seconds, shifted by --offset.
See README.md for re-rendering at another BPM.

Brand: colours from web/app/globals.css and web/app/(marketing)/landing.css (night band, amber, pink, teal),
mark from web/app/icon.svg, Kanit 500/800 (OFL) from web/app/(marketing)/fonts, street art from
web/public/marketing. Nothing third-party except the words "BNB Chain".
"""

from __future__ import annotations

import argparse
import io
import math
import os
import random
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from multiprocessing import Pool
from pathlib import Path

import cairocffi as cairo
import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------------------------- timing

# Event positions in steps (a step is one beat by default). Change these to re-choreograph.
TIMELINE = {
    "whip": 0.0,    # scooter on screen, background flash (downbeat)
    "pop": 1.0,     # mark pops in
    "snap": 1.5,    # key clicks into the keyhole, seal ring closes
    "slam": 2.0,    # wordmark slam: the big hit
    "tag": 2.5,     # tagline in
    "accent": 3.0,  # BNB Chain pill + glint
    "end": 3.5,     # last frame time (exclusive)
}

REPO = Path(__file__).resolve().parents[2]
FONT_DIR = REPO / "web/app/(marketing)/fonts"
ART_DIR = REPO / "web/public/marketing"

# Brand palette (landing.css .mk / .mk-night, globals.css, icon.svg)
NIGHT = "#0d0b2a"
NIGHT_SURFACE = "#17143f"
NIGHT_MUTED = "#201c55"
NIGHT_BORDER = "#2f2b68"
FG = "#f4f4ff"
FG_MUTED = "#cfd0ee"
AMBER = "#fbbf24"       # --mk-amber
AMBER_MARK = "#f59e0b"  # logo tile
AMBER_DEEP = "#d97706"
PINK = "#f472b6"        # --mk-pink
TEAL = "#2dd4bf"        # --mk-teal
SLATE = "#0f172a"       # logo house / --primary
SKIN = "#e0a47a"

TAGLINE = ("Scooter deposits, held on ", "BNB Chain")
PILL_GAP = 0.2  # extra space (in tagline ems) before the BNB Chain pill


def rgb(h: str, a: float = 1.0):
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, a)


@dataclass
class Clock:
    bpm: float
    beats_per_step: float
    offset: float
    fps: int
    duration: float

    @property
    def step(self) -> float:
        return 60.0 / self.bpm * self.beats_per_step

    def at(self, name: str) -> float:
        return self.offset + TIMELINE[name] * self.step

    @property
    def frames(self) -> int:
        return int(round(self.duration * self.fps))


# ---------------------------------------------------------------------------------------------- easing

def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, u):
    return a + (b - a) * u


def prog(t, t0, t1):
    return clamp((t - t0) / (t1 - t0)) if t1 != t0 else float(t >= t0)


def ease_out_cubic(u):
    return 1 - (1 - u) ** 3


def ease_in_cubic(u):
    return u ** 3


def ease_in_out(u):
    return 3 * u * u - 2 * u * u * u


def ease_out_back(u, s=1.9):
    u -= 1
    return 1 + u * u * ((s + 1) * u + s)


def spring(dt, amp, freq=4.5, decay=9.0):
    """Damped cosine after an impact at dt=0 (0 before)."""
    if dt < 0:
        return 0.0
    return amp * math.exp(-decay * dt) * math.cos(2 * math.pi * freq * dt)


def flash(t, t0, decay=0.12):
    return math.exp(-(t - t0) / decay) if t >= t0 else 0.0


# ---------------------------------------------------------------------------------------------- fonts

class _OpsPen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.ops = []

    def _moveTo(self, p):
        self.ops.append(("M", p))

    def _lineTo(self, p):
        self.ops.append(("L", p))

    def _curveToOne(self, p1, p2, p3):
        self.ops.append(("C", p1, p2, p3))

    def _qCurveToOne(self, p1, p2):
        p0 = self._getCurrentPoint()
        c1 = (p0[0] + 2 / 3 * (p1[0] - p0[0]), p0[1] + 2 / 3 * (p1[1] - p0[1]))
        c2 = (p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1]))
        self.ops.append(("C", c1, c2, p2))

    def _closePath(self):
        self.ops.append(("Z",))


class Font:
    def __init__(self, path: Path):
        tt = TTFont(str(path))
        tt.flavor = None
        buf = io.BytesIO()
        tt.save(buf)
        self.data = buf.getvalue()
        self.tt = TTFont(io.BytesIO(self.data))
        self.upem = self.tt["head"].unitsPerEm
        self.cap = self.tt["OS/2"].sCapHeight
        self.glyph_set = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self._ops = {}
        try:
            import uharfbuzz as hb

            self._hb = hb.Font(hb.Face(hb.Blob(self.data)))
            self._hbmod = hb
        except ImportError:  # fall back to cmap + hmtx (no kerning)
            self._hb = None

    def ops(self, gid):
        if gid not in self._ops:
            pen = _OpsPen(self.glyph_set)
            self.glyph_set[self.order[gid]].draw(pen)
            self._ops[gid] = pen.ops
        return self._ops[gid]

    def shape(self, text):
        """[(gid, x, advance)] in font units."""
        out, x = [], 0
        if self._hb:
            hb = self._hbmod
            buf = hb.Buffer()
            buf.add_str(text)
            buf.guess_segment_properties()
            hb.shape(self._hb, buf, {"kern": True, "liga": True})
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
                out.append((info.codepoint, x + pos.x_offset, pos.x_advance))
                x += pos.x_advance
        else:
            cmap = self.tt.getBestCmap()
            for ch in text:
                name = cmap[ord(ch)]
                adv = self.tt["hmtx"][name][0]
                out.append((self.order.index(name), x, adv))
                x += adv
        return out

    def width(self, text, size):
        g = self.shape(text)
        return (g[-1][1] + g[-1][2]) * size / self.upem if g else 0


def glyph_path(ctx, font: Font, gid, x, y, size):
    """Append glyph gid with its origin (baseline) at x, y."""
    s = size / font.upem
    for op in font.ops(gid):
        if op[0] == "M":
            ctx.move_to(x + op[1][0] * s, y - op[1][1] * s)
        elif op[0] == "L":
            ctx.line_to(x + op[1][0] * s, y - op[1][1] * s)
        elif op[0] == "C":
            (a, b), (c, d), (e, f) = op[1], op[2], op[3]
            ctx.curve_to(x + a * s, y - b * s, x + c * s, y - d * s, x + e * s, y - f * s)
        else:
            ctx.close_path()


def text_path(ctx, font, text, x, y, size):
    for gid, gx, _ in font.shape(text):
        glyph_path(ctx, font, gid, x + gx * size / font.upem, y, size)


# ---------------------------------------------------------------------------------------------- layout

@dataclass
class Layout:
    W: int
    H: int
    vertical: bool
    mark_size: float
    mark_pre: tuple       # centre of the mark before the slam
    mark_final: tuple     # centre after the slam
    word_size: float
    word_x: float         # left of the wordmark
    word_base: float      # baseline y
    tag_size: float
    tag_lines: list       # [(x, baseline, [(text, is_accent)])]
    road_y: float
    scooter_scale: float


def make_layout(W, H, fonts) -> Layout:
    bold, reg = fonts["bold"], fonts["reg"]
    vertical = H > W
    word = "KeyEscrow"
    if not vertical:
        M = 0.215 * H
        F = 0.185 * H
        ww = bold.width(word, F)
        gap = 0.045 * H
        gw = M + gap + ww
        cy = 0.44 * H
        left = (W - gw) / 2
        mark_final = (left + M / 2, cy)
        word_x = left + M + gap
        word_base = cy + bold.cap * F / bold.upem / 2
        ts = 0.052 * H
        tw = reg.width(TAGLINE[0], ts) + PILL_GAP * ts + reg.width(TAGLINE[1], ts)
        tag_lines = [((W - tw) / 2, word_base + 0.14 * H, [(TAGLINE[0], False), (TAGLINE[1], True)])]
        return Layout(W, H, False, M, (W / 2, cy), mark_final, F, word_x, word_base, ts, tag_lines,
                      road_y=0.88 * H, scooter_scale=H / 1080 * 1.0)
    M = 0.30 * W
    F = 0.86 * W / (bold.width(word, 100) / 100)
    cy = 0.42 * H
    ts = 0.062 * W
    word_base = cy + M / 2 + 0.06 * H + bold.cap * F / bold.upem
    l1, l2 = "Scooter deposits,", "held on "
    w1 = reg.width(l1, ts)
    w2 = reg.width(l2, ts) + PILL_GAP * ts + reg.width(TAGLINE[1], ts)
    tb = word_base + 0.075 * H
    tag_lines = [((W - w1) / 2, tb, [(l1, False)]), ((W - w2) / 2, tb + 1.3 * ts, [(l2, False), (TAGLINE[1], True)])]
    return Layout(W, H, True, M, (W / 2, cy + 0.02 * H), (W / 2, cy), F, (W - bold.width(word, F)) / 2, word_base,
                  ts, tag_lines, road_y=0.80 * H, scooter_scale=W / 1080 * 0.62)


# ---------------------------------------------------------------------------------------------- shapes

def rounded_rect(ctx, x, y, w, h, r):
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    ctx.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 1.5 * math.pi)
    ctx.close_path()


def capsule(ctx, pts, width, color):
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_line_join(cairo.LINE_JOIN_ROUND)
    ctx.set_line_width(width)
    ctx.move_to(*pts[0])
    for p in pts[1:]:
        ctx.line_to(*p)
    ctx.set_source_rgba(*rgb(color))
    ctx.stroke()


def draw_mark(ctx, size, keyhole=AMBER_MARK, keyhole_glow=0.0, shadow=True):
    """The KeyEscrow mark (web/app/icon.svg), centred on 0,0."""
    s = size / 64
    ctx.save()
    ctx.translate(-size / 2, -size / 2)
    if shadow:  # stepped hard shadow, the groovy extrude
        for k in range(1, 9):
            ctx.save()
            ctx.translate(k * size * 0.0065, k * size * 0.008)
            rounded_rect(ctx, 0, 0, size, size, 14 * s)
            ctx.set_source_rgba(*rgb(PINK))
            ctx.fill()
            ctx.restore()
    rounded_rect(ctx, 0, 0, size, size, 14 * s)
    ctx.set_source_rgba(*rgb(AMBER_MARK))
    ctx.fill()
    ctx.scale(s, s)
    ctx.move_to(32, 12)
    for p in [(10, 30), (16, 30), (16, 51), (48, 51), (48, 30), (54, 30)]:
        ctx.line_to(*p)
    ctx.close_path()
    ctx.set_source_rgba(*rgb(SLATE))
    ctx.fill()
    ctx.arc(32, 35, 6, 0, 2 * math.pi)
    ctx.move_to(29.5, 38)
    for p in [(34.5, 38), (36, 47), (28, 47)]:
        ctx.line_to(*p)
    ctx.close_path()
    ctx.set_source_rgba(*rgb(keyhole))
    ctx.fill()
    if keyhole_glow > 0:
        g = cairo.RadialGradient(32, 37, 0, 32, 37, 22)
        g.add_color_stop_rgba(0, 1, 1, 1, min(1, keyhole_glow))
        g.add_color_stop_rgba(0.35, *rgb(AMBER, 0.6 * min(1, keyhole_glow)))
        g.add_color_stop_rgba(1, *rgb(AMBER, 0))
        ctx.arc(32, 37, 22, 0, 2 * math.pi)
        ctx.set_source(g)
        ctx.fill()
    ctx.restore()


def draw_key(ctx, L, color=FG, shadow=PINK):
    """A key pointing down, its tip at 0,0, length L (bow up top)."""
    s = L / 160

    def shape(dx, dy):
        ctx.save()
        ctx.translate(dx, dy)
        ctx.scale(s, s)
        ctx.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
        ctx.new_path()
        ctx.arc(0, -128, 32, 0, 2 * math.pi)
        ctx.close_path()
        ctx.new_sub_path()
        ctx.arc(0, -128, 14, 0, 2 * math.pi)
        ctx.close_path()
        ctx.fill()
        ctx.set_fill_rule(cairo.FILL_RULE_WINDING)
        rounded_rect(ctx, -9, -100, 18, 100, 6)
        ctx.fill()
        rounded_rect(ctx, 4, -42, 24, 14, 4)
        ctx.fill()
        rounded_rect(ctx, 4, -20, 18, 14, 4)
        ctx.fill()
        ctx.restore()

    ctx.set_source_rgba(*rgb(shadow))
    shape(L * 0.03, L * 0.035)
    ctx.set_source_rgba(*rgb(color))
    shape(0, 0)


def draw_wheel(ctx, cx, cy, r, spin):
    ctx.arc(cx, cy, r, 0, 2 * math.pi)
    ctx.set_source_rgba(*rgb(SLATE))
    ctx.fill_preserve()
    ctx.set_line_width(r * 0.16)
    ctx.set_source_rgba(*rgb(FG_MUTED))
    ctx.stroke()
    ctx.set_line_width(r * 0.09)
    ctx.set_source_rgba(*rgb(NIGHT_BORDER))
    for k in range(3):
        a = spin + k * 2 * math.pi / 3
        ctx.move_to(cx, cy)
        ctx.line_to(cx + math.cos(a) * r * 0.78, cy + math.sin(a) * r * 0.78)
        ctx.stroke()
    ctx.arc(cx, cy, r * 0.36, 0, 2 * math.pi)
    ctx.set_source_rgba(*rgb(AMBER))
    ctx.fill()


# Anchor points (scooter-local, ground at y=0, facing +x) for the trails and the key launch.
SCOOTER_ANCHORS = {"helmet": (-50, -362), "back": (-120, -285), "tail": (-248, -110), "hand": (122, -300)}


def draw_scooter(ctx, spin, beam=1.0):
    """Original flat scooter + rider, facing right. Local units: ~500 long, ~400 tall."""
    # headlight beam
    if beam > 0:
        g = cairo.LinearGradient(175, 0, 640, 0)
        g.add_color_stop_rgba(0, *rgb("#fff3c4", 0.42 * beam))
        g.add_color_stop_rgba(1, *rgb("#fff3c4", 0))
        ctx.move_to(175, -262)
        ctx.line_to(640, -330)
        ctx.line_to(640, -130)
        ctx.close_path()
        ctx.set_source(g)
        ctx.fill()
    draw_wheel(ctx, -150, -48, 48, spin)
    draw_wheel(ctx, 168, -46, 46, spin * 1.05)
    # far leg (darker)
    capsule(ctx, [(-100, -196), (20, -196), (52, -108)], 30, "#b9bbe0")
    # rear cowl
    ctx.move_to(-248, -78)
    ctx.curve_to(-256, -148, -186, -176, -110, -172)
    ctx.curve_to(-48, -170, -18, -150, -14, -112)
    ctx.line_to(-20, -78)
    ctx.close_path()
    ctx.set_source_rgba(*rgb(AMBER_MARK))
    ctx.fill()
    # cowl highlight
    ctx.move_to(-226, -110)
    ctx.curve_to(-224, -146, -180, -160, -120, -158)
    ctx.set_line_width(7)
    ctx.set_source_rgba(*rgb(AMBER, 0.9))
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.stroke()
    # tail light
    rounded_rect(ctx, -258, -126, 16, 26, 6)
    ctx.set_source_rgba(*rgb(PINK))
    ctx.fill()
    # seat
    rounded_rect(ctx, -212, -192, 170, 24, 11)
    ctx.set_source_rgba(*rgb(SLATE))
    ctx.fill()
    # floorboard
    ctx.move_to(-30, -94)
    ctx.line_to(112, -94)
    ctx.line_to(118, -74)
    ctx.line_to(-34, -74)
    ctx.close_path()
    ctx.set_source_rgba(*rgb(AMBER_DEEP))
    ctx.fill()
    # torso
    capsule(ctx, [(-112, -214), (-58, -300)], 58, TEAL)
    # near leg + shoe
    capsule(ctx, [(-104, -206), (34, -206), (62, -112)], 34, FG)
    rounded_rect(ctx, 44, -116, 46, 20, 9)
    ctx.set_source_rgba(*rgb(SLATE))
    ctx.fill()
    # leg shield + steering column
    ctx.move_to(92, -80)
    ctx.curve_to(84, -150, 104, -230, 132, -296)
    ctx.line_to(166, -296)
    ctx.curve_to(170, -210, 170, -132, 152, -80)
    ctx.close_path()
    ctx.set_source_rgba(*rgb(AMBER_MARK))
    ctx.fill()
    # front fender
    ctx.move_to(112, -70)
    ctx.curve_to(120, -116, 218, -116, 226, -70)
    ctx.line_to(208, -70)
    ctx.curve_to(200, -98, 138, -98, 130, -70)
    ctx.close_path()
    ctx.set_source_rgba(*rgb(AMBER))
    ctx.fill()
    # arm
    capsule(ctx, [(-58, -296), (40, -262), (118, -298)], 24, TEAL)
    ctx.arc(122, -298, 13, 0, 2 * math.pi)
    ctx.set_source_rgba(*rgb(SKIN))
    ctx.fill()
    # handlebar
    capsule(ctx, [(110, -306), (176, -312)], 10, SLATE)
    # headlight
    ctx.arc(172, -266, 17, 0, 2 * math.pi)
    ctx.set_source_rgba(*rgb("#fff7d6"))
    ctx.fill()
    # helmet + visor
    ctx.save()
    ctx.arc(-22, -362, 40, 0, 2 * math.pi)
    ctx.set_source_rgba(*rgb(PINK))
    ctx.fill_preserve()
    ctx.clip()
    rounded_rect(ctx, -2, -378, 52, 22, 10)
    ctx.set_source_rgba(*rgb(NIGHT))
    ctx.fill()
    ctx.rectangle(-70, -350, 120, 6)
    ctx.set_source_rgba(*rgb("#ffffff", 0.35))
    ctx.fill()
    ctx.restore()


# ---------------------------------------------------------------------------------------------- scene

class Scene:
    def __init__(self, W, H, clock: Clock, background: bool):
        self.W, self.H, self.clock = W, H, clock
        self.fonts = {"bold": Font(FONT_DIR / "kanit-800-latin.woff2"), "reg": Font(FONT_DIR / "kanit-500-latin.woff2")}
        self.L = make_layout(W, H, self.fonts)
        self.background = background
        rnd = random.Random(7)
        self.streaks = [(rnd.random(), rnd.uniform(0.08, 0.92), rnd.uniform(0.6, 1.6), rnd.choice([FG, FG, AMBER, TEAL, PINK]))
                        for _ in range(26)]
        self.burst = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.8, 1.3), rnd.choice([AMBER, PINK, TEAL, FG])) for _ in range(18)]
        self.sparks = [(k * 2 * math.pi / 8 + rnd.uniform(-0.2, 0.2), rnd.uniform(0.8, 1.2)) for k in range(8)]
        self.word_glyphs = None
        self._bg_cache = None

    # ---- timing helpers
    def T(self, name):
        return self.clock.at(name)

    @property
    def f(self):  # one frame in seconds
        return 1.0 / self.clock.fps

    # ---- scooter
    def scooter_u(self, t):
        t0 = self.T("whip") - 0.1 * self.clock.step
        t1 = self.T("whip") + 0.9 * self.clock.step
        return (t - t0) / (t1 - t0)

    def scooter_pose(self, t):
        u = self.scooter_u(t)
        k = 0.72  # fast at the edges, slower mid-frame so it reads
        x = u + k * math.sin(2 * math.pi * u) / (2 * math.pi)
        L = self.L
        X = lerp(-0.32 * L.W, 1.32 * L.W, x) if not L.vertical else lerp(-0.6 * L.W, 1.6 * L.W, x)
        Y = L.road_y - abs(math.sin(u * 9)) * 6 * L.scooter_scale
        tilt = -0.05 * math.cos(2 * math.pi * u)  # leans back when fast
        return X, Y, tilt, u

    def scooter_point(self, t, name):
        X, Y, tilt, _ = self.scooter_pose(t)
        ax, ay = SCOOTER_ANCHORS[name]
        s = self.L.scooter_scale
        c, sn = math.cos(tilt), math.sin(tilt)
        return X + s * (ax * c - ay * sn), Y + s * (ax * sn + ay * c)

    def draw_trails(self, ctx, t):
        lag = 0.42 * self.clock.step
        specs = [("helmet", PINK, 26, 0.0), ("back", TEAL, 30, 1.7), ("tail", AMBER, 34, 3.1)]
        s = self.L.scooter_scale
        for name, col, wdt, ph in specs:
            n = 28
            pts = []
            for i in range(n + 1):
                a = i / n
                tt = t - a * lag
                if self.scooter_u(tt) < -0.05:
                    break
                x, y = self.scooter_point(tt, name)
                y += math.sin(a * 2 * math.pi * 1.4 + ph + t * 12) * 22 * s * a
                pts.append((x, y, a))
            if len(pts) < 2:
                continue
            for i in range(len(pts) - 1):
                (x0, y0, a0), (x1, y1, _) = pts[i], pts[i + 1]
                ctx.set_line_cap(cairo.LINE_CAP_ROUND)
                ctx.set_line_width(max(1.0, wdt * s * (1 - a0) ** 0.8))
                ctx.set_source_rgba(*rgb(col, 0.95 * (1 - a0) ** 1.2))
                ctx.move_to(x0, y0)
                ctx.line_to(x1, y1)
                ctx.stroke()

    def draw_streaks(self, ctx, t):
        t0, t1 = self.T("whip") - 0.05, self.T("whip") + 1.15 * self.clock.step
        if not (t0 <= t <= t1):
            return
        u = prog(t, t0, t1)
        env = math.sin(math.pi * u)
        W, H = self.L.W, self.L.H
        for (ox, oy, sp, col) in self.streaks:
            x = ((ox - u * 2.6 * sp) % 1.3 - 0.15) * W
            y = (0.25 + 0.65 * oy) * H
            ln = 0.14 * W * sp
            ctx.set_line_width(3 * self.L.scooter_scale + 1)
            g = cairo.LinearGradient(x, 0, x + ln, 0)
            g.add_color_stop_rgba(0, *rgb(col, 0.55 * env))
            g.add_color_stop_rgba(1, *rgb(col, 0))
            ctx.set_source(g)
            ctx.move_to(x, y)
            ctx.line_to(x + ln, y)
            ctx.stroke()

    # ---- mark
    def mark_state(self, t):
        """centre, scale x/y, rotation, visible."""
        L, f = self.L, self.f
        tp, ts, tl = self.T("pop"), self.T("snap"), self.T("slam")
        if t < tp - 4 * f:
            return None
        if t < tp:
            s = 1.22 * ease_out_cubic(prog(t, tp - 4 * f, tp))
            rot = -0.25 * (1 - prog(t, tp - 4 * f, tp))
        else:
            s = 1 + spring(t - tp, 0.22, 3.6, 9)
            rot = spring(t - tp, -0.08, 2.4, 7)
        sx = sy = s
        # click squash on the snap
        q = spring(t - ts, 0.14, 4.2, 10)
        sx *= 1 + q
        sy *= 1 - q
        # shoved by the wordmark
        u = ease_out_back(prog(t, tl - 4 * f, tl + 5 * f), 1.6)
        cx = lerp(L.mark_pre[0], L.mark_final[0], u)
        cy = lerp(L.mark_pre[1], L.mark_final[1], u)
        rot += spring(t - tl, 0.12, 3.0, 8) * (0 if L.vertical else 1)
        if L.vertical:
            q2 = spring(t - tl, 0.1, 4.0, 10)
            sx *= 1 + q2
            sy *= 1 - q2
        return (cx, cy), sx, sy, rot

    def keyhole_at(self, centre, size):
        return centre[0], centre[1] + size * (35 - 32) / 64

    def draw_mark_layer(self, ctx, t):
        st = self.mark_state(t)
        if not st:
            return
        (cx, cy), sx, sy, rot = st
        M = self.L.mark_size
        ts, ta = self.T("snap"), self.T("accent")
        glow = flash(t, ts, 0.1) * 1.2 + flash(t, ta, 0.09) * 0.8
        keyhole = AMBER_MARK
        if ts <= t < ts + 0.08:
            keyhole = FG
        ctx.save()
        ctx.translate(cx, cy + M / 2)  # squash from the bottom edge
        ctx.rotate(rot)
        ctx.scale(sx, sy)
        ctx.translate(0, -M / 2)
        draw_mark(ctx, M, keyhole, glow)
        ctx.restore()
        # glint on the accent beat: a four-point star at the tile's top-right corner
        g = flash(t, ta, 0.11) if t >= ta else 0
        if g > 0.02:
            gx, gy = cx + M * 0.42, cy - M * 0.42
            r = M * 0.28 * (0.6 + 0.4 * g)
            ctx.set_source_rgba(1, 1, 1, g)
            ctx.move_to(gx, gy - r)
            for a, rr in [(0, r * 0.12), (1, r), (2, r * 0.12), (3, r), (4, r * 0.12), (5, r), (6, r * 0.12)]:
                ang = -math.pi / 2 + (a + 1) * math.pi / 4
                ctx.line_to(gx + math.cos(ang) * rr, gy + math.sin(ang) * rr)
            ctx.close_path()
            ctx.fill()

    def draw_seal(self, ctx, t):
        """Teal ring drawing round the mark between pop and snap, then a shockwave."""
        st = self.mark_state(t)
        if not st:
            return
        (cx, cy), *_ = st
        M = self.L.mark_size
        tp, ts = self.T("pop"), self.T("snap")
        R = M * 0.86
        if tp + 2 * self.f <= t < ts:
            u = ease_in_out(prog(t, tp + 2 * self.f, ts))
            a0 = -math.pi / 2
            ctx.set_line_width(M * 0.035)
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            ctx.set_source_rgba(*rgb(TEAL, 0.95))
            ctx.arc(cx, cy, R, a0, a0 + u * 2 * math.pi)
            ctx.stroke()
            hx, hy = cx + R * math.cos(a0 + u * 2 * math.pi), cy + R * math.sin(a0 + u * 2 * math.pi)
            ctx.arc(hx, hy, M * 0.035, 0, 2 * math.pi)
            ctx.set_source_rgba(1, 1, 1, 1)
            ctx.fill()
        if t >= ts:
            v = prog(t, ts, ts + 0.32 * self.clock.step / 0.5)
            if v < 1:
                ctx.set_line_width(M * 0.035 * (1 - v) + 0.5)
                ctx.set_source_rgba(*rgb(TEAL if v > 0.08 else FG, (1 - v) ** 1.5))
                ctx.arc(cx, cy, R * (1 + 0.55 * ease_out_cubic(v)), 0, 2 * math.pi)
                ctx.stroke()
            # click sparks
            v2 = prog(t, ts, ts + 0.16)
            if v2 < 1:
                for a, k in self.sparks:
                    r0 = R * (1.02 + 0.25 * ease_out_cubic(v2) * k)
                    r1 = r0 + M * 0.16 * (1 - v2)
                    ctx.set_line_width(M * 0.025)
                    ctx.set_source_rgba(*rgb(AMBER, 1 - v2))
                    ctx.move_to(cx + r0 * math.cos(a), cy + r0 * math.sin(a))
                    ctx.line_to(cx + r1 * math.cos(a), cy + r1 * math.sin(a))
                    ctx.stroke()
        # pop shockwave
        v = prog(t, tp, tp + 0.2)
        if tp <= t and v < 1:
            ctx.set_line_width(M * 0.05 * (1 - v))
            ctx.set_source_rgba(*rgb(AMBER, 0.8 * (1 - v)))
            ctx.arc(cx, cy, M * (0.6 + 0.6 * ease_out_cubic(v)), 0, 2 * math.pi)
            ctx.stroke()

    # ---- key
    def draw_key_layer(self, ctx, t):
        f = self.f
        tl_ = self.scooter_launch_time()
        ts = self.T("snap")
        tin = ts - 4 * f
        if t < tl_ or t >= ts:
            return
        M = self.L.mark_size
        L0 = 0.17 * min(self.L.W, self.L.H)
        L1 = M * 0.5
        st = self.mark_state(min(t, tin)) or self.mark_state(self.T("pop"))
        kx, ky = self.keyhole_at(st[0], M)
        if t < tin:
            u = prog(t, tl_, tin)
            ue = ease_in_out(u)
            p0 = self.scooter_point(tl_, "hand")
            p3 = (kx, ky)
            up = 0.36 * min(self.L.W, self.L.H)
            p1 = (p0[0] + 0.1 * self.L.W, p0[1] - 1.1 * up)
            p2 = (p3[0], p3[1] - up)
            b = [(1 - ue) ** 3, 3 * ue * (1 - ue) ** 2, 3 * ue * ue * (1 - ue), ue ** 3]
            x = sum(w * p[0] for w, p in zip(b, (p0, p1, p2, p3)))
            y = sum(w * p[1] for w, p in zip(b, (p0, p1, p2, p3)))
            rot = (1 - ue) ** 2 * 2.5 * math.pi
            Lk = lerp(L0, L1, ue)
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(rot)
            draw_key(ctx, Lk)
            ctx.restore()
        else:  # slide in: the shaft disappears into the keyhole
            v = ease_in_cubic(prog(t, tin, ts))
            ctx.save()
            ctx.rectangle(0, 0, self.L.W, ky)
            ctx.clip()
            ctx.translate(kx, ky + v * L1 * 0.85)
            draw_key(ctx, L1)
            ctx.restore()

    def scooter_launch_time(self):
        return self.T("whip") + 0.42 * self.clock.step

    # ---- wordmark
    def word_layout(self):
        if self.word_glyphs is None:
            bold, L = self.fonts["bold"], self.L
            s = L.word_size / bold.upem
            self.word_glyphs = [(gid, L.word_x + gx * s, adv * s) for gid, gx, adv in bold.shape("KeyEscrow")]
        return self.word_glyphs

    def draw_word(self, ctx, t):
        L, f = self.L, self.f
        tl = self.T("slam")
        if t < tl - 5 * f:
            return
        bold = self.fonts["bold"]
        gl = self.word_layout()
        x0 = gl[0][1]
        x1 = gl[-1][1] + gl[-1][2]
        ax, ay = (x0 + x1) / 2, L.word_base
        if t < tl:  # falling, stretched
            u = prog(t, tl - 5 * f, tl)
            e = ease_in_cubic(u)
            dy = -(1 - e) * 0.12 * L.H
            z = lerp(1.8, 1.0, e)  # flies at the camera... then lands
            sy, sx = z * lerp(1.35, 1.12, e), z * lerp(0.8, 0.94, e)
            alpha = clamp(u * 2.2)
        else:
            dt = t - tl
            q = spring(dt, 0.3, 3.4, 8.5)
            sy = 1 - q
            sx = 1 + q * 0.75
            dy = 0
            alpha = 1
        split = 3  # "Key" | "Escrow"
        cap = bold.cap * L.word_size / bold.upem
        for layer in ("shadow", "fill"):
            for i, (gid, gx, adv) in enumerate(gl):
                hop = 0.0
                if t >= tl:  # groovy ripple after the slam
                    hop = math.sin(math.pi * clamp((t - (tl + 5 * f + i * 1.3 * f)) / (0.13 * self.clock.step / 0.5)))
                    hop *= 0.075 * cap
                ctx.save()
                ctx.translate(ax, ay + dy)
                ctx.scale(sx, sy)
                ctx.translate(-ax, -ay)
                if layer == "shadow":
                    ctx.set_source_rgba(*rgb(PINK, alpha))
                    for k in range(1, 9):
                        glyph_path(ctx, bold, gid, gx + k * cap * 0.0085, ay - hop + k * cap * 0.011, L.word_size)
                    ctx.fill()
                else:
                    glyph_path(ctx, bold, gid, gx, ay - hop, L.word_size)
                    ctx.set_source_rgba(*rgb(FG if i < split else AMBER, alpha))
                    ctx.fill()
                ctx.restore()

    def draw_burst(self, ctx, t):
        tl = self.T("slam")
        v = prog(t, tl, tl + 0.24)
        if t < tl or v >= 1:
            return
        L = self.L
        gl = self.word_layout()
        x0, x1 = gl[0][1], gl[-1][1] + gl[-1][2]
        cx, cy = (x0 + x1) / 2, L.word_base - 0.35 * L.word_size
        span = (x1 - x0) / 2
        for a, k, col in self.burst:
            r0 = span * (0.75 + 0.6 * ease_out_cubic(v) * k)
            r1 = r0 + span * 0.28 * (1 - v) * k
            ex, ey = math.cos(a), math.sin(a) * 0.55
            ctx.set_line_width(max(1, 9 * (1 - v) * L.H / 1080))
            ctx.set_line_cap(cairo.LINE_CAP_ROUND)
            ctx.set_source_rgba(*rgb(col, 1 - v))
            ctx.move_to(cx + ex * r0, cy + ey * r0)
            ctx.line_to(cx + ex * r1, cy + ey * r1)
            ctx.stroke()
        # impact dust at the baseline ends
        for side in (-1, 1):
            for j in range(4):
                px = (x0 if side < 0 else x1) + side * (0.02 + 0.09 * ease_out_cubic(v) * (j + 1) / 4) * L.word_size * 2
                py = L.word_base - (0.05 + 0.1 * j) * L.word_size * ease_out_cubic(v)
                ctx.arc(px, py, L.word_size * (0.05 + 0.03 * j) * (1 - v * 0.5), 0, 2 * math.pi)
                ctx.set_source_rgba(*rgb(FG_MUTED, 0.5 * (1 - v)))
                ctx.fill()

    # ---- tagline
    def draw_tagline(self, ctx, t):
        L, f = self.L, self.f
        tt, ta = self.T("tag"), self.T("accent")
        if t < tt - 2 * f:
            return
        reg = self.fonts["reg"]
        ts = L.tag_size
        idx = 0
        pill_u = ease_out_cubic(prog(t, ta - f, ta + 4 * f))
        for (lx, base, parts) in L.tag_lines:
            x = lx
            for text, accent in parts:
                if accent:
                    x += PILL_GAP * ts
                # stagger per word
                words = text.split(" ")
                for wi, w in enumerate(words):
                    if not w:
                        continue
                    u = prog(t, tt - 2 * f + idx * 1.2 * f, tt + 6 * f + idx * 1.2 * f)
                    e = ease_out_back(u, 1.6)
                    dy = (1 - e) * ts * 1.1
                    a = clamp(u * 2.5)
                    ww = reg.width(w, ts)
                    if accent and pill_u > 0:
                        full = reg.width(text.strip(), ts)
                        if wi == 0:
                            padx, pady = ts * 0.26, ts * 0.2
                            pop = 1 + spring(t - ta, 0.08, 4, 10)
                            ctx.save()
                            cxp = x + full / 2
                            ctx.translate(cxp, base - ts * 0.33)
                            ctx.scale(pop, pop)
                            ctx.translate(-cxp, -(base - ts * 0.33))
                            rounded_rect(ctx, x - padx, base - reg.cap * ts / reg.upem - pady,
                                         (full + 2 * padx) * pill_u, reg.cap * ts / reg.upem + 2 * pady + ts * 0.02, ts * 0.32)
                            ctx.set_source_rgba(*rgb(AMBER))
                            ctx.fill()
                            ctx.restore()
                    # shadow for keying over footage
                    text_path(ctx, reg, w, x + ts * 0.05, base + dy + ts * 0.07, ts)
                    ctx.set_source_rgba(*rgb(NIGHT, 0.8 * a))
                    ctx.fill()
                    text_path(ctx, reg, w, x, base + dy, ts)
                    col = FG if accent else FG_MUTED
                    if accent and pill_u > 0.5:
                        col = NIGHT
                    ctx.set_source_rgba(*rgb(col, a))
                    ctx.fill()
                    x += ww
                    if wi < len(words) - 1:  # a trailing space in the text keeps its gap
                        x += reg.width(" ", ts)
                    idx += 1

    def blur_boost(self, t):
        """Sub-frame multiplier: the whip and the slam move hundreds of px per frame."""
        f = self.f
        if self.T("slam") - 6 * f <= t <= self.T("slam") + 4 * f:
            return 4
        if t <= self.T("whip") + 1.0 * self.clock.step or self.T("pop") - 4 * f <= t <= self.T("pop") + 2 * f:
            return 2
        return 1

    # ---- shake
    def shake(self, t):
        dx = dy = 0.0
        for name, amp in (("whip", 6), ("pop", 7), ("snap", 5), ("slam", 22)):
            t0 = self.T(name)
            if t >= t0:
                e = math.exp(-(t - t0) / 0.055) * amp * self.L.H / 1080
                ph = (t - t0) * 2 * math.pi * 26
                dx += e * math.sin(ph + len(name))
                dy += e * math.cos(ph * 1.3)
        return dx, dy

    # ---- foreground (everything that goes into the alpha version)
    def draw_fg(self, ctx, t):
        dx, dy = self.shake(t)
        ctx.save()
        ctx.translate(dx, dy)
        self.draw_streaks(ctx, t)
        u = self.scooter_u(t)
        if -0.05 <= u <= 1.05 or u < 1.6:
            self.draw_trails(ctx, t)
        if -0.05 <= u <= 1.02:
            X, Y, tilt, _ = self.scooter_pose(t)
            ctx.save()
            ctx.translate(X, Y)
            ctx.rotate(tilt)
            s = self.L.scooter_scale
            ctx.scale(s, s)
            draw_scooter(ctx, spin=t * 60)
            ctx.restore()
        self.draw_seal(ctx, t)
        self.draw_mark_layer(ctx, t)
        self.draw_key_layer(ctx, t)
        self.draw_burst(ctx, t)
        self.draw_word(ctx, t)
        self.draw_tagline(ctx, t)
        ctx.restore()

    # ---- background (full version only)
    def bg_assets(self):
        if self._bg_cache is None:
            W, H = self.W, self.H
            name = "street-tall-1200.webp" if self.L.vertical else "street-wide-2400.webp"
            img = Image.open(ART_DIR / name).convert("RGB")
            sc = max(W * 1.12 / img.width, H * 1.06 / img.height)
            img = img.resize((int(img.width * sc), int(img.height * sc)), Image.LANCZOS)
            street = surface_from_pil(img)
            # LED dot grid
            grid = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
            g = cairo.Context(grid)
            step = round(H / 1080 * 24) if not self.L.vertical else round(W / 1080 * 24)
            r = step * 0.11
            for yy in range(step // 2, H, step):
                for xx in range(step // 2, W, step):
                    g.arc(xx, yy, r, 0, 2 * math.pi)
                    g.new_sub_path()
            g.set_source_rgba(1, 1, 1, 1)
            g.fill()
            self._bg_cache = (street, grid)
        return self._bg_cache

    def draw_bg(self, ctx, t):
        W, H, L = self.W, self.H, self.L
        street, grid = self.bg_assets()
        dx, dy = self.shake(t)
        ctx.set_source_rgba(*rgb(NIGHT))
        ctx.paint()
        # street art, panning with the scooter, dimming as the logo takes over
        pan = ease_out_cubic(prog(t, self.T("whip"), self.T("end")))
        ox = -(street.get_width() - W) * (0.15 + 0.7 * pan) + dx * 0.6
        oy = -(street.get_height() - H) * 0.5 + dy * 0.6
        dim = lerp(0.62, 0.2, ease_in_out(prog(t, self.T("pop") - 0.1, self.T("slam"))))
        dim += 0.18 * flash(t, self.T("whip"), 0.1)
        ctx.set_source_surface(street, ox, oy)
        ctx.paint_with_alpha(dim)
        # night scrim, lighter in the middle
        cx, cy = W / 2, L.mark_final[1] if not L.vertical else H * 0.45
        g = cairo.RadialGradient(cx, cy, 0, cx, cy, max(W, H) * 0.75)
        g.add_color_stop_rgba(0, *rgb(NIGHT_SURFACE, 0.25))
        g.add_color_stop_rgba(1, *rgb(NIGHT, 0.85))
        ctx.set_source(g)
        ctx.paint()
        # beat pulses on the dot grid
        pulse = 0.0
        for name, amp in (("whip", 0.5), ("pop", 0.35), ("snap", 0.25), ("slam", 0.8), ("accent", 0.3)):
            pulse += amp * flash(t, self.T(name), 0.12)
        ctx.set_source_rgba(*rgb(NIGHT_BORDER, 0.55))
        ctx.mask_surface(grid, 0, 0)
        if pulse > 0.01:
            gg = cairo.RadialGradient(cx, cy, 0, cx, cy, max(W, H) * 0.6)
            gg.add_color_stop_rgba(0, *rgb(AMBER, min(1, pulse)))
            gg.add_color_stop_rgba(1, *rgb(PINK, 0.25 * min(1, pulse)))
            ctx.set_source(gg)
            ctx.mask_surface(grid, 0, 0)
        # warm glow behind the lockup after the slam
        glow = 0.22 * prog(t, self.T("slam") - 0.02, self.T("slam") + 0.15) + 0.35 * flash(t, self.T("slam"), 0.15)
        if glow > 0:
            gg = cairo.RadialGradient(cx, cy, 0, cx, cy, W * 0.45)
            gg.add_color_stop_rgba(0, *rgb(AMBER_DEEP, glow))
            gg.add_color_stop_rgba(1, *rgb(AMBER_DEEP, 0))
            ctx.set_source(gg)
            ctx.paint()


def surface_from_pil(img: Image.Image):
    a = np.asarray(img.convert("RGBA"), dtype=np.uint8)
    bgra = np.ascontiguousarray(a[:, :, [2, 1, 0, 3]])
    h, w = bgra.shape[:2]
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
    stride = surf.get_stride()
    buf = np.frombuffer(surf.get_data(), dtype=np.uint8).reshape(h, stride)
    buf[:, : w * 4] = bgra.reshape(h, w * 4)
    surf.mark_dirty()
    return surf


def surface_to_array(surf):
    h, w, stride = surf.get_height(), surf.get_width(), surf.get_stride()
    surf.flush()
    a = np.frombuffer(surf.get_data(), dtype=np.uint8).reshape(h, stride)[:, : w * 4].reshape(h, w, 4)
    return a.astype(np.float32)


# ---------------------------------------------------------------------------------------------- frame rendering

_SCENE: Scene | None = None


def _init(W, H, clock, background, subsamples, shutter):
    global _SCENE, _SUB, _SHUTTER
    _SCENE = Scene(W, H, clock, background)
    _SUB, _SHUTTER = subsamples, shutter


def render_frame(i):
    """Returns (straight-alpha RGBA bytes of the foreground, RGB bytes of the full frame)."""
    sc = _SCENE
    W, H = sc.W, sc.H
    fps = sc.clock.fps
    acc = np.zeros((H, W, 4), np.float32)
    n = _SUB * sc.blur_boost(i / fps)
    for k in range(n):  # motion blur: average sub-frames over the shutter (premultiplied, so this is exact)
        # shutter opens at the frame time, so an event's own frame shows its impact pose, not a blend with the frame before
        t = (i + (k + 0.5) / n * _SHUTTER) / fps
        surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
        ctx = cairo.Context(surf)
        sc.draw_fg(ctx, t)
        acc += surface_to_array(surf)
    acc /= n
    fg_pm = acc  # BGRA premultiplied, 0..255
    alpha = fg_pm[:, :, 3:4]
    straight = np.where(alpha > 0, fg_pm[:, :, :3] * 255.0 / np.maximum(alpha, 1e-6), 0)
    rgba = np.concatenate([straight[:, :, [2, 1, 0]], alpha], axis=2)
    rgba = np.clip(rgba + 0.5, 0, 255).astype(np.uint8)
    full = None
    if sc.background:
        bg = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
        sc.draw_bg(cairo.Context(bg), i / fps)
        b = surface_to_array(bg)
        out = fg_pm + b * (1 - alpha / 255.0)
        full = np.clip(out[:, :, [2, 1, 0]] + 0.5, 0, 255).astype(np.uint8).tobytes()
    return rgba.tobytes(), full


# ---------------------------------------------------------------------------------------------- encoding

def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed: {' '.join(cmd[:6])} ...")


def render(W, H, clock, out_mp4: Path | None, png_dir: Path | None, subsamples, shutter, workers, keep_frames: Path | None = None):
    ff = ffmpeg_exe()
    enc = None
    if out_mp4:
        enc = subprocess.Popen(
            [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(clock.fps),
             "-i", "-", "-vf", "scale=out_color_matrix=bt709:out_range=tv", "-c:v", "libx264", "-preset", "slow", "-crf", "14",
             "-pix_fmt", "yuv420p", "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709",
             "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
             "-movflags", "+faststart", str(out_mp4)],
            stdin=subprocess.PIPE)
    if png_dir:
        if png_dir.exists():
            shutil.rmtree(png_dir)
        png_dir.mkdir(parents=True)
    if keep_frames:
        keep_frames.mkdir(parents=True, exist_ok=True)
    n = clock.frames
    with Pool(workers, initializer=_init, initargs=(W, H, clock, out_mp4 is not None, subsamples, shutter)) as pool:
        for i, (rgba, full) in enumerate(pool.imap(render_frame, range(n))):
            if png_dir:
                Image.frombytes("RGBA", (W, H), rgba).save(png_dir / f"intro_{i:04d}.png", compress_level=4)
            if enc and full:
                enc.stdin.write(full)
                if keep_frames:
                    Image.frombytes("RGB", (W, H), full).save(keep_frames / f"f_{i:04d}.png", compress_level=1)
            print(f"\r  {W}x{H} frame {i + 1}/{n}", end="", flush=True)
    print()
    if enc:
        enc.stdin.close()
        if enc.wait():
            raise SystemExit("ffmpeg (h264) failed")


def contact_sheet(frames_dir: Path, clock: Clock, out: Path):
    """Six frames: one per event, labelled with frame number and time."""
    names = ["whip", "pop", "snap", "slam", "tag", "accent"]
    picks = []
    for nm in names:
        t = clock.at(nm)
        # a few frames after each event, where it reads best (the last one is the final frame)
        delay = {"whip": 0.2, "pop": 0.06, "snap": 0.03, "slam": 0.05, "tag": 0.12}.get(nm, None)
        i = clock.frames - 1 if delay is None else int(round((t + delay) * clock.fps))
        picks.append((nm, min(i, clock.frames - 1)))
    thumbs = []
    for nm, i in picks:
        im = Image.open(frames_dir / f"f_{i:04d}.png").convert("RGB")
        im.thumbnail((640, 640), Image.LANCZOS)
        thumbs.append((nm, i, im))
    tw, th = thumbs[0][2].size
    pad, lab = 12, 34
    sheet = Image.new("RGB", (3 * tw + 4 * pad, 2 * (th + lab) + 3 * pad), NIGHT)
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(io.BytesIO(Font(FONT_DIR / "kanit-500-latin.woff2").data), 22)
    except Exception:
        font = ImageFont.load_default()
    for k, (nm, i, im) in enumerate(thumbs):
        x = pad + (k % 3) * (tw + pad)
        y = pad + (k // 3) * (th + lab + pad)
        sheet.paste(im, (x, y))
        d.text((x + 2, y + th + 4), f"{nm}  ·  frame {i}  ·  {i / clock.fps:.3f}s", fill=FG_MUTED, font=font)
    sheet.save(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bpm", type=float, default=120)
    ap.add_argument("--beats-per-step", type=float, default=1, help="beats between events (0.5 = double time, 2 = half time)")
    ap.add_argument("--offset", type=float, default=0, help="seconds before the first beat (downbeat) in the clip")
    ap.add_argument("--fps", type=int, default=60)
    ap.add_argument("--duration", type=float, default=None, help="seconds; default = the 'end' event")
    ap.add_argument("--out", type=Path, default=Path("/home/orcasrv/visuals/keyescrow/intro"))
    ap.add_argument("--only", default="all", help="comma list of: main,alpha,vertical,gif,contact")
    ap.add_argument("--subsamples", type=int, default=6, help="motion-blur sub-frames per frame")
    ap.add_argument("--shutter", type=float, default=0.5, help="shutter as a fraction of a frame (0.5 = 180 degrees)")
    ap.add_argument("--scale", type=float, default=1.0, help="draft renders: 0.5 = half resolution")
    ap.add_argument("--stills", default="", help="comma list of frame numbers: write only those frames as PNG (full + alpha) and exit")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    a = ap.parse_args()

    step = 60.0 / a.bpm * a.beats_per_step
    dur = a.duration if a.duration else a.offset + TIMELINE["end"] * step
    clock = Clock(a.bpm, a.beats_per_step, a.offset, a.fps, dur)
    only = set(a.only.split(",")) if a.only != "all" else {"main", "alpha", "vertical", "gif", "contact"}
    out: Path = a.out
    out.mkdir(parents=True, exist_ok=True)
    ff = ffmpeg_exe()
    W, H = int(1920 * a.scale) // 2 * 2, int(1080 * a.scale) // 2 * 2
    frames_tmp = out / ".frames_1080"

    print(f"KeyEscrow intro: {a.bpm:g} BPM, step {step:.4f}s, {dur:.3f}s, {clock.frames} frames @ {a.fps}fps")
    for nm in ("whip", "pop", "snap", "slam", "tag", "accent", "end"):
        t = clock.at(nm)
        print(f"  {nm:7s} {t:6.3f}s  frame {t * a.fps:6.1f}")

    if a.stills:
        for vert in (False, True):
            w, h = (W, H) if not vert else (H, W)
            _init(w, h, clock, True, a.subsamples, a.shutter)
            for i in [int(x) for x in a.stills.split(",")]:
                rgba, full = render_frame(i)
                tag = "v" if vert else "h"
                Image.frombytes("RGB", (w, h), full).save(out / f"still_{tag}_{i:04d}.png")
                Image.frombytes("RGBA", (w, h), rgba).save(out / f"still_{tag}_{i:04d}_alpha.png")
        print("stills written to", out)
        return

    need_main = bool(only & {"main", "alpha", "gif", "contact"})
    if need_main:
        render(W, H, clock, out / "intro_1080p60.mp4" if only & {"main", "gif", "contact"} else None,
               out / "intro_alpha_png" if "alpha" in only else None, a.subsamples, a.shutter, a.workers,
               keep_frames=frames_tmp if "contact" in only else None)
    if "alpha" in only:
        run([ff, "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", str(out / "intro_alpha_png/intro_%04d.png"),
             "-vf", "scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16",
             "-vendor", "apl0", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
             str(out / "intro_alpha.mov")])
    if "alpha" in only:
        import zipfile

        seq = out / "intro_alpha_png"
        with zipfile.ZipFile(out / "intro_alpha_png.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for fp in sorted(seq.glob("*.png")):
                z.write(fp, f"intro_alpha_png/{fp.name}")
    if "vertical" in only:
        VW, VH = int(1080 * a.scale) // 2 * 2, int(1920 * a.scale) // 2 * 2
        render(VW, VH, clock, out / "intro_vertical_1080x1920.mp4", None, a.subsamples, a.shutter, a.workers)
    if "gif" in only:
        gif = out / "intro_preview.gif"
        for width, fps in ((640, 30), (560, 25), (480, 20)):
            run([ff, "-y", "-loglevel", "error", "-i", str(out / "intro_1080p60.mp4"), "-vf",
                 f"fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=200[p];"
                 f"[b][p]paletteuse=dither=sierra2_4a", "-loop", "0", str(gif)])
            if gif.stat().st_size < 5_000_000:
                break
    if "contact" in only:
        contact_sheet(frames_tmp, clock, out / "contact.png")
        shutil.rmtree(frames_tmp, ignore_errors=True)
    print("done:", out)


if __name__ == "__main__":
    main()

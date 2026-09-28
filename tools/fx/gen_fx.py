"""Bake procedural effect sprite sheets (transparent WebP) for POLYGON DUEL.

Everything is generated from math (polar fields, fractal noise, gaussian glow), so the
look matches the polygon world and can be re-tuned by editing numbers here.

  python3 tools/fx/gen_fx.py            # writes public/fx/*.webp + public/fx/fx.json
  python3 tools/fx/gen_fx.py --preview  # also writes a contact sheet for review

Sheets named *_t are white (tinted at runtime with the character color);
others are baked in color (skill-specific effects).
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'fx')
rng = np.random.default_rng(1234)
MANIFEST = {}


# ───────────────────────── helpers ─────────────────────────

def grid(size):
    c = (size - 1) / 2
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (x - c) / c
    y = (y - c) / c
    r = np.sqrt(x * x + y * y)
    th = np.arctan2(y, x)
    return x, y, r, th


def gauss(v, w):
    return np.exp(-(v / w) ** 2)


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(size, octaves=4, seed=0, base=4):
    """Fractal value noise in [0,1]."""
    g = np.random.default_rng(seed)
    acc = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = base * (2 ** o)
        small = g.random((n, n)).astype(np.float32)
        acc += amp * cv2.resize(small, (size, size), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= 0.5
    acc /= tot
    return np.clip((acc - acc.min()) / (acc.max() - acc.min() + 1e-6), 0, 1)


def polar_noise(size, th, r, seed, ang_freq=12, rad_freq=6, t=0.0):
    """Noise sampled in polar space (for flames / swirls)."""
    n = fbm(256, 4, seed, 4)
    u = ((th / (2 * np.pi) + 0.5) * ang_freq) % 1.0
    v = (r * rad_freq / 6 + t) % 1.0
    xi = (u * 255).astype(np.int32)
    yi = (v * 255).astype(np.int32)
    return n[yi, xi]


def blur(a, px):
    if px <= 0:
        return a
    k = int(px) * 2 + 1
    return cv2.GaussianBlur(a, (k, k), px / 2)


def glowify(core, spread, strength=1.0):
    """Add a soft bloom around a sharp mask."""
    size = core.shape[0]
    return np.clip(core + strength * blur(core, spread * size / 256) * 1.2 + 0.6 * strength * blur(core, spread * 3 * size / 256), 0, None)


def rgba(intensity, color=(1, 1, 1), white_core=0.0):
    """Intensity field → RGBA. white_core pushes the brightest parts toward white."""
    i = np.clip(intensity, 0, None)
    a = np.clip(i, 0, 1)
    col = np.array(color, np.float32)[None, None, :]
    w = np.clip((i - 1.0) * white_core + (white_core * 0.25) * i, 0, 1)[..., None]
    rgb = col * (1 - w) + w
    return np.dstack([np.clip(rgb, 0, 1), a])


def save_lo(img, name):
    """Half-resolution copy for phones (public/fx/lo/): 1/4 of the GPU memory.
    Frame sizes are even, so an exact 2x box reduce never bleeds across frames."""
    os.makedirs(os.path.join(OUT, 'lo'), exist_ok=True)
    img.reduce(2).save(os.path.join(OUT, 'lo', f'{name}.webp'), 'WEBP', quality=75, method=6, alpha_quality=80)


def save(name, frames, fps=60, tint=False, anchor=(0.5, 0.5), scale_hint=1.0):
    n = len(frames)
    size = frames[0].shape[0]
    cols = int(math.ceil(math.sqrt(n)))
    rows = int(math.ceil(n / cols))
    sheet = np.zeros((rows * size, cols * size, 4), np.float32)
    for k, f in enumerate(frames):
        r, c = divmod(k, cols)
        sheet[r * size:(r + 1) * size, c * size:(c + 1) * size] = f
    img = Image.fromarray((np.clip(sheet, 0, 1) * 255).astype(np.uint8), 'RGBA')
    path = os.path.join(OUT, f'{name}.webp')
    img.save(path, 'WEBP', quality=72, method=6, alpha_quality=80)
    save_lo(img, name)
    MANIFEST[name] = {
        'file': f'{name}.webp', 'size': size, 'count': n, 'cols': cols, 'fps': fps,
        'tint': tint, 'anchor': list(anchor), 'scale': scale_hint,
    }
    print(f'{name:14s} {n:2d}f {size}px  {os.path.getsize(path) / 1024:6.1f} KB')


def ease_out(t):
    return 1 - (1 - t) ** 3


# ───────────────────────── effects ─────────────────────────

def slash(size=512, n=12):
    """70° swing smear, right→left in local space (+y = right side of facing).
    Sprite center = attacker. The arc band spans radius 0.30..1.0 of the reach.
    Frames 0-2 sweep in, then the trail fades & thins."""
    x, y, r, th = grid(size)
    half = math.radians(35)
    frames, cores = [], []
    tex = fbm(size, 3, 7, 6)
    for k in range(n):
        sweep = min(1.0, (k + 1) / 3)
        fade = 1.0 if k < 3 else max(0.0, 1 - (k - 2) / (n - 3))
        head = half - 2 * half * sweep            # current blade angle (starts at +35°)
        # angular extent covered: from +half down to head
        ang = th
        inside = (ang <= half + 0.05) & (ang >= head - 0.02)
        # brightness is strongest near the blade head, tailing off behind it
        dist_head = np.clip((ang - head) / (2 * half + 1e-6), 0, 1)
        tail = np.exp(-dist_head * (2.5 + 4 * (1 - fade)))
        band = smooth(0.52, 0.8, r) * (1 - smooth(0.94, 1.0, r))   # crescent near the tip path
        edge = gauss(r - 0.97, 0.03)                    # bright outer edge = blade tip path
        streak = 0.6 + 0.4 * tex
        body = inside * band * tail * streak * (0.35 + 0.3 * fade)
        tip = inside * edge * tail * 1.6
        inten = (body * 0.9 + tip) * fade
        glow = glowify(inten, 5, 0.6)
        frames.append(rgba(glow))
        cores.append(rgba(np.clip(tip * 1.3 + body * 0.35, 0, 1.4) * fade))
    save('slash_t', frames, tint=True)
    save('slash_core', cores)


def spin(size=384, n=12):
    """Full-circle spin slash (3rd hit)."""
    x, y, r, th = grid(size)
    frames, cores = [], []
    tex = fbm(size, 3, 11, 8)
    for k in range(n):
        p = min(1.0, (k + 1) / 4)                     # 4 frames to complete the circle
        fade = 1.0 if k < 4 else max(0.0, 1 - (k - 3) / (n - 4))
        head = np.pi - 2 * np.pi * p                  # from behind, clockwise-negative
        rel = (th - head) % (2 * np.pi)               # 0 at head, grows behind it
        covered = rel <= 2 * np.pi * p + 0.02
        tail = np.exp(-rel / (2 * np.pi) * (2.2 + 3 * (1 - fade)))
        band = smooth(0.5, 0.68, r) * (1 - smooth(0.92, 1.0, r))
        edge = gauss(r - 0.96, 0.04)
        body = covered * band * tail * (0.35 + 0.25 * tex)
        tip = covered * edge * tail * 1.7
        inten = (body * 0.85 + tip) * fade
        # expanding pressure ring at the end
        ring = gauss(r - (0.9 + 0.12 * max(0, k - 3) / n), 0.03) * (0.6 * fade if k >= 3 else 0)
        frames.append(rgba(glowify(inten + ring, 6, 0.7)))
        cores.append(rgba(np.clip(tip * 1.3 + body * 0.3, 0, 1.4) * fade))
    save('spin_t', frames, tint=True)
    save('spin_core', cores)


def burst(size=256, n=10, name='hit_t', rays=10, heavy=False):
    x, y, r, th = grid(size)
    frames = []
    ang_jit = rng.random(rays) * 0.4
    lens = 0.6 + rng.random(rays) * 0.4
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        inten = np.zeros_like(r)
        # central flash
        inten += gauss(r, 0.18 + 0.25 * e) * (1 - t) ** 2 * 2.2
        # rays
        for i in range(rays):
            a = 2 * np.pi * i / rays + ang_jit[i]
            d = np.abs(np.angle(np.exp(1j * (th - a))))
            width = 0.07 * (1 - t) + 0.01
            reach = lens[i] * (0.35 + 0.65 * e)
            ray = gauss(d * r / (width + 1e-3), 1.0) * smooth(0.05, 0.12, r) * (1 - smooth(reach * 0.7, reach, r))
            inten += ray * (1 - t) * 1.3
        # ring
        inten += gauss(r - (0.25 + 0.7 * e), 0.03 + 0.03 * t) * (1 - t) * (1.4 if heavy else 0.9)
        if heavy:
            inten += gauss(r - (0.15 + 0.5 * e), 0.06) * (1 - t) * 0.6
        frames.append(rgba(glowify(inten, 4, 0.5), white_core=0.8))
    save(name, frames, tint=True)


def guard_hex(size=320, n=12):
    """Honeycomb shield flash: impact on the +x side, ripple crosses the lattice."""
    x, y, r, th = grid(size)
    # hex lattice distance field
    s = 0.13
    q = (2 / 3 * x) / s
    rr = (-1 / 3 * x + math.sqrt(3) / 3 * y) / s
    # cube round
    cx, cz = q, rr
    cy = -cx - cz
    rx, ry, rz = np.round(cx), np.round(cy), np.round(cz)
    dx, dy, dz = np.abs(rx - cx), np.abs(ry - cy), np.abs(rz - cz)
    fx = np.where((dx > dy) & (dx > dz), -ry - rz, rx)
    fz = np.where(~((dx > dy) & (dx > dz)) & ~(dy > dz), -rx - ry, rz)
    hx = (fx * 1.5) * s
    hy = ((fx / 2 + fz) * math.sqrt(3)) * s
    lx, ly = x - hx, y - hy
    # distance to hex cell edge (flat-top hexagon of circumradius s)
    ax, ay = np.abs(lx), np.abs(ly)
    hexd = np.maximum(ax * 0.5 + ay * math.sqrt(3) / 2, ax)
    edge = gauss(s * 0.94 - hexd, 0.012)
    dome = 1 - smooth(0.82, 0.98, r)
    rim = gauss(r - 0.9, 0.03)
    imp = np.sqrt((x - 0.85) ** 2 + y ** 2)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        wave = gauss(imp - (0.05 + 1.9 * ease_out(t)), 0.12)
        flash = gauss(imp, 0.25 + 0.3 * t) * (1 - t) ** 2 * 1.8
        cells = edge * dome * (0.25 * (1 - t) + 1.3 * wave)
        fill = dome * (0.10 * (1 - t) + 0.25 * wave)
        inten = cells + fill + rim * (0.8 * (1 - t)) + flash
        frames.append(rgba(glowify(inten, 3, 0.5), white_core=0.6))
    save('guard_t', frames, tint=True)


def ripple(size=384, n=16):
    """Attacker-side shock ripple (3rd hit): bright crest + dark trough rings."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        inten = np.zeros_like(r)
        for j, delay in enumerate((0, 0.18, 0.36)):
            tt = np.clip((t - delay) / (1 - delay), 0, 1)
            if tt <= 0:
                continue
            rad = 0.1 + 0.88 * ease_out(tt)
            w = 0.025 + 0.04 * tt
            crest = gauss(r - rad, w)
            inner = gauss(r - rad + w * 2.2, w * 1.4) * 0.35
            inten += (crest + inner) * (1 - tt) ** 1.4 * (1.3 - 0.3 * j)
        frames.append(rgba(glowify(inten, 4, 0.5), white_core=0.5))
    save('ripple_t', frames, tint=True)


def shatter(size=320, n=14):
    """Guard crush: radial cracks + glass shards + gold flash (baked)."""
    x, y, r, th = grid(size)
    nc = 11
    angs = np.sort(rng.random(nc) * 2 * np.pi)
    frames = []
    shards = [(rng.random() * 2 * np.pi, 0.2 + rng.random() * 0.2, 0.03 + rng.random() * 0.04, rng.random() * 6) for _ in range(26)]
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        inten = gauss(r, 0.2 + 0.5 * e) * (1 - t) ** 2 * 2.5
        for a in angs:
            d = np.abs(np.angle(np.exp(1j * (th - a))))
            jag = 0.012 * np.sin(r * 40 + a * 7)
            crack = gauss((d + jag) * r, 0.006 + 0.004 * (1 - t)) * (r < 0.25 + 0.75 * e) * (r > 0.04)
            inten += crack * (1 - t) * 1.6
        inten += gauss(r - (0.3 + 0.65 * e), 0.025) * (1 - t) * 1.5
        # flying shards (little triangles)
        for (a, r0, sz, spin_) in shards:
            rad = r0 + e * 0.75
            cx, cy = math.cos(a) * rad, math.sin(a) * rad
            ang = spin_ + t * 8
            px, py = x - cx, y - cy
            u = px * math.cos(ang) + py * math.sin(ang)
            v = -px * math.sin(ang) + py * math.cos(ang)
            tri = (v > -sz * 0.5) & (np.abs(u) < (sz - (v + sz * 0.5)) * 0.6)
            inten += tri * (1 - t) * 1.2
        rgba_ = rgba(glowify(inten, 3, 0.6), (1.0, 0.78, 0.25), white_core=0.9)
        frames.append(rgba_)
    save('crush', frames)


def just_flash(size=320, n=16):
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        inten = gauss(r - (0.1 + 0.85 * e), 0.02 + 0.03 * t) * (1 - t) * 1.6
        inten += gauss(r - (0.05 + 0.6 * e), 0.05) * (1 - t) * 0.5
        # 4-point star glint
        star = (gauss(y, 0.012 + 0.01 * (1 - t)) * gauss(x, 0.5 * (1 - t) + 0.05) + gauss(x, 0.012 + 0.01 * (1 - t)) * gauss(y, 0.5 * (1 - t) + 0.05))
        inten += star * (1 - t) ** 0.7 * 2.2
        # sparkles
        for i in range(10):
            a = i * 0.628 + 0.3
            rad = 0.2 + 0.7 * e * (0.6 + 0.4 * ((i * 37) % 10) / 10)
            cx, cy = math.cos(a) * rad, math.sin(a) * rad
            inten += gauss(np.sqrt((x - cx) ** 2 + (y - cy) ** 2), 0.02) * (1 - t) * 1.5
        frames.append(rgba(glowify(inten, 4, 0.7), (0.43, 0.95, 1.0), white_core=0.9))
    save('just', frames)


def ko_blast(size=384, n=18):
    x, y, r, th = grid(size)
    frames = []
    nz = fbm(size, 4, 21, 5)
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        rad = 0.15 + 0.8 * e
        pn = polar_noise(size, th, r, 5, 16, 4, t * 0.5)
        fire = (1 - smooth(rad * (0.7 + 0.3 * pn), rad, r)) * (1 - t) ** 1.5 * (0.6 + 0.6 * nz)
        inten = fire * 1.4 + gauss(r, 0.3) * (1 - t) ** 3 * 3
        inten += gauss(r - (0.2 + 0.8 * e), 0.02) * (1 - t) * 1.8
        frames.append(rgba(glowify(inten, 5, 0.6), (1.0, 0.85, 0.7), white_core=1.0))
    save('ko', frames)


def dust(size=256, n=14):
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        pn = polar_noise(size, th, r, 9, 10, 3, t)
        ring = gauss(r - (0.3 + 0.55 * e), 0.1 + 0.05 * t) * (0.5 + 0.8 * pn)
        inten = ring * (1 - t) ** 1.3 * 0.8
        frames.append(rgba(blur(inten, 4), (0.62, 0.68, 0.85)))
    save('dust', frames)


# ── skill-specific (baked colors) ──

def flare(size=256, n=16):
    """Blaze S1: flame burst (used as dash trail puffs and the hit explosion)."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        pn = polar_noise(size, th, r, 3, 9, 5, t * 1.2)
        pn2 = polar_noise(size, th, r, 4, 5, 3, t * 0.7)
        rad = 0.25 + 0.7 * e
        e0 = rad * (0.5 + 0.35 * pn)
        shape = 1 - smooth(e0, e0 + rad * (0.18 + 0.12 * pn2), r)
        heat = shape * (1 - t) ** 1.2
        core = gauss(r, 0.2 + 0.25 * e) * (1 - t) ** 2
        inten = heat * (0.8 + 0.6 * pn) + core * 1.6
        # color ramp: dark red → orange → yellow → white
        i = np.clip(inten, 0, 2)
        rch = np.clip(i * 1.6, 0, 1)
        gch = np.clip(i * 1.1 - 0.25, 0, 1)
        bch = np.clip(i * 0.9 - 0.9, 0, 1)
        a = np.clip(inten * 1.2, 0, 1)
        frames.append(np.dstack([rch, gch, bch, a]))
    save('flare', frames)


def fang(size=384, n=14):
    """Blaze S2 Break Fang: two jaws of teeth snapping shut toward +x."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        close = min(1.0, t / 0.35)
        fade = 1.0 if t < 0.45 else max(0, 1 - (t - 0.45) / 0.55)
        gap = 0.55 * (1 - ease_out(close))
        inten = np.zeros_like(r)
        for side in (-1, 1):
            base = side * (gap + 0.05)
            for i in range(5):
                tx0 = -0.55 + i * 0.28
                # tooth: triangle pointing toward the center line
                px, py = x - tx0, (y - base) * side
                tooth = (py < 0) & (py > -0.28) & (np.abs(px) < (0.12 * (1 + py / 0.28)) * 1.0 + 0.0) & (np.abs(px) < 0.12)
                tooth = (py > -0.3) & (py < 0) & (np.abs(px) < 0.13 * (-py / 0.3) + 0.01 * 0)
                tooth = (py <= 0) & (py > -0.3) & (np.abs(px) < 0.13 * (py + 0.3) / 0.3)
                inten += tooth * 1.2
            jaw = gauss((y - side * (gap + 0.33)) * side, 0.04) * (np.abs(x) < 0.75)
            inten += jaw * 1.0
        snap = gauss(np.sqrt(x ** 2 + y ** 2), 0.2 + 0.3 * max(0, t - 0.35)) * (1.8 if 0.3 < t < 0.6 else 0) * fade
        inten = inten * fade + snap
        frames.append(rgba(glowify(inten, 4, 0.8), (1.0, 0.62, 0.15), white_core=0.8))
    save('fang', frames)


def gale(size=512, n=14):
    """Zephyr S1 Gale Pierce: a spiral wind lance along +x (sprite left edge = attacker)."""
    x, y, r, th = grid(size)
    X = (x + 1) / 2  # 0..1 along the lance
    frames = []
    for k in range(n):
        t = k / (n - 1)
        reach = min(1.0, (k + 1) / 3)
        fade = 1.0 if k < 3 else max(0, 1 - (k - 2) / (n - 3))
        width = 0.12 * (1 - X * 0.6) + 0.02
        spiral = 0.5 + 0.5 * np.sin(X * 38 - t * 30 + np.arctan2(y, 0.08) * 3)
        body = gauss(y, width) * (X < reach) * (0.5 + 0.8 * spiral)
        core = gauss(y, 0.02) * (X < reach) * 1.6
        tip = gauss(np.sqrt(((X - reach) * 3) ** 2 + (y * 4) ** 2), 0.25) * 2.0 * (1 if k < 4 else 0.3)
        inten = (body + core + tip) * fade
        frames.append(rgba(glowify(inten, 4, 0.6), (0.45, 1.0, 0.72), white_core=0.8))
    save('gale', frames, anchor=(0.0, 0.5))


def breeze(size=256, n=16):
    """Zephyr S2 Breeze: rising healing wind swirl with leaves (loop)."""
    x, y, r, th = grid(size)
    frames = []
    leaves = [(rng.random() * 2 * np.pi, 0.3 + rng.random() * 0.55, rng.random()) for _ in range(18)]
    for k in range(n):
        t = k / n
        swirl = 0.5 + 0.5 * np.sin(th * 3 + r * 10 - t * 2 * np.pi * 2)
        band = gauss(r - 0.62, 0.18)
        inten = band * swirl * 0.8
        inten += gauss(r - 0.9, 0.03) * (0.4 + 0.3 * np.sin(t * 2 * np.pi))
        for (a0, rad, ph) in leaves:
            a = a0 + t * 2 * np.pi * 0.5
            yy = ((ph + t) % 1.0)
            cx = math.cos(a) * rad
            cy = math.sin(a) * rad * 0.5 + 0.6 - 1.4 * yy
            px, py = x - cx, y - cy
            leaf = gauss(np.sqrt((px * 1.0) ** 2 + (py * 2.2) ** 2), 0.03) * math.sin(math.pi * yy)
            inten += leaf * 1.5
        frames.append(rgba(glowify(inten, 3, 0.6), (0.55, 1.0, 0.75), white_core=0.6))
    save('breeze', frames, fps=30)


def riposte(size=320, n=14):
    """Bastion S1 counter: mirror hexagon flash + reflected lightning."""
    x, y, r, th = grid(size)
    frames = []
    ax, ay = np.abs(x), np.abs(y)
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        s = 0.35 + 0.5 * e
        hexd = np.maximum(ax * 0.5 + ay * math.sqrt(3) / 2, ax)  # flat-top hexagon
        ring = gauss(hexd - s, 0.02 + 0.02 * t) * (1 - t) * 1.8
        inner = (hexd < s) * (1 - t) ** 3 * 0.35
        inten = ring + inner
        # lightning bolts toward +x (the attacker side)
        for b in range(3):
            yy = (b - 1) * 0.25
            path = yy + 0.07 * np.sin(x * 23 + b * 3 + t * 20) + 0.04 * np.sin(x * 51 + b)
            bolt = gauss(y - path, 0.012 + 0.01 * (1 - t)) * (x > 0.1) * (x < 0.1 + 0.9 * min(1, t * 3))
            inten += bolt * (1 - t) * 1.6
        inten += gauss(r, 0.15) * (1 - t) ** 2 * 1.5
        frames.append(rgba(glowify(inten, 4, 0.7), (0.55, 0.75, 1.0), white_core=0.9))
    save('riposte', frames)


def bash(size=384, n=14):
    """Bastion S2 Shield Bash: an impact wall / shock cone toward +x."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        front = 0.1 + 0.8 * e
        wall = gauss(x - front, 0.03 + 0.05 * t) * gauss(y, 0.35 + 0.3 * e) * (1 - t) * 2.6
        cone = (np.abs(th) < 0.6) * gauss(r - front * 0.9, 0.08) * (1 - t) * 0.6
        streaks = (np.abs(th) < 0.7) * gauss(np.sin(th * 18), 0.15) * smooth(0.1, 0.3, r) * (r < front) * (1 - t) * 0.7
        inten = wall + cone + streaks + gauss(r, 0.2) * (1 - t) ** 3 * 1.2
        frames.append(rgba(glowify(inten, 4, 0.6), (0.5, 0.7, 1.0), white_core=0.8))
    save('bash', frames)


def danger(size=256, n=16, name='danger', color=(1.0, 0.72, 0.2)):
    """Triangle (guard break) startup: pulsing warning aura (loop)."""
    x, y, r, th = grid(size)
    frames = []
    ax, ay = x, y
    for k in range(n):
        t = k / n
        # triangle distance (pointing +x)
        tri = np.maximum.reduce([
            ax * math.cos(0) + ay * math.sin(0),
            ax * math.cos(2.094) + ay * math.sin(2.094),
            ax * math.cos(-2.094) + ay * math.sin(-2.094),
        ])
        pulse = (t * 2) % 1.0
        ring = gauss(tri - (0.35 + 0.45 * pulse), 0.03) * (1 - pulse) * 1.5
        base = gauss(tri - 0.35, 0.05) * (0.6 + 0.4 * math.sin(t * 2 * np.pi * 2))
        inten = ring + base
        frames.append(rgba(glowify(inten, 4, 0.7), color, white_core=0.5))
    save(name, frames, fps=30)


def stun(size=256, n=16):
    """Dizzy spiral (loop)."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / n
        sp = 0.5 + 0.5 * np.cos(th * 2 - np.log(r + 0.05) * 5 + t * 2 * np.pi)
        inten = sp ** 6 * gauss(r - 0.5, 0.3) * (r > 0.12) * 1.1
        frames.append(rgba(glowify(inten, 2, 0.4), (1.0, 0.9, 0.35), white_core=0.4))
    save('stun', frames, fps=30)


def charge(size=256, n=16):
    """Attack wind-up: energy converging to the center (tinted)."""
    x, y, r, th = grid(size)
    frames = []
    pts = [(rng.random() * 2 * np.pi, 0.6 + rng.random() * 0.4) for _ in range(14)]
    for k in range(n):
        t = k / (n - 1)
        inten = gauss(r, 0.08 + 0.1 * t) * t * 1.6
        for (a, r0) in pts:
            rad = r0 * (1 - ease_out(t))
            cx, cy = math.cos(a) * rad, math.sin(a) * rad
            d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            inten += gauss(d, 0.025) * 1.4
            # streak toward center
            inten += gauss(np.abs(np.angle(np.exp(1j * (th - a)))) * r, 0.01) * (r < r0) * (r > rad) * 0.5
        frames.append(rgba(glowify(inten, 3, 0.5), white_core=0.7))
    save('charge_t', frames, tint=True)


def contact_sheet():
    """Preview: first sheet frames on a dark background."""
    tiles = []
    for name, m in MANIFEST.items():
        img = Image.open(os.path.join(OUT, m['file'])).convert('RGBA')
        s = m['size']
        picks = [0, m['count'] // 4, m['count'] // 2, (3 * m['count']) // 4]
        row = Image.new('RGBA', (4 * 160, 160), (8, 11, 20, 255))
        for i, f in enumerate(picks):
            r_, c_ = divmod(f, m['cols'])
            fr = img.crop((c_ * s, r_ * s, c_ * s + s, r_ * s + s)).resize((160, 160))
            if m['tint']:
                arr = np.array(fr).astype(np.float32)
                arr[..., 0] *= 1.0
                arr[..., 1] *= 0.45
                arr[..., 2] *= 0.3
                fr = Image.fromarray(arr.astype(np.uint8), 'RGBA')
            row.alpha_composite(fr, (i * 160, 0))
        tiles.append(row)
    sheet = Image.new('RGBA', (640, 160 * len(tiles)), (8, 11, 20, 255))
    for i, t in enumerate(tiles):
        sheet.alpha_composite(t, (0, i * 160))
    out = sys.argv[sys.argv.index('--preview') + 1] if len(sys.argv) > sys.argv.index('--preview') + 1 else 'fx_preview.png'
    sheet.convert('RGB').save(out)
    print('preview →', out)


def blink(size=320, n=14):
    """JA teleport arrival: a collapsing diamond, a vertical light slit, and shards flung out."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        dia = np.abs(x) + np.abs(y)  # diamond distance
        rad = 0.95 * (1 - e) + 0.08
        inten = gauss(dia - rad, 0.025 + 0.02 * t) * (1 - t * 0.7) * 1.6
        # vertical slit that opens then fades
        slit_w = 0.02 + 0.05 * math.sin(min(1, t * 2.2) * math.pi)
        inten += gauss(x, slit_w) * gauss(y, 0.9) * (1 - t) ** 0.8 * 2.4
        inten += gauss(y, 0.012) * gauss(x, 0.45 * (1 - t) + 0.05) * (1 - t) ** 1.5 * 1.5
        # shards outward after the collapse
        if t > 0.25:
            tt = (t - 0.25) / 0.75
            for i in range(9):
                a = i * 0.698 + 0.4
                d = 0.15 + 0.8 * ease_out(tt) * (0.7 + 0.3 * ((i * 53) % 10) / 10)
                cx, cy = math.cos(a) * d, math.sin(a) * d
                u = (x - cx) * math.cos(a) + (y - cy) * math.sin(a)
                v = -(x - cx) * math.sin(a) + (y - cy) * math.cos(a)
                inten += gauss(u, 0.06) * gauss(v, 0.012) * (1 - tt) * 1.8
        frames.append(rgba(glowify(inten, 4, 0.7), (1, 1, 1), white_core=0.8))
    save('blink_t', frames, tint=True)


def wall_hit(size=384, n=14):
    """Arena-edge impact, facing +x (away from the wall): half-ring burst, cracks and debris."""
    x, y, r, th = grid(size)
    frames = []
    half = smooth(-0.35, 0.05, x)  # only the side facing away from the wall
    cracks = np.zeros_like(r)
    for i in range(7):
        a = -1.25 + i * 0.42
        u = x * math.cos(a) + y * math.sin(a)
        v = -x * math.sin(a) + y * math.cos(a)
        cracks += gauss(v + 0.02 * np.sin(u * 40), 0.01) * (u > 0) * np.exp(-u * 1.6)
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        ring = gauss(r - (0.08 + 0.8 * e), 0.03 + 0.04 * t) * (1 - t) ** 1.2 * 1.8
        inten = (ring + gauss(r, 0.18 + 0.2 * e) * (1 - t) ** 2 * 2.2) * half
        inten += cracks * smooth(0.0, 0.15, t) * (1 - t) ** 0.8 * 2.0
        for i in range(12):
            a = -1.3 + i * 0.236
            d = 0.1 + 0.85 * e * (0.5 + 0.5 * ((i * 71) % 10) / 10)
            cx, cy = math.cos(a) * d, math.sin(a) * d
            inten += gauss(np.sqrt((x - cx) ** 2 + (y - cy) ** 2), 0.018) * (1 - t) * 1.6
        frames.append(rgba(glowify(inten, 4, 0.6), (1, 1, 1), white_core=0.85))
    save('wall_t', frames, tint=True)


PURPLE = (0.78, 0.45, 1.0)


def ghost_fade(size=320, n=16):
    """Phantom decoy dissolving: the body breaks into violet wisps that curl up and away."""
    x, y, r, th = grid(size)
    frames = []
    nz = fbm(size, 4, 77, 6)
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        # dissolving disc eaten by noise from the outside in
        disc = (1 - smooth(0.25 + 0.2 * e, 0.34 + 0.25 * e, r)) * smooth(t * 1.1 - 0.1, t * 1.1 + 0.05, nz) * (1 - t) ** 0.6
        inten = disc * 1.1
        # wisps: noisy streaks rising (−y) and spiralling out
        for i in range(9):
            a = i * 0.698 + 0.2 + t * 1.2
            d = 0.15 + 0.7 * e * (0.6 + 0.4 * ((i * 41) % 10) / 10)
            cx, cy = math.cos(a) * d, math.sin(a) * d - 0.35 * e
            u = (x - cx) * math.cos(a + 1.3) + (y - cy) * math.sin(a + 1.3)
            v = -(x - cx) * math.sin(a + 1.3) + (y - cy) * math.cos(a + 1.3)
            inten += gauss(u, 0.14) * gauss(v + 0.03 * np.sin(u * 18 + t * 9), 0.018) * (1 - t) * 1.6
        inten += gauss(r - (0.2 + 0.7 * e), 0.025) * (1 - t) ** 2 * 1.2
        frames.append(rgba(glowify(inten, 4, 0.6), PURPLE, white_core=0.6))
    save('ghost_fade', frames)


def ghost_appear(size=320, n=16):
    """Phantom materializing: violet motes converge, a thin ring snaps shut, a flash."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(min(1, t * 1.4))
        inten = np.zeros_like(r)
        for i in range(14):
            a = i * 0.449 + 0.5 - e * 1.4
            d = 0.9 * (1 - e) + 0.08
            cx, cy = math.cos(a) * d, math.sin(a) * d
            inten += gauss(np.sqrt((x - cx) ** 2 + (y - cy) ** 2), 0.02 + 0.015 * (1 - e)) * (0.4 + 0.8 * e) * (1 - max(0, t - 0.75) * 4)
        ring = 0.95 * (1 - e) + 0.3
        inten += gauss(r - ring, 0.02) * math.sin(min(1, t * 1.3) * math.pi) * 1.3
        flash = max(0.0, 1 - abs(t - 0.62) * 5)
        inten += gauss(r, 0.22) * flash * 2.2
        inten += (gauss(x, 0.012) * gauss(y, 0.5) + gauss(y, 0.012) * gauss(x, 0.5)) * flash * 1.6
        frames.append(rgba(glowify(inten, 4, 0.7), PURPLE, white_core=0.85))
    save('ghost_appear', frames)


def reaper(size=384, n=16):
    """Soul Ripper: three bold claw strokes raking diagonally across (facing +x), white-hot
    cores in a violet glow, torn in one after another, then dissolving into violet mist."""
    x, y, r, th = grid(size)
    frames = []
    nz = fbm(size, 3, 91, 5)
    ns = 120
    for k in range(n):
        t = k / (n - 1)
        inten = np.zeros_like(r)
        mist = np.zeros_like(r)
        nrm = np.array([1.0, -1.0]) / math.sqrt(2)  # normal of the diagonal strokes
        for i, off in enumerate((-0.3, 0.0, 0.3)):
            lt = np.clip(t * 2.2 - i * 0.18, 0, 1.6)
            if lt <= 0:
                continue
            head = min(1.0, ease_out(min(1.0, lt / 0.55)))  # how far the stroke has been torn
            fade = max(0.0, 1 - max(0.0, lt - 0.7) * 1.4)
            if fade <= 0:
                continue
            # curved stroke from upper-left to lower-right, offset along its normal
            L = 0.62 - abs(off) * 0.35  # outer claws a little shorter
            p0 = np.array([-L, -L]) + nrm * off
            p1 = np.array([L, L]) + nrm * off
            ctrl = (p0 + p1) / 2 + nrm * 0.16
            best = np.full(r.shape, 9.0, np.float32)
            prof = np.zeros_like(r)
            for j in range(ns + 1):
                sj = j / ns * head
                q = (1 - sj) ** 2 * p0 + 2 * (1 - sj) * sj * ctrl + sj ** 2 * p1
                d = np.sqrt((x - q[0]) ** 2 + (y - q[1]) ** 2)
                closer = d < best
                best = np.where(closer, d, best)
                # tapered: thick in the middle of the full stroke, sharp at both ends
                w = 0.006 + 0.028 * math.sin(math.pi * (j / ns)) ** 0.8
                prof = np.where(closer, w, prof)
            core = np.exp(-(best / np.maximum(prof * 0.45, 1e-3)) ** 2)
            glow = np.exp(-(best / np.maximum(prof * 2.2, 1e-3)) ** 2)
            inten += (core * 1.7 + glow * 0.55) * fade
            mist += np.exp(-(best / 0.16) ** 2) * fade * (0.5 + 0.5 * nz)
        inten += mist * 0.25 * min(1.0, t * 3)
        frames.append(rgba(glowify(inten, 3, 0.45), PURPLE, white_core=0.9))
    save('reaper', frames)


def danger_violet():
    """Phantom's guard-break warning aura: the same pulsing triangle, in violet."""
    danger(name='danger_p', color=(0.8, 0.45, 1.0))


YELLOW = (1.0, 0.82, 0.25)
CYAN = (0.35, 0.9, 1.0)


def blast(size=320, n=14):
    """Ray's switch blast: a point-blank fan of diamond pellets toward +x, a muzzle cone
    and a shock front (the sprite center = the shooter)."""
    x, y, r, th = grid(size)
    frames = []
    g = np.random.default_rng(4242)
    pel = [(g.uniform(-0.8, 0.8), g.uniform(0.55, 1.0)) for _ in range(16)]
    cone = (np.abs(th) < 0.9) * (x > 0)
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        inten = gauss(r, 0.12 + 0.1 * e) * (1 - t) ** 2 * 2.2  # muzzle flash
        front = 0.15 + 0.8 * e
        inten += cone * gauss(r - front, 0.03 + 0.05 * t) * gauss(th, 0.55) * (1 - t) ** 1.2 * 1.6
        inten += cone * gauss(np.sin(th * 14), 0.2) * (r < front) * smooth(0.08, 0.25, r) * (1 - t) ** 1.5 * 0.45
        for a, sp in pel:
            d = 0.12 + 0.85 * e * sp
            cx, cy = math.cos(a) * d, math.sin(a) * d
            u = (x - cx) * math.cos(a) + (y - cy) * math.sin(a)
            v = -(x - cx) * math.sin(a) + (y - cy) * math.cos(a)
            dia = np.abs(u) / 0.035 + np.abs(v) / 0.018  # little diamonds pointing outward
            inten += np.exp(-dia ** 2) * (1 - t) * 1.8
            inten += gauss(v, 0.008) * (u < 0) * (u > -0.18 * e) * (1 - t) * 0.8  # tails
        frames.append(rgba(glowify(inten, 3, 0.5), YELLOW, white_core=0.85))
    save('blast', frames)


def shock(size=256, n=12):
    """Static-field shock: jagged lightning striking down into the target + crackle ring."""
    x, y, r, th = grid(size)
    frames = []
    g = np.random.default_rng(777)
    for k in range(n):
        t = k / (n - 1)
        inten = np.zeros_like(r)
        flick = 1.0 if k % 3 != 2 else 0.45
        for b in range(5):
            a0 = -math.pi / 2 + (b - 2) * 0.5 + g.uniform(-0.15, 0.15)
            # polyline from the rim toward the center, re-jittered every frame
            pts = []
            for j in range(9):
                d = 1.0 - j / 8 * 0.95
                a = a0 + g.uniform(-0.18, 0.18) * (1 if j and j < 8 else 0)
                pts.append((math.cos(a) * d, math.sin(a) * d))
            best = np.full(r.shape, 9.0, np.float32)
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                ex, ey = x2 - x1, y2 - y1
                L2 = ex * ex + ey * ey + 1e-9
                tt = np.clip(((x - x1) * ex + (y - y1) * ey) / L2, 0, 1)
                d = np.sqrt((x - (x1 + ex * tt)) ** 2 + (y - (y1 + ey * tt)) ** 2)
                best = np.minimum(best, d)
            inten += (np.exp(-(best / 0.012) ** 2) * 1.6 + np.exp(-(best / 0.05) ** 2) * 0.4) * flick
        inten *= (1 - t) ** 0.7
        inten += gauss(r, 0.2) * (1 - t) ** 2 * 1.6
        inten += gauss(r - (0.3 + 0.6 * ease_out(t)), 0.02) * (0.5 + 0.5 * np.sin(th * 23 + k)) * (1 - t) * 1.2
        frames.append(rgba(glowify(inten, 3, 0.55), YELLOW, white_core=0.9))
    save('shock', frames)


def turnback(size=320, n=14):
    """Volt's turnback: a 180° whirl arc (from behind to +x) ending in a triangle flash."""
    x, y, r, th = grid(size)
    frames = []
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(min(1.0, t * 1.6))
        # arc sweeping from th = pi (behind) through -pi/2 to 0 (front)
        head = math.pi * (1 - e)
        rel = np.mod(-th - 0.0, 2 * math.pi)  # 0 at front, increasing counter-clockwise (up side)
        on = (rel >= head - 0.05) * (rel <= math.pi + 0.05)
        tail = np.clip(1 - (rel - head) / math.pi, 0, 1) ** 1.5
        band = gauss(r - 0.62, 0.05 + 0.03 * t) * on * (0.3 + 0.9 * tail) * (1 - max(0, t - 0.6) * 2.5) * 1.8
        inten = band
        # triangle flash at the front after the whirl
        if t > 0.35:
            tt = (t - 0.35) / 0.65
            tri = np.maximum.reduce([x, x * math.cos(2.094) + y * math.sin(2.094), x * math.cos(-2.094) + y * math.sin(-2.094)])
            s = 0.14 + 0.3 * ease_out(tt)
            inten += gauss(tri - s, 0.025 + 0.025 * tt) * (1 - tt) * 2.0
            inten += gauss(r, 0.18) * (1 - tt) ** 3 * 1.4
        frames.append(rgba(glowify(inten, 4, 0.6), CYAN, white_core=0.85))
    save('turnback', frames)


def overcharge(size=256, n=14):
    """Volt's overcharge: bolts burst outward from the body, and a pentagon (buff) ring expands."""
    x, y, r, th = grid(size)
    frames = []
    g = np.random.default_rng(4242)
    for k in range(n):
        t = k / (n - 1)
        e = ease_out(t)
        inten = gauss(r, 0.14 + 0.08 * e) * (1 - t) ** 1.5 * 2.0  # core flash
        flick = 1.0 if k % 3 != 2 else 0.5
        reach = 0.25 + 0.7 * e
        for b in range(7):
            a0 = b / 7 * 2 * math.pi + g.uniform(-0.2, 0.2)
            pts = [(0.0, 0.0)]
            for j in range(1, 7):
                d = reach * j / 6
                a = a0 + g.uniform(-0.22, 0.22)
                pts.append((math.cos(a) * d, math.sin(a) * d))
            best = np.full(r.shape, 9.0, np.float32)
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                ex, ey = x2 - x1, y2 - y1
                L2 = ex * ex + ey * ey + 1e-9
                tt = np.clip(((x - x1) * ex + (y - y1) * ey) / L2, 0, 1)
                d = np.sqrt((x - (x1 + ex * tt)) ** 2 + (y - (y1 + ey * tt)) ** 2)
                best = np.minimum(best, d)
            inten += (np.exp(-(best / 0.011) ** 2) * 1.5 + np.exp(-(best / 0.045) ** 2) * 0.35) * flick * (1 - t) ** 0.8
        # pentagon ring (the buff shape), expanding and fading
        pr = 0.3 + 0.6 * e
        pent = np.cos(math.pi / 5) / np.cos(np.mod(th + math.pi / 2, 2 * math.pi / 5) - math.pi / 5)
        inten += gauss(r - pr * pent, 0.018 + 0.02 * t) * (1 - t) ** 1.2 * 1.6
        frames.append(rgba(glowify(inten, 3, 0.55), CYAN, white_core=0.9))
    save('overcharge', frames)


def danger_cyan():
    """Volt's guard-break (turnback) warning aura, in cyan."""
    danger(name='danger_c', color=CYAN)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    if '--only' in sys.argv:
        # regenerate just the named sheets (keeps the others' files and manifest entries)
        names = sys.argv[sys.argv.index('--only') + 1].split(',')
        with open(os.path.join(OUT, 'fx.json')) as f:
            MANIFEST.update(json.load(f))
        for nm in names:
            globals()[nm]()
        with open(os.path.join(OUT, 'fx.json'), 'w') as f:
            json.dump(MANIFEST, f, indent=1)
        sys.exit(0)
    slash()
    spin()
    burst()
    burst(320, 12, 'hit_heavy_t', rays=14, heavy=True)
    guard_hex()
    ripple()
    shatter()
    just_flash()
    ko_blast()
    dust()
    flare()
    fang()
    gale()
    breeze()
    riposte()
    bash()
    danger()
    stun()
    charge()
    blink()
    wall_hit()
    ghost_fade()
    ghost_appear()
    reaper()
    danger_violet()
    blast()
    shock()
    turnback()
    danger_cyan()
    overcharge()
    with open(os.path.join(OUT, 'fx.json'), 'w') as f:
        json.dump(MANIFEST, f, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, m['file'])) for m in MANIFEST.values())
    print(f'total {total / 1024:.0f} KB')
    if '--preview' in sys.argv:
        contact_sheet()

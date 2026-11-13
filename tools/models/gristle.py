"""Captain Gristle, the old sea captain: writes assets/models/gristle.glb.

    tools/models/build.sh gristle

Built on lib/biped.py like Brass. The look is a port of DESIGNS.gristle in src/render/characters.js:
a stout navy coat skinned to the spine, chest and clavicles, red facings and gold buttons, a belly,
epaulettes with rigid bullion tassels, sleeves with turned-back red cuffs, and on the head a big
red beard on a jaw bone, a moustache, an eyepatch, one eye with a lid, and a bicorne. The game swaps
its own materials in by name (coat, facing, skin, beard, leather, linen, felt, eyeball, eye, brass).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from lib import meshkit as mk
from lib.meshkit import V, unit
from lib.biped import Body, SIDES, HEAD_AT, K, Z3, Z2, Fn, to
from lib import quantise

PI = math.pi
H = HEAD_AT
EYE = V(-0.06, 0.035, 0.132)
BODY = Body('gristle', arm=dict(shoulder=0.06, elbow=0.05, wrist=0.04, gap=0.018), palm=(0.046, 0.05, 0.022), finger_r=0.0098,
            temple=V(-0.156, 0.065, 0.025), mouth=V(0, -0.058, 0.166), shoulder=0.222,
            bones=[('lid', 'head', H + EYE), ('jaw', 'head', H + V(0, -0.025, 0.005))])
REST, LIMP, REACH, AIM, FAN, sip = BODY.REST, BODY.LIMP, BODY.REACH, BODY.AIM, BODY.FAN, BODY.sip
COLOURS = dict(coat=(0.13, 0.2, 0.33), facing=(0.56, 0.14, 0.13), skin=(0.84, 0.6, 0.48), beard=(0.66, 0.27, 0.11), leather=(0.08, 0.06, 0.05),
               linen=(0.93, 0.89, 0.83), felt=(0.07, 0.07, 0.09), eyeball=(0.1, 0.05, 0.03), eye=(1, 0.35, 0.14), brass=(0.85, 0.64, 0.27))

# ---------- shapes the shared kit doesn't have ----------


def _hash(i):
    return np.modf(np.abs(np.sin(i @ V(127.1, 311.7, 74.7)) * 43758.5453))[0]


def vnoise(p):
    """Smooth value noise in 3D, 0..1."""
    i = np.floor(p); f = p - i; u = f * f * (3 - 2 * f)
    out = 0
    for c in np.ndindex(2, 2, 2):
        c = np.array(c, float)
        w = np.prod(np.where(c == 1, u, 1 - u), axis=-1)
        out = out + w * _hash(i + c)
    return out


def resmooth(g):
    """Smooth normals that keep facing the way the old ones did (the kit's spheres wind inward)."""
    old = g.N.copy(); g.smooth_normals()
    if np.sum(g.N * old) < 0:
        g.N = -g.N
    return g


def lumpy(g, amp, freq, seed=0):
    """Pushes vertices along their normals by smooth noise (beards, gathered linen), as characters.js does."""
    x, y, z = g.P.T
    n = np.sin(x * freq + seed) * np.sin(y * freq * 1.31 + seed * 2) * np.sin(z * freq * 0.87 + 1) + vnoise(np.stack([x, y, z], -1) * freq * 0.9 + seed * 3.1) - 0.5
    g.P = g.P + g.N * (n * amp)[:, None]
    return resmooth(g)


def cone(r, h, seg=14, hseg=4):
    """Along +y, the point up, centred like three's ConeGeometry."""
    return mk.lathe([(0, -h / 2)] + [(r * (1 - k), -h / 2 + h * k) for k in np.linspace(0, 1, hseg + 1)], seg)


def capsule(r, length, cap=4, radial=10):
    """Along y, like three's CapsuleGeometry."""
    lo = [(r * math.cos(t), -length / 2 + r * math.sin(t)) for t in np.linspace(-PI / 2, 0, cap + 1)]
    hi = [(r * math.cos(t), length / 2 + r * math.sin(t)) for t in np.linspace(0, PI / 2, cap + 1)]
    return mk.lathe(lo + hi, radial)


def _ears(P):
    """Triangles of a simple polygon (counter-clockwise), by ear clipping."""
    idx, out = list(range(len(P))), []
    cross = lambda a, b, c: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    while len(idx) > 3:
        for k in range(len(idx)):
            a, b, c = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            if cross(P[a], P[b], P[c]) <= 1e-12:
                continue
            if any(cross(P[a], P[b], P[q]) >= 0 and cross(P[b], P[c], P[q]) >= 0 and cross(P[c], P[a], P[q]) >= 0 for q in idx if q not in (a, b, c)):
                continue
            out.append((a, b, c)); idx.pop(k); break
        else:
            break
    out.append(tuple(idx[:3]))
    return out


def slab(outline, half, steps=3):
    """A flat piece cut to `outline` (x, y), `2 * half` thick in z, its edge fully rounded."""
    P2 = np.asarray(outline, float)
    if np.sum(P2[:, 0] * np.roll(P2[:, 1], -1) - np.roll(P2[:, 0], -1) * P2[:, 1]) < 0:
        P2 = P2[::-1].copy()
    e = np.roll(P2, -1, 0) - P2; en = unit(np.stack([e[:, 1], -e[:, 0]], -1)); vn = unit(en + np.roll(en, 1, 0))
    n = len(P2)
    Ps, Ns, F = [], [], []
    a = np.linspace(-PI / 2, PI / 2, 2 * steps + 1)
    for t in a:
        off = -half + half * math.cos(t)
        Ps.append(np.concatenate([P2 + vn * off, np.full((n, 1), half * math.sin(t))], 1))
        Ns.append(np.concatenate([vn * math.cos(t), np.full((n, 1), math.sin(t))], 1))
    for r in range(len(a) - 1):
        for i in range(n):
            j = (i + 1) % n; A, B, C, D = r * n + i, r * n + j, (r + 1) * n + j, (r + 1) * n + i
            F += [(A, B, C), (A, C, D)]
    tri = _ears(P2)
    base = len(a) * n
    for side, z, ring in ((1, half, len(a) - 1), (-1, -half, 0)):
        k0 = len(Ps) * n
        Ps.append(Ps[ring].copy()); Ns.append(np.tile([0, 0, side], (n, 1)).astype(float))
        F += [(k0 + p, k0 + q, k0 + r) if side > 0 else (k0 + p, k0 + r, k0 + q) for p, q, r in tri]
    P = np.concatenate(Ps); N = np.concatenate(Ns)
    return mk.Geo(P, N, P[:, :2] * 2.5, F)


def bezier(*ctrl, n=16):
    c = np.asarray(ctrl, float); t = np.linspace(0, 1, n + 1)[:, None]
    if len(c) == 3:
        return (1 - t) ** 2 * c[0] + 2 * (1 - t) * t * c[1] + t * t * c[2]
    return (1 - t) ** 3 * c[0] + 3 * (1 - t) ** 2 * t * c[1] + 3 * (1 - t) * t * t * c[2] + t ** 3 * c[3]


# ---------- the coat ----------
SX, SZ = 1.16, 0.86
BELLY = 0.11


def R(y):
    return 0.21 + (y + 0.3) * 0.06 if y < -0.08 else 0.225 if y < 0.12 else 0.225 - (y - 0.12) * 0.4


def belly(P):
    """A stout man's front: the coat swells forward round the waist."""
    y, z = P[:, 1], P[:, 2]
    k = 1 + BELLY * np.exp(-((y + 0.07) / 0.13) ** 2) * mk.smoothstep(-0.03, 0.12, z)
    P = P.copy(); P[:, 2] = z * k
    return P


def front(x, y):
    z = math.sqrt(max(0, 1 - (x / (R(y) * SX)) ** 2)) * R(y) * SZ
    return float(belly(V(x, y, z)[None])[0, 2])


def torso_skin(g):
    """The coat bends at the waist (spine below, chest above) and its shoulders ride the clavicles."""
    x, y = g.P[:, 0], g.P[:, 1]
    ch = mk.smoothstep(-0.24, -0.03, y)
    cl = mk.smoothstep(0.17, 0.27, y) * mk.smoothstep(0.07, 0.15, np.abs(x))
    W = np.stack([(1 - ch) * (1 - cl), ch * (1 - cl), cl * (x < 0), cl * (x >= 0)], 1)
    return g.skin(['spine', 'chest', 'clavicle.R', 'clavicle.L'], W + 1e-9)


def body_parts():
    parts = []
    add = lambda mat, bone, *geos: parts.extend((mat, g.bind(bone)) for g in geos)
    skin = lambda mat, *geos: parts.extend((mat, torso_skin(g)) for g in geos)
    # the coat: a lathe, broad and deep, with a belly
    prof = mk.catmull(np.array([[0.0, -0.3, 0], [0.2, -0.3, 0], [0.215, -0.2, 0], [0.225, -0.05, 0], [0.228, 0.12, 0], [0.215, 0.24, 0], [0.17, 0.32, 0], [0.08, 0.38, 0], [0.0, 0.385, 0]]), 30)
    coat = mk.lathe(prof[:, :2], 40).place((0, 0, 0), (0, 0, 0), (SX, 1, SZ))
    coat.P = belly(coat.P); resmooth(coat)
    skin('coat', coat)
    # lapels: red facings in a V, laid on the coat's front
    for s in (-1, 1):
        g = slab([(0, 0), (s * 0.11, 0.02), (s * 0.13, 0.3), (s * 0.05, 0.36), (0, 0.1)], 0.006, 2)
        x, y, z = g.P.T; y = y - 0.05
        g.P = np.stack([x, y, np.array([front(a, b) for a, b in zip(x, y)]) + z + 0.002], -1); resmooth(g)
        skin('facing', g)
    for s in (-1, 1):
        for i in range(4):
            x, y = s * 0.085, 0.2 - i * 0.075
            skin('brass', mk.ball(V(x, y, front(x, y) + 0.012), 0.013, (1, 1, 0.55), 8))
    # belt and buckle
    yb = -0.17
    belt = mk.cylinder(R(yb) + 0.012, R(yb) + 0.014, 0.05, 40, open_=True).place((0, yb, 0), (0, 0, 0), (SX, 1, SZ))
    belt.P = belly(belt.P); resmooth(belt)
    skin('leather', belt)
    skin('brass', mk.torus(0.03, 0.007, 4, 4).place((0, yb, front(0, yb) + 0.016), (0, 0, PI / 4), (1.3, 1, 1)))
    # the linen cravat and stock
    skin('linen', lumpy(mk.sphere(0.06, 16, 12), 0.008, 70).place((0, 0.32, 0.11), (0, 0, 0), (1.1, 0.8, 0.7)),
         lumpy(cone(0.05, 0.13, 14, 5), 0.008, 60).place((0, 0.24, 0.165), (PI - 0.2, 0, 0), (1, 1, 0.5)))
    add('linen', 'neck', mk.tube(V(0, 0.33, -0.02), V(0, 0.385, -0.02), 0.088, 0.078, 20))
    # a watch chain across the waistcoat
    chain = mk.catmull([V(0.085, -0.02, front(0.085, -0.02) + 0.01), V(0.12, -0.1, front(0.12, -0.1) + 0.012), V(0.165, -0.08, front(0.165, -0.08) + 0.006)], 15)
    for i, p in enumerate(chain):
        skin('brass', mk.torus(0.006, 0.0018, 3, 6).place(p, (0, PI / 2 if i % 2 else 0, 0.6)))
    for side, sg in SIDES:
        parts += epaulette(side, sg)
    parts += head_parts()
    for side, sg in SIDES:
        parts += arm_parts(side, sg)
    return parts


def epaulette(side, sg):
    """A gold board on the shoulder and a crescent of bullion tassels round its outer edge. Each
    tassel is rigid: it hangs from the board and swings with the shoulder, and its lower end is
    carried a little with the upper arm so a raised arm lifts the fringe rather than passing through it."""
    out = []
    c = V(sg * 0.205, 0.307, -0.005)
    tilt = (0, 0, -sg * 0.3)
    board = mk.lathe([(0, -0.006), (0.07, -0.006), (0.072, 0.0), (0.06, 0.006), (0.03, 0.011), (0, 0.012)], 28).place(c, tilt, (1, 1, 0.82))
    rim = mk.torus(0.072, 0.0055, 4, 24).place(c, (PI / 2 + 0, 0, -sg * 0.3), (1, 0.82, 1))
    out += [('brass', board.bind(f'clavicle.{side}')), ('brass', rim.bind(f'clavicle.{side}')),
            ('brass', mk.ball(c + V(-sg * 0.055, 0.016, 0), 0.01, (1, 0.6, 1), 10).bind(f'clavicle.{side}'))]
    # the sleeve's shoulder cap the fringe has to hang clear of
    cap = V(sg * BODY.shoulder, BODY.sh_y, BODY.sh_z); clear = BODY.arm['shoulder'] + 0.011
    Rb = mk.euler_yxz(*tilt)
    n = 17
    for i in range(n):
        a = (i / (n - 1) - 0.5) * PI * 1.12
        e = c + Rb @ V(sg * math.cos(a) * 0.07, -0.004, math.sin(a) * 0.07 * 0.82)
        def off(p):
            d = p - cap; L = np.linalg.norm(d)
            return cap + d / L * max(L, clear)
        mid, end = off(e + V(0, -0.034, 0)), off(e + V(0, -0.07, 0))
        coil = lambda t: 0.0068 * (1 + 0.14 * math.sin(t * PI * 3.5) ** 2) * (1 - 0.12 * t)
        g = mk.sweep([e, mid, end], coil, 7, 5, caps=True)
        # the outer tassels follow the arm more than those at the front and back
        k = 0.35 * max(0.0, math.cos(a))
        g.skin([f'clavicle.{side}', f'upperarm.{side}'], np.tile([1 - k, k], (len(g.P), 1)))
        out.append(('brass', g))
    return out


def arm_parts(side, sg):
    """One arm: the shared sleeve in coat, the hand, and a red cuff turned back from the hem."""
    tube, hand = BODY.arm_parts(side, sg)
    y = BODY.sh_y + BODY.sleeve_end()
    at = V(sg * BODY.shoulder, 0, BODY.sh_z)
    fore = f'forearm.{side}'
    cuff = mk.lathe([(0.034, y + 0.004), (0.043, y - 0.002), (0.049, y + 0.004), (0.052, y + 0.035), (0.052, y + 0.06), (0.05, y + 0.068), (0.044, y + 0.072)], 24).place(at)
    button = mk.ball(at + V(0, y + 0.045, 0.052), 0.008, (1, 1, 0.6), 8)
    band = mk.ring(at + V(0, y + 0.066, 0), V(0, 1, 0), 0.0505, 0.0035)
    return [('coat', tube), ('skin', hand), ('facing', cuff.bind(fore)), ('brass', button.bind(fore)), ('brass', band.bind(fore))]


def head_parts():
    parts = []
    add = lambda mat, bone, *geos: parts.extend((mat, g.bind(bone)) for g in geos)

    def jawed(mat, *geos, top=-0.04, bottom=-0.12):
        # below the hinge the beard rides the jaw; up the cheeks it stays with the skull
        for g in geos:
            w = mk.smoothstep(H[1] + top, H[1] + bottom, g.P[:, 1]) * mk.smoothstep(-0.02, 0.06, g.P[:, 2])
            parts.append((mat, g.skin(['head', 'jaw'], np.stack([1 - w, w], 1) + 1e-9)))
    add('skin', 'head', mk.sphere(0.16, 32, 22).place(H + V(0, 0.005, 0), (0, 0, 0), (1.03, 1, 0.98)))
    for s in (-1, 1):
        add('skin', 'head', mk.sphere(1, 10, 8).place(H + V(s * 0.158, 0.005, -0.01), (0, s * 0.3, 0), (0.022, 0.045, 0.034)))
    add('skin', 'head', mk.ball(H + V(0, -0.008, 0.16), 0.042, (0.95, 1, 1), 18), mk.ball(H + V(-0.02, -0.028, 0.168), 0.02, 1, 10), mk.ball(H + V(0.02, -0.028, 0.168), 0.02, 1, 10))
    # the mouth, seen only when the jaw drops
    add('leather', 'head', mk.sphere(1, 14, 8).place(H + V(0, -0.058, 0.142), (0, 0, 0), (0.045, 0.016, 0.02)))
    # the beard: a lumpy mass, side whiskers, a braided tuft with a gold bead
    jawed('beard', lumpy(mk.sphere(0.15, 32, 20), 0.014, 55, 1).place(H + V(0, -0.1, 0.045), (0, 0, 0), (1.1, 1.0, 0.85)))
    for s in (-1, 1):
        jawed('beard', lumpy(mk.sphere(0.075, 18, 12), 0.01, 70, s).place(H + V(s * 0.11, -0.05, 0.04), (0, 0, 0), (0.9, 1.3, 1)))
    jawed('beard', lumpy(cone(0.075, 0.16, 18, 6), 0.008, 80).place(H + V(0, -0.245, 0.07), (PI + 0.15, 0, 0)))
    jawed('brass', mk.torus(0.03, 0.009, 8, 18).place(H + V(0, -0.27, 0.074), (PI / 2 - 0.15, 0, 0)))
    # the moustache sweeps out over the mouth and curls up at the tips
    for s in (-1, 1):
        r = lambda t: 0.022 * (1 - t * 0.75) * min(1, 0.4 + t * 4)
        add('beard', 'head', lumpy(mk.sweep([H + V(s * 0.005, -0.035, 0.175), H + V(s * 0.05, -0.05, 0.17), H + V(s * 0.1, -0.035, 0.145), H + V(s * 0.125, 0.0, 0.12)], r, 20, 10, caps=True), 0.002, 300, s))
    # one bushy brow over the good eye, one over the patch
    add('beard', 'head', lumpy(capsule(0.016, 0.06), 0.004, 120).place(H + V(-0.06, 0.068, 0.142), (0, -0.25, PI / 2 - 0.2)))
    add('beard', 'head', lumpy(capsule(0.014, 0.055), 0.004, 120, 2).place(H + V(0.062, 0.075, 0.142), (0, 0.25, PI / 2 + 0.25)))
    # the patch and its strap
    add('leather', 'head', mk.sphere(1, 20, 12).place(H + V(0.06, 0.04, 0.142), (0, 0.36, 0), (0.04, 0.034, 0.016)))
    add('leather', 'head', mk.torus(0.164, 0.0045, 4, 36).place(H + V(0, 0.02, 0), (0.12, 0, 0.5)))
    # the good eye, turned a little out; its lid is a skin cap on its own bone
    e = mk.euler_yxz(0, -0.3, 0)
    add('eyeball', 'head', mk.sphere(0.027, 18, 12).place(H + EYE))
    add('eye', 'head', mk.circle(0.015, 18).apply(e, H + EYE + e @ V(0, 0, 0.0266)))
    add('eyeball', 'head', mk.circle(0.0062, 14).apply(e, H + EYE + e @ V(0, 0, 0.0268)))
    add('skin', 'lid', mk.sphere(0.0292, 18, 8, 0, mk.TAU, 0, PI / 2).place(H + EYE))
    # the bicorne: two felt flaps meeting at a ridge, gold-edged, a crown, and a cockade
    outline = np.concatenate([bezier((-0.33, 0.07), (0, -0.03), (0.33, 0.07))[:-1], bezier((0.33, 0.07), (0.24, 0.1), (0.16, 0.2), (0, 0.215))[:-1], bezier((0, 0.215), (-0.16, 0.2), (-0.24, 0.1), (-0.33, 0.07))[:-1]])
    edge = [V(-0.33, 0.07, 0), V(-0.22, 0.13, 0), V(-0.1, 0.195, 0), V(0, 0.215, 0), V(0.1, 0.195, 0), V(0.22, 0.13, 0), V(0.33, 0.07, 0)]
    for s in (-1, 1):
        add('felt', 'head', slab(outline, 0.009, 2).place(H + V(0, 0.1, s * 0.035), (-s * 0.2, 0, 0)))
        add('brass', 'head', mk.sweep(edge, 0.006, 24, 6, caps=True).place(H + V(0, 0.1, s * 0.035), (-s * 0.2, 0, 0)))
    add('felt', 'head', mk.sphere(0.155, 28, 12, 0, mk.TAU, 0, PI / 2).place(H + V(0, 0.1, 0), (0, 0, 0), (1.05, 0.7, 0.95)))
    add('leather', 'head', mk.cylinder(0.035, 0.035, 0.008, 20).place(H + V(-0.12, 0.2, 0.034), (PI / 2 - 0.2, 0, 0)))
    add('facing', 'head', mk.cylinder(0.024, 0.024, 0.01, 20).place(H + V(-0.12, 0.2, 0.036), (PI / 2 - 0.2, 0, 0)))
    add('brass', 'head', mk.ball(H + V(-0.12, 0.2, 0.044), 0.009, (1, 1, 0.6), 8))
    return parts


# ---------- clips ----------
# He is heavy and slow to move, and moves all of a piece: the trunk goes first and further than
# Brass's, the shoulders roll with it, and a jaw works under the beard. Every clip but `idle` and
# `drink` starts from rest; `drink` starts and ends on `hold_glass`'s last frame.
BREATH = 4.4


def idle():
    b = lambda t: math.sin(mk.TAU * t / BREATH) + 0.25 * math.sin(2 * mk.TAU * t / BREATH)
    sway = lambda t: math.sin(mk.TAU * t / (2 * BREATH))
    chew = lambda t: 0.5 - 0.5 * math.cos(mk.TAU * 3 * t / (2 * BREATH))
    return dict(
        dur=2 * BREATH,
        spine=Fn(lambda t: V(0.006 * sway(t + 1.1), 0.016 * sway(t), 0.008 * sway(t))),
        chest=Fn(lambda t: V(-0.012 * b(t), 0, 0)),
        chest_dy=Fn(lambda t: 0.006 * b(t)),
        neck=Fn(lambda t: V(0.009 * b(t), -0.014 * sway(t), 0)),
        head=Fn(lambda t: V(0.01 * math.sin(mk.TAU * t / BREATH + 0.4), 0, 0.01 * math.sin(mk.TAU * t / BREATH + 0.6) - 0.006 * sway(t))),
        clav_R=Fn(lambda t: V(0.015 + 0.026 * b(t - 0.15), 0.02)),
        clav_L=Fn(lambda t: V(0.015 + 0.026 * b(t - 0.15), 0.02)),
        bones=dict(jaw=Fn(lambda t: V(0.012 + 0.03 * chew(t) ** 3, 0, 0))),
    )


def reach():
    return dict(
        dur=1.05,
        # he settles back before he commits, then the whole trunk rolls into it
        spine=K((0, Z3), (0.16, V(-0.025, -0.04, 0), 'soft'), (0.6, V(0.13, 0.19, -0.035), 'io'), (0.92, V(0.115, 0.175, -0.03), 'soft')),
        chest=K((0, Z3), (0.16, V(0, -0.03, 0), 'soft'), (0.64, V(0.04, 0.08, 0.02), 'io')),
        chest_dy=K((0, 0), (0.16, 0.004, 'soft'), (0.6, -0.006, 'io')),
        neck=K((0, Z3), (0.2, V(0.03, 0, 0), 'soft'), (0.7, V(-0.12, -0.1, 0), 'io')),
        head=K((0, Z3), (0.26, Z3), (0.78, V(0.12, -0.04, 0.04), 'io')),
        clav_R=K((0, Z2), (0.16, V(-0.04, -0.05), 'soft'), (0.6, V(0.06, 0.32), 'io'), (0.95, V(0.05, 0.28), 'soft')),
        clav_L=K((0, Z2), (0.6, V(0.03, -0.04), 'io')),
        hand_R=to(REST['R'], REACH, K((0, 0), (0.16, -0.03, 'soft'), (0.74, 1, 'io')), K((0, Z3), (0.16, V(0, 0.01, -0.015), 'soft'), (0.44, V(0, 0.055, 0), 'soft'), (0.74, Z3, 'soft'))),
        bones=dict(jaw=K((0, V(0.012, 0, 0)), (0.5, V(-0.01, 0, 0), 'io'))),
    )


def aim():
    return dict(
        dur=1.3,
        # a breath in, the arm comes up round the shoulder, and the chin lifts: he dares it
        spine=K((0, Z3), (0.16, V(0.025, 0, 0), 'soft'), (0.7, V(-0.04, -0.035, -0.035), 'io'), (1.0, V(-0.035, -0.035, -0.03), 'soft')),
        chest=K((0, Z3), (0.6, V(-0.02, -0.08, 0), 'io')),
        chest_dy=K((0, 0), (0.16, -0.005, 'soft'), (0.7, 0.009, 'io')),
        neck=K((0, Z3), (0.36, Z3), (0.85, V(-0.05, 0.08, 0), 'io')),
        head=K((0, Z3), (0.4, Z3), (0.9, V(-0.1, 0, -0.05), 'over')),
        clav_R=K((0, Z2), (0.16, V(-0.05, 0), 'soft'), (0.65, V(0.3, -0.12), 'io'), (0.98, V(0.27, -0.11), 'soft')),
        clav_L=K((0, Z2), (0.7, V(0.05, 0.02), 'io')),
        hand_R=to(REST['R'], AIM, K((0, 0), (0.16, -0.03, 'soft'), (0.78, 1, 'over')), K((0, Z3), (0.44, V(-0.11, 0.02, 0.08), 'soft'), (0.78, Z3, 'soft'))),
        # the jaw sets
        bones=dict(jaw=K((0, V(0.012, 0, 0)), (0.5, V(0.012, 0, 0)), (0.9, V(-0.02, 0, 0), 'io'))),
    )


def hold_cards():
    return dict(
        dur=0.85,
        # he hunches over his cards and squints down at them
        spine=K((0, Z3), (0.5, V(0.03, 0, 0), 'io')),
        chest=K((0, Z3), (0.5, V(0, 0.03, 0), 'io')),
        neck=K((0, Z3), (0.22, Z3), (0.68, V(0.03, 0.06, 0), 'io')),
        head=K((0, Z3), (0.28, Z3), (0.74, V(0.07, 0, 0.02), 'io')),
        clav_L=K((0, Z2), (0.1, V(-0.02, 0), 'soft'), (0.5, V(0.08, 0.06), 'io'), (0.8, V(0.06, 0.05), 'soft')),
        hand_L=to(REST['L'], FAN, K((0, 0), (0.1, 0), (0.62, 1, 'over')), K((0, Z3), (0.34, V(0, 0.03, -0.01), 'soft'), (0.62, Z3, 'soft')), sway=0),
    )


def hold_glass():
    return dict(
        dur=0.85,
        spine=K((0, Z3), (0.55, V(-0.025, 0, 0), 'io')),
        clav_R=K((0, Z2), (0.55, V(0.1, 0.07), 'io'), (0.8, V(0.08, 0.06), 'soft')),
        head=K((0, Z3), (0.32, Z3), (0.75, V(0.07, 0, 0), 'io')),
        hand_R=to(REST['R'], sip(0, 0), K((0, 0), (0.66, 1, 'over')), K((0, Z3), (0.32, V(-0.02, 0.02, 0.02), 'soft'), (0.66, Z3, 'soft')), sway=K((0, 0.6), (0.55, 0, 'soft'))),
    )


def drink():
    held = dict(spine=V(-0.025, 0, 0), clav=V(0.08, 0.06), head=V(0.07, 0, 0))
    # a gulp: the glass comes up quick, he throws it back, and shakes his head after it
    lift = K((0, 0), (0.12, -0.08, 'soft'), (0.62, 1, 'io'), (1.12, 1), (1.72, 0, 'io'))
    tip = K((0, 0), (0.36, 0), (0.86, 0.95, 'io'), (1.1, 1, 'soft'), (1.5, 0, 'io'))
    return dict(
        dur=1.95,
        spine=K((0, held['spine']), (0.12, V(0.01, 0, 0), 'soft'), (0.84, V(-0.1, 0, 0.012), 'io'), (1.12, V(-0.105, 0, 0.012)), (1.8, held['spine'], 'io')),
        chest_dy=K((0, 0), (0.84, 0.008, 'io'), (1.12, 0.008), (1.7, 0, 'io')),
        neck=K((0, Z3), (0.44, Z3), (0.86, V(-0.1, 0, 0), 'io'), (1.12, V(-0.11, 0, 0)), (1.6, Z3, 'io')),
        head=K((0, held['head']), (0.36, V(0.11, 0, 0), 'soft'), (0.86, V(-0.5, 0, 0), 'io'), (1.12, V(-0.54, 0, 0), 'soft'),
               (1.5, V(0.1, 0.06, 0.02), 'io'), (1.64, V(0.1, -0.07, -0.02), 'soft'), (1.78, V(0.08, 0.03, 0.01), 'soft'), (1.95, held['head'], 'soft')),
        clav_R=K((0, held['clav']), (0.12, V(0.06, 0.06), 'soft'), (0.72, V(0.3, 0.03), 'io'), (1.12, V(0.3, 0.03)), (1.75, held['clav'], 'io')),
        hand_R=lambda t, ctx, side: (*sip(lift, tip)(t, ctx), 0),
        # the jaw drops to take the glass and shuts hard after it
        bones=dict(jaw=K((0, Z3), (0.5, Z3), (0.82, V(0.13, 0, 0), 'io'), (1.1, V(0.12, 0, 0)), (1.3, V(-0.02, 0, 0), 'snap'), (1.7, Z3, 'io'))),
    )


def flinch():
    # he's seen worse: a short hard jolt, eyes screwed, jaw clenched, no more
    return dict(
        dur=0.7,
        spine=K((0, Z3), (0.08, V(-0.035, 0, 0), 'snap'), (0.65, Z3, 'io')),
        chest_dy=K((0, 0), (0.08, -0.006, 'snap'), (0.65, 0, 'io')),
        neck=K((0, Z3), (0.09, V(0.05, 0, 0), 'snap'), (0.66, Z3, 'io')),
        head=K((0, Z3), (0.1, V(-0.07, 0.04, 0.03), 'snap'), (0.7, Z3, 'io')),
        clav_R=K((0, Z2), (0.08, V(0.13, 0.03), 'snap'), (0.66, Z2, 'io')),
        clav_L=K((0, Z2), (0.08, V(0.13, 0.03), 'snap'), (0.66, Z2, 'io')),
        bones=dict(jaw=K((0, V(0.012, 0, 0)), (0.08, V(-0.03, 0, 0), 'snap'), (0.6, V(0.012, 0, 0), 'io'))),
    )


def lean():
    return dict(
        dur=0.7,
        # he leans in on his forearms, shoulders hunched, chin out
        spine=K((0, Z3), (0.1, V(-0.015, 0, 0), 'soft'), (0.5, V(0.19, 0, 0), 'over')),
        chest=K((0, Z3), (0.5, V(0.02, 0, 0), 'io')),
        neck=K((0, Z3), (0.14, Z3), (0.58, V(-0.12, 0, 0), 'io')),
        head=K((0, Z3), (0.18, Z3), (0.64, V(0.0, 0, 0), 'over')),
        clav_R=K((0, Z2), (0.48, V(0.08, 0.14), 'io')),
        clav_L=K((0, Z2), (0.48, V(0.08, 0.14), 'io')),
    )


def slump():
    return dict(
        dur=1.6,
        # a last heave, then the bulk goes all at once and the head lolls, the jaw slack
        spine=K((0, Z3), (0.16, V(-0.035, 0, 0), 'soft'), (0.76, V(0.47, 0, 0.14), 'in'), (1.04, V(0.42, 0, 0.125), 'soft'), (1.36, V(0.435, 0, 0.13), 'soft')),
        chest_dy=K((0, 0), (0.16, 0.008, 'soft'), (0.8, -0.045, 'io')),
        neck=K((0, Z3), (0.28, Z3), (0.9, V(0, 0.25, 0), 'io')),
        head=K((0, Z3), (0.16, V(-0.05, 0, 0), 'soft'), (0.95, V(0.78, 0, 0.34), 'io'), (1.25, V(0.69, 0, 0.3), 'soft'), (1.5, V(0.71, 0, 0.31), 'soft')),
        clav_R=K((0, Z2), (0.16, V(0.06, 0), 'soft'), (0.85, V(-0.12, 0.08), 'io')),
        clav_L=K((0, Z2), (0.16, V(0.06, 0), 'soft'), (0.85, V(-0.12, 0.08), 'io')),
        hand_R=to(REST['R'], LIMP['R'], K((0, 0), (0.22, 0), (1.0, 1, 'over')), K((0, Z3), (0.55, V(-0.03, 0.03, 0.02), 'soft'), (1.0, Z3, 'soft'))),
        hand_L=to(REST['L'], LIMP['L'], K((0, 0), (0.28, 0), (1.08, 1, 'over')), K((0, Z3), (0.6, V(0.03, 0.03, 0.02), 'soft'), (1.08, Z3, 'soft')), sway=0),
        bones=dict(jaw=K((0, V(0.012, 0, 0)), (0.8, V(0.1, 0, 0), 'io'))),
    )


CLIPS = dict(idle=idle, reach=reach, aim=aim, hold_cards=hold_cards, hold_glass=hold_glass, drink=drink, flinch=flinch, lean=lean, slump=slump)


if __name__ == '__main__':
    BODY.build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'gristle.glb'), body_parts(), COLOURS, CLIPS, after=quantise.quantise)

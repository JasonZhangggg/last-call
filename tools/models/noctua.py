"""Madame Noctua, the owl-masked fortune teller: writes assets/models/noctua.glb.

    tools/models/build.sh noctua

Built on lib/biped.py like Brass. The look is a port of DESIGNS.noctua in src/render/characters.js;
the game swaps its own materials in by name (velvet, cape, lace, porcelain, mask, pearl, hat, ribbon,
plume, plume_dark, socket, iris, gem, brass). The hat, plumes, beak, tufts, collar and pearls are
rigid on the head, neck and chest. The capelet is skinned to the shoulders and upper arms and sits
over the puffed sleeves, which ride the upper arms, so neither is crossed by an arm.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from lib import meshkit as mk
from lib.meshkit import V, unit
from lib.biped import Body, SIDES, K, Z3, Z2, Fn, to
from lib import quantise

PI = math.pi
SHOULDER, SH_Y, SH_Z = 0.215, 0.245, -0.01
H = V(0, 0.5, 0)
# her eyes, in head space: each a ball turned a little outward, its lid a dome on its own bone
EYE = {s: V(sg * 0.058, 0.018, 0.108) for s, sg in SIDES}
BODY = Body('noctua', arm=dict(shoulder=0.045, elbow=0.037, wrist=0.03, gap=0.016), palm=(0.036, 0.042, 0.016), finger_r=0.0072,
            temple=V(-0.143, 0.045, 0.03), mouth=V(0, -0.085, 0.11), bones=[(f'lid.{s}', 'head', H + EYE[s]) for s, _ in SIDES])
REST, LIMP, REACH, AIM, FAN, sip = BODY.REST, BODY.LIMP, BODY.REACH, BODY.AIM, BODY.FAN, BODY.sip
COLOURS = dict(velvet=(0.29, 0.12, 0.3), cape=(0.12, 0.05, 0.11), lace=(0.91, 0.87, 0.81), porcelain=(0.95, 0.92, 0.88), mask=(0.95, 0.92, 0.88), pearl=(0.96, 0.94, 0.89),
               hat=(0.15, 0.1, 0.17), ribbon=(0.42, 0.16, 0.35), plume=(0.17, 0.48, 0.44), plume_dark=(0.08, 0.06, 0.09), socket=(0.08, 0.04, 0.06), iris=(1, 0.65, 0.2), gem=(0.18, 0.84, 0.75), brass=(0.85, 0.66, 0.35))
# the puffed sleeve, in the upper arm's space from the shoulder joint: centre and radii
PUFF_AT, PUFF_R = V(0, -0.042, 0), V(0.066, 0.082, 0.066)


# ---------- shapes ----------

def lathe_arc(pts, seg, phi0, phi_len):
    """Like three's LatheGeometry with a start and sweep: x = sin(phi) r, z = cos(phi) r."""
    pts = np.asarray(pts, float)
    ph = phi0 + np.linspace(0, 1, seg + 1) * phi_len
    P = np.stack([np.outer(np.sin(ph), pts[:, 0]), np.tile(pts[:, 1], (seg + 1, 1)), np.outer(np.cos(ph), pts[:, 0])], -1).reshape(-1, 3)
    u, v = np.meshgrid(np.linspace(0, 1, seg + 1), np.linspace(0, 1, len(pts)), indexing='ij')
    g = mk.Geo(P, np.zeros_like(P), np.stack([u, v], -1).reshape(-1, 2), mk._grid_faces(seg, len(pts) - 1))
    g.phi = np.repeat(ph, len(pts)); g.row = np.tile(np.arange(len(pts)), seg + 1)
    return g


def octahedron(r):
    D = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)]
    P, N, F = [], [], []
    for a in (0, 1):
        for b in (2, 3):
            for c in (4, 5):
                tri = [D[a] * r, D[b] * r, D[c] * r]; n = unit(D[a] + D[b] + D[c])
                k = len(P); P += tri; N += [n] * 3; F.append([k, k + 1, k + 2])
    return mk.Geo(P, N, np.zeros((len(P), 2)), F)


def feather(pts, w):
    """A plume: a strip along a spline, widest a little past its root and narrowing to the tip."""
    c = mk.catmull(pts, 16)
    t = np.linspace(0, 1, 17)
    tan = unit(np.gradient(c, axis=0))
    wid = w * np.sin(PI * np.minimum(1, t * 1.15)) * (1 - t * 0.3)
    P, UV = [], []
    for i in range(17):
        for side in (-0.5, 0.5):
            P.append(c[i] + V(side * wid[i], 0, side * wid[i] * 0.4)); UV.append((side + 0.5, t[i]))
    P = np.array(P)
    g = mk.Geo(P, np.zeros_like(P), UV, mk._grid_faces(16, 1))
    g.N = unit(np.repeat(np.cross(tan, V(1, 0, 0.4)), 2, axis=0))
    return g


def lumpy(g, amp, seed=0):
    rng = np.random.default_rng(seed); k = rng.normal(size=(4, 3)) * 60; ph = rng.uniform(0, mk.TAU, 4)
    d = sum(np.sin(g.P @ k[i] + ph[i]) for i in range(4)) / 4
    g.P = g.P + g.N * (amp * d)[:, None]
    return g.smooth_normals()


# ---------- the look ----------

def puff_frame(sg):
    return V(sg * SHOULDER, SH_Y, SH_Z) + PUFF_AT


def puff(side, sg):
    """The puffed sleeve cap: gathered velvet round the top of the upper arm, tied off with a ribbon."""
    g = mk.sphere(1, 24, 14)
    x, y, z = g.P.T
    ph = np.arctan2(z, x); gather = 1 + 0.06 * np.cos(ph * 9) * (1 - y * y)
    # gathered in at the bottom, where the sleeve comes out of it
    pinch = 1 - 0.35 * mk.smoothstep(-0.3, -1, y)
    inner = np.where(x * sg < 0, 0.6, 1.0)
    g.P = np.stack([x * gather * pinch * inner, y, z * gather * pinch], -1) * PUFF_R + puff_frame(sg)
    g.smooth_normals()
    band = mk.ring(puff_frame(sg) + V(0, -PUFF_R[1] * 0.84, 0), V(0, 1, 0), PUFF_R[0] * 0.66, 0.006, 6, 24)
    return [('velvet', g.bind(f'upperarm.{side}')), ('ribbon', band.bind(f'upperarm.{side}'))]


def torso_r(y):
    prof = np.array([[0.18, -0.3], [0.185, -0.22], [0.145, -0.1], [0.15, 0.0], [0.178, 0.12], [0.17, 0.24], [0.13, 0.32], [0.06, 0.37], [0, 0.375]])
    return np.interp(y, prof[:, 1], prof[:, 0])


def capelet():
    """A shoulder cape, open at the front, with a scalloped hem. Pushed out over the body and the
    puffs, then skinned: over each shoulder it rides the upper arm, toward the neck the clavicle,
    and the rest the chest."""
    prof = [(0.29, 0.13), (0.285, 0.17), (0.275, 0.215), (0.255, 0.262), (0.22, 0.3), (0.175, 0.328), (0.125, 0.352), (0.08, 0.374)]
    g = lathe_arc(prof, 64, 0.5, mk.TAU - 1.0)
    g.P[:, 0] *= 1.1; g.P[:, 2] *= 0.9
    hem = g.row == 0
    g.P[hem, 1] += np.abs(np.sin(g.phi[hem] * 7)) * 0.03 - 0.012
    g.P[g.row == 1, 1] += (np.abs(np.sin(g.phi[g.row == 1] * 7)) * 0.03 - 0.012) * 0.35
    # clear of the body by 1 cm, and of each puff by 1.4 cm
    for _ in range(3):
        for i, p in enumerate(g.P):
            r_body = torso_r(p[1]); ex = V(1.1, 1, 0.84) * r_body
            if ex[0] > 0:
                k = math.hypot(p[0] / (ex[0] + 0.01), p[2] / (ex[2] + 0.01))
                if k < 1:
                    g.P[i, 0] /= k; g.P[i, 2] /= k
            for _, sg in SIDES:
                c = puff_frame(sg); R = PUFF_R * 1.06 + 0.014
                q = (g.P[i] - c) / R; k = float(np.linalg.norm(q))
                if k < 1:
                    g.P[i] = c + q / k * R
    g.smooth_normals()
    # skin weights from how near each point is to the shoulder joint
    W = np.zeros((len(g.P), 5)); W[:, 0] = 1
    bones = ['chest', 'clavicle.R', 'upperarm.R', 'clavicle.L', 'upperarm.L']
    for side, sg in SIDES:
        j = 1 if side == 'R' else 3
        d = np.linalg.norm(g.P - (V(sg * SHOULDER, SH_Y, SH_Z) + V(0, -0.02, 0)), axis=1)
        up = 1 - mk.smoothstep(0.11, 0.21, d)
        cl = (1 - up) * (1 - mk.smoothstep(0.16, 0.27, d)) * 0.8
        W[:, j + 1] = up; W[:, j] = cl; W[:, 0] -= up + cl
    W[:, 0] = np.maximum(W[:, 0], 0)
    return g.skin(bones, W + 1e-9)


def collar():
    """The standing lace collar fanned behind the head, and the ruff at the throat."""
    g = lathe_arc([(0.09, 0.345), (0.15, 0.44), (0.235, 0.565)], 28, PI * 0.4, PI * 1.2)
    top = g.row == 2
    g.P[top, 1] += np.cos(g.phi[top] * 11) * 0.025
    g.P += V(0, -0.02, -0.025)
    g.smooth_normals()
    w = mk.smoothstep(0.36, 0.5, g.P[:, 1])
    g.skin(['chest', 'neck'], np.stack([1 - w * 0.7, w * 0.7], 1))
    ruff = lumpy(mk.torus(0.075, 0.022, 8, 28).place((0, 0.36, 0), (PI / 2 + 0.15, 0, 0)), 0.012, 3).bind('neck')
    return [('lace', g), ('lace', ruff)]


def body_parts():
    parts = []
    add = lambda mat, bone, *geos: parts.extend((mat, g.bind(bone)) for g in geos)
    # the bodice
    add('velvet', 'chest', mk.lathe([[0, -0.3], [0.18, -0.3], [0.185, -0.22], [0.145, -0.1], [0.15, 0.0], [0.178, 0.12], [0.17, 0.24], [0.13, 0.32], [0.06, 0.37], [0, 0.375]], 36).place(s=(1.1, 1, 0.84)))
    parts.append(('cape', capelet()))
    parts += collar()
    # pearls in two loops, a brooch with its gem, and buttons down the front
    for rx, ry, n, y0 in ((0.07, 0.06, 17, 0.33), (0.09, 0.1, 23, 0.33)):
        for i in range(n):
            a = PI * (0.06 + 0.88 * i / (n - 1))
            add('pearl', 'chest', mk.sphere(0.0068, 8, 5).place((math.cos(a) * rx * 1.4, y0 - math.sin(a) * ry, 0.118 + math.sin(a) * 0.03)))
    add('brass', 'chest', mk.torus(0.022, 0.004, 6, 20).place((0, 0.2, 0.158), (-0.3, 0, 0), (1, 1.3, 1)))
    add('gem', 'chest', octahedron(0.022).place((0, 0.2, 0.165), (-0.3, 0, 0), (1, 1.3, 0.6)))
    for i in range(4):
        add('brass', 'chest', mk.sphere(0.009, 8, 5).place((0, 0.08 - i * 0.055, 0.15 - i * 0.008), s=(1, 1, 0.6)))
    add('porcelain', 'neck', mk.cylinder(0.048, 0.055, 0.12, 16, True).place((0, 0.4, 0)))
    head_parts(add)
    for side, sg in SIDES:
        parts += arm_parts(side, sg)
    return parts


def head_parts(add):
    add('mask', 'head', mk.sphere(0.15, 40, 28).place(H, s=(1, 1.1, 0.95)))
    for side, sg in SIDES:
        e, turn = H + EYE[side], (0, sg * 0.35, 0)
        add('socket', 'head', mk.sphere(0.038, 20, 14).place(e, turn))
        add('iris', 'head', mk.circle(0.022, 24).place(V(0, 0, 0.0372), (0, 0, 0)).place(e, turn))
        add('socket', 'head', mk.circle(0.008, 14).place(V(0, 0, 0.0376)).place(e, turn))
        # the lid is a dome over the eye's top half; the game turns its bone down over the eye
        add('porcelain', f'lid.{side}', mk.sphere(0.041, 20, 7, 0, mk.TAU, 0, PI / 2).place(e))
        add('porcelain', 'head', mk.torus(0.05, 0.007, 8, 32).place(H + V(sg * 0.06, 0.016, 0.118), turn, (1, 1.15, 1)))
        # the brows sweep up and out into feather tufts
        add('porcelain', 'head', mk.sweep([H + V(sg * 0.025, 0.06, 0.142), H + V(sg * 0.07, 0.075, 0.13), H + V(sg * 0.115, 0.09, 0.098), H + V(sg * 0.15, 0.12, 0.06)], lambda t: 0.011 * (1 - t * 0.75), 16, 8, caps=True))
        for k, (dx, dy, dz) in enumerate(((0.012, 0.035, -0.01), (0.03, 0.012, -0.02))):
            add('porcelain', 'head', mk.sweep([H + V(sg * 0.12, 0.1, 0.08), H + V(sg * (0.15 + dx), 0.13 + dy * 0.5, 0.055 + dz), H + V(sg * (0.165 + dx), 0.145 + dy, 0.035 + dz)], lambda t: 0.008 * (1 - t * 0.8), 10, 6, caps=True))
    add('brass', 'head', mk.cylinder(0.0008, 0.02, 0.07, 14).place(H + V(0, -0.04, 0.15), (PI / 2 + 0.6, 0, 0)))
    # the wide hat: an upturned brim, the crown, a ribbon band and edging, a bow, plumes and a pin
    tilt = (-0.14, 0, 0.07)
    hat = lambda g, at: g.place(at, tilt)
    brim = mk.lathe([[0.11, 0.004], [0.24, -0.006], [0.3, 0.008], [0.318, 0.035], [0.31, 0.036], [0.29, 0.016], [0.24, 0.006], [0.11, 0.014]], 56)
    add('hat', 'head', hat(brim, H + V(0, 0.125, -0.005)))
    add('hat', 'head', hat(mk.lathe([[0.13, 0], [0.125, 0.08], [0.115, 0.13], [0.09, 0.15], [0, 0.155]], 40), H + V(0, 0.13, -0.015)))
    add('ribbon', 'head', hat(mk.cylinder(0.129, 0.131, 0.032, 40, True), H + V(0, 0.15, -0.012)))
    add('ribbon', 'head', hat(mk.torus(0.315, 0.005, 6, 64).place((0, 0.034, 0), (PI / 2, 0, 0)), H + V(0, 0.125, -0.005)))
    add('ribbon', 'head', mk.sphere(1, 10, 7).place(H + V(0.12, 0.155, -0.04), s=(0.018, 0.032, 0.03)))
    add('plume', 'head', feather([H + V(0.11, 0.17, -0.04), H + V(0.17, 0.3, -0.08), H + V(0.15, 0.42, -0.16), H + V(0.08, 0.47, -0.24)], 0.035))
    add('plume_dark', 'head', feather([H + V(0.12, 0.16, -0.06), H + V(0.2, 0.26, -0.1), H + V(0.24, 0.33, -0.2)], 0.025))
    add('plume', 'head', feather([H + V(0.1, 0.17, -0.02), H + V(0.13, 0.27, 0.0), H + V(0.12, 0.34, -0.05)], 0.018))
    add('brass', 'head', mk.sphere(0.012, 10, 7).place(H + V(0.12, 0.16, -0.02)))


def arm_parts(side, sg):
    """One arm: the shared sleeve and gloved hand, the puff at the shoulder and a lace frill at the hem."""
    tube, hand = BODY.arm_parts(side, sg)
    e = BODY.sleeve_end()
    frill = mk.lathe([[0.029, e + 0.026], [0.032, e + 0.008], [0.035, e - 0.005], [0.038, e - 0.011]], 32)
    x, y, z = frill.P.T
    w = np.maximum(0, e - y + 0.004) * 7 * np.sin(np.arctan2(z, x) * 11)
    frill.P = np.stack([x * (1 + w * 0.12), y + w * 0.004, z * (1 + w * 0.12)], -1) + V(sg * SHOULDER, SH_Y, SH_Z)
    frill.smooth_normals()
    return [('velvet', tube), ('lace', frill.bind(f'forearm.{side}')), ('porcelain', hand)] + puff(side, sg)


# ---------- clips ----------
# Poised and a little theatrical: she moves slower than Brass and finishes each gesture with a small
# flourish of the head. Each clip keys the body's channels and says where each hand is going; times
# are seconds, a key is (time, value, ease into it). Every clip but `idle` and `drink` starts from the
# rest pose; `drink` starts and ends on `hold_glass`'s last frame.
BREATH = 4.2


def idle():
    b = lambda t: math.sin(mk.TAU * t / BREATH) + 0.18 * math.sin(2 * mk.TAU * t / BREATH)
    sway = lambda t: math.sin(mk.TAU * t / (2 * BREATH))
    return dict(
        dur=2 * BREATH,
        # the head tilting slowly as if listening. Every term is 0 at t = 0: the other clips are
        # layered on as their difference from this first frame, and they start from the rest pose.
        spine=Fn(lambda t: V(0.003 * sway(2 * t), 0.01 * sway(t), 0.005 * sway(t))),
        chest=Fn(lambda t: V(-0.008 * b(t), 0, 0)),
        chest_dy=Fn(lambda t: 0.004 * b(t)),
        neck=Fn(lambda t: V(0.006 * b(t), -0.014 * sway(t), 0)),
        head=Fn(lambda t: V(0, 0.008 * sway(2 * t), 0.03 * sway(t))),
        clav_R=Fn(lambda t: V(0.018 * b(t), 0)),
        clav_L=Fn(lambda t: V(0.018 * b(t), 0)),
    )


def reach():
    return dict(
        dur=1.0,
        # she draws herself up, then leans in with the shoulder leading and the head following last
        spine=K((0, Z3), (0.14, V(-0.02, -0.025, 0), 'soft'), (0.58, V(0.1, 0.16, -0.03), 'io'), (0.86, V(0.09, 0.15, -0.025), 'soft')),
        chest=K((0, Z3), (0.15, V(0, -0.025, 0), 'soft'), (0.6, V(0.03, 0.08, 0), 'io')),
        neck=K((0, Z3), (0.2, V(0.02, 0, 0), 'soft'), (0.68, V(-0.12, -0.08, 0), 'io')),
        head=K((0, Z3), (0.24, V(-0.03, 0, 0)), (0.75, V(0.08, -0.05, 0.08), 'over')),
        clav_R=K((0, Z2), (0.14, V(-0.03, -0.04), 'soft'), (0.56, V(0.06, 0.28), 'io'), (0.9, V(0.05, 0.25), 'soft')),
        clav_L=K((0, Z2), (0.6, V(0.02, -0.04), 'io')),
        hand_R=to(REST['R'], REACH, K((0, 0), (0.14, 0), (0.7, 1, 'io')), K((0, Z3), (0.14, V(0, 0.015, -0.01), 'soft'), (0.42, V(0, 0.06, 0.01), 'soft'), (0.7, Z3, 'soft'))),
    )


def aim():
    return dict(
        dur=1.3,
        # a breath in, then the arm swings up in one long arc; the chin lifts and the head turns away
        spine=K((0, Z3), (0.16, V(0.02, 0, 0), 'soft'), (0.7, V(-0.04, -0.035, -0.03), 'io'), (1.0, V(-0.035, -0.035, -0.025), 'soft')),
        chest=K((0, Z3), (0.6, V(-0.02, -0.07, 0), 'io')),
        chest_dy=K((0, 0), (0.16, -0.003, 'soft'), (0.7, 0.008, 'io')),
        neck=K((0, Z3), (0.35, Z3), (0.85, V(-0.05, 0.12, 0), 'io')),
        head=K((0, Z3), (0.4, Z3), (0.92, V(-0.1, 0.03, -0.04), 'over')),
        clav_R=K((0, Z2), (0.16, V(-0.04, 0), 'soft'), (0.62, V(0.3, -0.1), 'io'), (0.95, V(0.26, -0.1), 'soft')),
        clav_L=K((0, Z2), (0.7, V(0.04, 0), 'io')),
        hand_R=to(REST['R'], AIM, K((0, 0), (0.16, -0.02, 'soft'), (0.76, 1, 'over')), K((0, Z3), (0.44, V(-0.12, 0.03, 0.08), 'soft'), (0.76, Z3, 'soft'))),
    )


def hold_cards():
    return dict(
        dur=0.85,
        # the fan comes up with a little turn of the wrist, the head tilts to read it
        chest=K((0, Z3), (0.5, V(0, 0.03, 0), 'io')),
        neck=K((0, Z3), (0.22, Z3), (0.66, V(0.03, 0.06, 0), 'io')),
        head=K((0, Z3), (0.28, Z3), (0.72, V(0.05, 0, -0.06), 'over')),
        clav_L=K((0, Z2), (0.1, V(-0.02, 0), 'soft'), (0.5, V(0.1, 0.05), 'io'), (0.8, V(0.07, 0.04), 'soft')),
        hand_L=to(REST['L'], FAN, K((0, 0), (0.1, 0), (0.62, 1, 'over')), K((0, Z3), (0.34, V(0, 0.04, -0.01), 'soft'), (0.62, Z3, 'soft')), sway=0),
    )


def hold_glass():
    return dict(
        dur=0.85,
        spine=K((0, Z3), (0.55, V(-0.025, 0, 0), 'io')),
        clav_R=K((0, Z2), (0.55, V(0.1, 0.06), 'io'), (0.8, V(0.08, 0.05), 'soft')),
        head=K((0, Z3), (0.32, Z3), (0.75, V(0.05, 0, 0.04), 'io')),
        hand_R=to(REST['R'], sip(0, 0), K((0, 0), (0.66, 1, 'over')), K((0, Z3), (0.32, V(-0.02, 0.025, 0.02), 'soft'), (0.66, Z3, 'soft')), sway=K((0, 0.6), (0.55, 0, 'soft'))),
    )


def drink():
    held = dict(spine=V(-0.025, 0, 0), clav=V(0.08, 0.05), head=V(0.05, 0, 0.04))
    lift = K((0, 0), (0.16, -0.1, 'soft'), (0.76, 1, 'io'), (1.3, 1), (1.9, 0, 'io'))
    tip = K((0, 0), (0.45, 0), (1.0, 0.92, 'io'), (1.28, 1, 'soft'), (1.7, 0, 'io'))
    return dict(
        dur=2.05,
        # she sits back and tips her head to the glass with a flourish, then comes forward again
        spine=K((0, held['spine']), (0.16, V(0, 0, 0), 'soft'), (0.95, V(-0.08, 0, 0.015), 'io'), (1.28, V(-0.085, 0, 0.015)), (1.95, held['spine'], 'io')),
        chest_dy=K((0, 0), (0.95, 0.006, 'io'), (1.28, 0.006), (1.9, 0, 'io')),
        neck=K((0, Z3), (0.5, Z3), (1.0, V(-0.1, 0, 0), 'io'), (1.28, V(-0.11, 0, 0)), (1.8, Z3, 'io')),
        head=K((0, held['head']), (0.42, V(0.1, 0, 0.03), 'soft'), (1.0, V(-0.36, 0, -0.03), 'io'), (1.28, V(-0.4, 0, -0.04), 'soft'), (1.8, V(0.08, 0, 0.05), 'io'), (2.05, held['head'], 'soft')),
        clav_R=K((0, held['clav']), (0.16, V(0.06, 0.05), 'soft'), (0.85, V(0.3, 0.02), 'io'), (1.28, V(0.3, 0.02)), (1.9, held['clav'], 'io')),
        hand_R=lambda t, ctx, side: (*sip(lift, tip)(t, ctx), 0),
    )


def flinch():
    # a gasp: the shoulders rise, the head draws back and turns from the shot
    return dict(
        dur=0.8,
        spine=K((0, Z3), (0.09, V(-0.06, 0, 0), 'snap'), (0.75, Z3, 'io')),
        chest_dy=K((0, 0), (0.09, -0.006, 'snap'), (0.75, 0, 'io')),
        neck=K((0, Z3), (0.1, V(0.03, 0.08, 0), 'snap'), (0.76, Z3, 'io')),
        head=K((0, Z3), (0.11, V(-0.14, 0.06, 0.05), 'snap'), (0.8, Z3, 'io')),
        clav_R=K((0, Z2), (0.08, V(0.24, 0.05), 'snap'), (0.75, Z2, 'io')),
        clav_L=K((0, Z2), (0.08, V(0.24, 0.05), 'snap'), (0.75, Z2, 'io')),
    )


def lean():
    # in over the table, conspiratorial, the head cocked
    return dict(
        dur=0.7,
        spine=K((0, Z3), (0.1, V(-0.015, 0, 0), 'soft'), (0.5, V(0.15, 0, 0), 'over')),
        neck=K((0, Z3), (0.14, Z3), (0.56, V(-0.09, 0, 0), 'io')),
        head=K((0, Z3), (0.2, Z3), (0.64, V(0.03, 0, 0.1), 'over')),
        clav_R=K((0, Z2), (0.45, V(0.04, 0.1), 'io')),
        clav_L=K((0, Z2), (0.45, V(0.04, 0.1), 'io')),
    )


def slump():
    # a swoon: a last lift of the chin, then she sinks back and to the side, the head falling away
    return dict(
        dur=1.6,
        spine=K((0, Z3), (0.18, V(-0.04, 0, 0), 'soft'), (0.8, V(0.38, 0, -0.14), 'in'), (1.08, V(0.35, 0, -0.13), 'soft'), (1.4, V(0.36, 0, -0.13), 'soft')),
        chest_dy=K((0, 0), (0.18, 0.006, 'soft'), (0.82, -0.04, 'io')),
        neck=K((0, Z3), (0.3, Z3), (0.92, V(0, -0.25, 0), 'io')),
        head=K((0, Z3), (0.18, V(-0.08, 0, 0), 'soft'), (0.98, V(0.72, 0, -0.38), 'io'), (1.28, V(0.64, 0, -0.34), 'soft'), (1.55, V(0.66, 0, -0.35), 'soft')),
        clav_R=K((0, Z2), (0.18, V(0.05, 0), 'soft'), (0.88, V(-0.12, 0.08), 'io')),
        clav_L=K((0, Z2), (0.18, V(0.05, 0), 'soft'), (0.88, V(-0.12, 0.08), 'io')),
        hand_R=to(REST['R'], LIMP['R'], K((0, 0), (0.24, 0), (1.02, 1, 'over')), K((0, Z3), (0.55, V(-0.03, 0.03, 0.02), 'soft'), (1.02, Z3, 'soft'))),
        hand_L=to(REST['L'], LIMP['L'], K((0, 0), (0.3, 0), (1.1, 1, 'over')), K((0, Z3), (0.6, V(0.03, 0.03, 0.02), 'soft'), (1.1, Z3, 'soft')), sway=0),
    )


CLIPS = dict(idle=idle, reach=reach, aim=aim, hold_cards=hold_cards, hold_glass=hold_glass, drink=drink, flinch=flinch, lean=lean, slump=slump)


if __name__ == '__main__':
    BODY.build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'noctua.glb'), body_parts(), COLOURS, CLIPS, after=quantise.quantise)

"""The shared hand: its shape, its finger bones and the poses that close it round a prop.

A port of the hand in src/render/characters.js (same proportions, same grip on the revolver and
the glass), but as one skinned mesh with three bones a digit instead of morph targets.

The hand frame (a right hand; mirror in x for the left): palm centre at the origin, palm facing +z,
fingers along +y, thumb on +x, the wrist joint at WRIST.
"""
import math
import numpy as np
from . import meshkit as mk
from .meshkit import V, unit
from .pose import q_between, q_from_mat, compose

WRIST = V(0, -0.068, -0.004)
FINGERS = [
    dict(name='index', at=(0.025, 0.04), len=(0.033, 0.021, 0.017), splay=0.07, r=1),
    dict(name='middle', at=(0.0085, 0.043), len=(0.036, 0.023, 0.018), splay=0.0, r=1.03),
    dict(name='ring', at=(-0.0085, 0.041), len=(0.034, 0.022, 0.017), splay=-0.06, r=0.97),
    dict(name='little', at=(-0.0245, 0.035), len=(0.027, 0.017, 0.015), splay=-0.14, r=0.85),
]
THUMB = dict(at=(0.017, -0.03), len=(0.036, 0.027, 0.023))
TAPER, THUMB_TAPER = [1, 0.9, 0.82, 0.7], [1.18, 1.08, 0.98, 0.84]
JOINT_MAX = [1.55, 1.8, 1.25]
DIGITS = [f['name'] for f in FINGERS] + ['thumb']

# the revolver (src/render/gun.js): its grip origin in model space and the grip's outline
GUN_GRIP = V(0, -0.046, -0.056)
GRIP_HALF = 0.0135
GRIP_UP = unit(V(0, 1, 0.32))
front_z = lambda y: -0.0265 + (y + 0.03) * 0.3
back_z = lambda y: -0.0715 + (y + 0.03) * 0.35
# a shot glass (src/render/diceTable.js): radius at its base and rim, and height
GLASS = dict(r0=0.0192, r1=0.0218, h=0.056)


def hand_rig(palm=(0.042, 0.046, 0.02), r=0.0085):
    sx, sy, sz = palm[0] / 0.042, palm[1] / 0.046, palm[2] / 0.02
    return dict(
        sx=sx, sy=sy, sz=sz, r=r, front=0.0105 * sz,
        fingers=[dict(name=f['name'], k=V(f['at'][0] * sx, f['at'][1] * sy, -0.001), len=[l * sy for l in f['len']], splay=f['splay'], r=r * f['r']) for f in FINGERS],
        thumb=dict(k=V(THUMB['at'][0] * sx, THUMB['at'][1] * sy, 0.002 * sz), len=[l * sy for l in THUMB['len']], r=r),
    )


def finger_joints(f, bend):
    """Knuckle, two joints and tip for bends [knuckle, middle, end] (each adds to the last), and the hinge axis."""
    sp = f['splay'] * (1 - 0.5 * min(1, bend[0])); s, c = math.sin(sp), math.cos(sp)
    J, a = [f['k'].copy()], 0.0
    for j in range(3):
        a += bend[j]
        J.append(J[-1] + V(s * math.cos(a), c * math.cos(a), math.sin(a)) * f['len'][j])
    return J, V(c, -s, 0)


def thumb_joints(t, p):
    """The thumb for [spread, lift, roll, bend1, bend2], and its hinge axis."""
    spread, lift, roll, b1, b2 = p
    m = V(math.sin(spread) * math.cos(lift), math.cos(spread) * math.cos(lift), math.sin(lift))
    n = unit(V(0, 1, 0) - m * m[1]); c = np.cross(m, n); n = n * math.cos(roll) + c * math.sin(roll)
    J = [t['k'].copy()]
    J.append(J[0] + m * t['len'][0])
    J.append(J[1] + (m * math.cos(b1) + n * math.sin(b1)) * t['len'][1])
    J.append(J[2] + (m * math.cos(b1 + b2) + n * math.sin(b1 + b2)) * t['len'][2])
    return J, unit(np.cross(m, n))


def _touches(J, start, rad, sdfs):
    for j in range(start, 3):
        for k in range(1, 5):
            t = k / 4
            if sdfs[j](J[j] + (J[j + 1] - J[j]) * t) < rad[j] + (rad[j + 1] - rad[j]) * t:
                return True
    return False


def _close_chain(joints, bend, idx, rad, sdfs, limit):
    """Each joint in turn bends until the digit beyond it would touch the thing, so it wraps joint by joint."""
    b = list(bend)
    for k, i in enumerate(idx):
        seg = 3 - len(idx) + k
        while b[i] > -0.5 and _touches(joints(b)[0], seg, rad, sdfs):
            b[i] -= 0.02
        while b[i] < limit[k]:
            b[i] += 0.02
            if _touches(joints(b)[0], seg, rad, sdfs):
                b[i] -= 0.02
                break
    return b


def wrap_fingers(rig, sdf, start):
    palm = lambda p: max(abs(p[0]) - 0.036 * rig['sx'], abs(p[1]) - 0.042 * rig['sy'], p[2] - rig['front']) + 0.003
    both = lambda p: min(sdf(p), palm(p))
    return [_close_chain(lambda b, f=f: finger_joints(f, b), start, [0, 1, 2], [k * f['r'] for k in TAPER], [sdf, both, both], JOINT_MAX) for f in rig['fingers']]


def wrap_thumb(rig, sdf, base):
    return _close_chain(lambda b: thumb_joints(rig['thumb'], b), base, [3, 4], [k * rig['r'] for k in THUMB_TAPER], [sdf, sdf, sdf], [1.2, 1.3])


def grip_sdf(p):
    """The revolver's grip as a signed distance in gun model space."""
    y = min(-0.012, max(-0.1, p[1])); zc = (front_z(y) + back_z(y)) / 2; hd = (front_z(y) - back_z(y)) / 2; rc = 0.008
    qx, qz = abs(p[0]) - (GRIP_HALF - rc), abs(p[2] - zc) - (hd - rc)
    slab = math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0) - rc
    frame = max(abs(p[0]) - 0.016, abs(p[1] - 0.004) - 0.025, abs(p[2] + 0.008) - 0.04)
    return min(max(slab, -0.1 - p[1]), frame)


def to_grip(rig):
    """Hand frame to the revolver's grip frame (its origin the middle of the grip, +z along the barrel)."""
    z = V(1, 0, 0); fwd = V(0, -GRIP_UP[2], GRIP_UP[1])
    x = GRIP_UP * math.cos(0.05) - fwd * math.sin(0.05); y = np.cross(z, x)
    at = V(-(GRIP_HALF + rig['front'] + 0.001), -0.06, front_z(-0.06) - 0.004) + y * (-0.04 * rig['sy']) + x * 0.004
    M = np.eye(4); M[:3, :3] = np.stack([x, y, z], 1); M[:3, 3] = at - GUN_GRIP
    return M


def glass_in_hand(rig):
    """A held glass in the hand frame: its base and its axis (base to rim)."""
    return V(-0.012 * rig['sx'], 0.028 * rig['sy'], rig['front'] + GLASS['r1'] + 0.001), V(1, 0, 0)


def glass_sdf(base, axis):
    def sdf(p):
        v = p - base; h = float(np.dot(v, axis)); v = v - axis * h
        side = np.linalg.norm(v) - (GLASS['r0'] + (GLASS['r1'] - GLASS['r0']) * min(1, max(0, h / GLASS['h'])))
        cap = max(-h, h - GLASS['h'])
        return math.hypot(max(side, 0), max(cap, 0)) + min(max(side, cap), 0)
    return sdf


def loose(b, step=0.06):
    return [[v + i * step * (1 if j == 0 else 0.6) for j, v in enumerate(b)] for i in range(4)]


OPEN = dict(fingers=loose([0.12, 0.2, 0.12]), thumb=[0.55, 0.35, 0.6, 0.25, 0.3])
SPREAD = dict(fingers=[[0.02, 0.06, 0.03], [0, 0.05, 0.03], [0.02, 0.05, 0.03], [0.05, 0.06, 0.03]], thumb=[1.0, 0.55, 0.8, 0.02, 0.05])
FAN = dict(fingers=loose([0.22, 0.42, 0.36], 0.07), thumb=[0.6, 0.55, 0.9, 0.25, 0.3])


def right_hand_poses(rig):
    """The right hand closed on the revolver and round a glass, and the glass socket in the grip frame."""
    G = to_grip(rig); Gm = G.copy(); Gm[:3, 3] += GUN_GRIP
    grip = lambda p: grip_sdf(Gm[:3, :3] @ p + Gm[:3, 3])
    fist = dict(fingers=wrap_fingers(rig, grip, [0.1, 0.15, 0.75]))
    fist['fingers'][0] = [0.3, 1.05, 0.65]
    fist['thumb'] = wrap_thumb(rig, grip, [0.4, 0.9, 0.1, 0, 0])
    base, axis = glass_in_hand(rig); gs = glass_sdf(base, axis)
    wrap = dict(fingers=wrap_fingers(rig, gs, [0.2, 0.3, 0.1]), thumb=wrap_thumb(rig, gs, [0.05, 1.0, 0, 0, 0]))
    glass = compose(G[:3, :3] @ base + G[:3, 3], q_between(V(0, 1, 0), G[:3, :3] @ axis))
    return dict(fist=fist, glass=wrap), glass


def digit_frames(rig, pose):
    """Per digit: its three bone joints and each bone's frame (columns: hinge, along the bone, the third)."""
    out = {}
    chains = [(f['name'], finger_joints(f, b)) for f, b in zip(rig['fingers'], pose['fingers'])] + [('thumb', thumb_joints(rig['thumb'], pose['thumb']))]
    for name, (J, h) in chains:
        F = []
        for j in range(3):
            d = unit(J[j + 1] - J[j]); hh = unit(h - d * np.dot(h, d))
            F.append(np.stack([hh, d, np.cross(hh, d)], 1))
        out[name] = (J, F)
    return out


def digit_rotations(rig, pose, rest=OPEN):
    """Each finger bone's rotation in the hand frame from the rest pose to `pose`, as 3x3 matrices."""
    a, b = digit_frames(rig, rest), digit_frames(rig, pose)
    return {name: [b[name][1][j] @ a[name][1][j].T for j in range(3)] for name in a}


def _digit(pts, radii, bones, joints_at, total_at):
    """A tapered tube through `pts`, a little fuller at the joints, weighted along `bones`."""
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + float(np.linalg.norm(pts[i] - pts[i - 1])))
    total = cum[-1]

    def radius(t):
        s = t * total; i = 1
        while i < len(cum) - 1 and cum[i] < s:
            i += 1
        u = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
        r = radii[i - 1] + (radii[i] - radii[i - 1]) * u
        for k in range(2, len(cum) - 1):
            r += radii[k] * 0.07 * math.exp(-(((s - cum[k]) / (radii[k] * 0.9)) ** 2))
        return r

    seg = 13
    g = mk.sweep(pts, radius, seg, 8)
    s = g.ring_of / seg * total
    W = np.zeros((len(g.P), len(bones))); W[:, 0] = 1
    for k, i in enumerate(joints_at):
        f = mk.smoothstep(cum[i] - radii[i] * 1.1, cum[i] + radii[i] * 1.1, s)
        W[:, k + 1] = W[:, k] * f; W[:, k] *= 1 - f
    g.skin(bones, W)
    tip = mk.sphere(radii[-1], 8, 4).place(pts[-1]).bind(bones[-1])
    return [g, tip]


def hand_geometry(rig, side='R'):
    """The hand in its rest (open) pose in the hand frame, skinned to hand.<side> and its finger bones."""
    sx, sy, sz = rig['sx'], rig['sy'], rig['sz']
    hand = f'hand.{side}'
    parts = []
    W_, H_, D_ = 0.038 * sx, 0.045 * sy, 0.0125 * sz
    g = mk.round_box(2 * W_, 2 * H_, 2 * D_, 0.4, 16, 10)
    x, y, z = g.P.T.copy()
    u, e = (y / H_ + 1) / 2, x / W_
    x = x * (0.82 + 0.18 * np.minimum(1, u * 1.5)); z = z * (1.05 - 0.28 * u) * np.where(z > 0, 0.88, 1)
    z = z + 0.004 * sz * e * e; y = y - 0.006 * sy * np.maximum(0, -e) * u
    g.P = np.stack([x, y, z], -1); g.smooth_normals()
    blob = lambda p, rot, s: mk.sphere(1, 8, 5).place(p, rot, s)
    parts += [
        g,
        blob((0.019 * sx, -0.018 * sy, 0.004 * sz), (0, 0, -0.45), (0.016 * sx, 0.027 * sy, 0.0105 * sz)),
        blob((-0.022 * sx, -0.014 * sy, 0.002 * sz), (0, 0, 0.1), (0.012 * sx, 0.027 * sy, 0.0095 * sz)),
        mk.cylinder(0.024 * sx, 0.021 * sx, 0.072, 12).place((0, -0.068, -0.004), (0, 0, 0), (1, 1, 0.72)),
        blob(tuple(WRIST), (0, 0, 0), (0.021 * sx, 0.021 * sx, 0.016 * sx)),
    ]
    for f in rig['fingers']:
        parts.append(blob((f['k'][0], f['k'][1] - 0.004 * sy, -0.0045 * sz), (0, 0, 0), (f['r'] * 1.05, f['r'] * 1.2, f['r'] * 0.8)))
    for p in parts:
        p.bind(hand)
    frames = digit_frames(rig, OPEN)
    for f in rig['fingers']:
        J = frames[f['name']][0]
        d = J[1] - J[0]; d[2] = 0
        root = J[0] - unit(d) * 0.016 * sy
        bones = [hand] + [f"{f['name']}{j + 1}.{side}" for j in range(3)]
        parts += _digit([root, *J], [k * f['r'] for k in [1.04, *TAPER]], bones, [1, 2, 3], None)
    J = frames['thumb'][0]
    parts += _digit(J, [k * rig['r'] for k in THUMB_TAPER], [f'thumb{j + 1}.{side}' for j in range(3)], [1, 2], None)
    out = mk.merge(parts)
    if side == 'L':
        out.apply(np.diag([-1.0, 1, 1]))
    return out

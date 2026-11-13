"""Brass, the brass automaton: writes assets/models/brass.glb.

    npm run models            (tools/models/build.sh: makes a Python 3.11 venv with bpy, runs this)

One skinned mesh on a real skeleton, sockets for what the hands hold, and keyed clips. The look is
a port of DESIGNS.brass in src/render/characters.js; the game swaps its own procedural materials
in by material name (body, iron, copper, lens, tip, shutter, dial, needle), so nothing here carries
a texture. Poses are in the game's space: metres, +y up, +z toward the table, the table top at y = 0,
the character's right hand on -x.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from lib import meshkit as mk, hand as hd, pose as ps, rigkit as rk
from lib.meshkit import V, unit
from lib.pose import Channel, q_mul, q_conj, q_rot, q_euler, q_slerp, q_axis, q_between, IDENT

FPS = 30
PI = math.pi
SHOULDER, SH_Y, SH_Z, L1, L2 = 0.215, 0.245, -0.01, 0.27, 0.26
CLAV = V(0.09, 0.27, -0.01)
ARM = dict(shoulder=0.055, elbow=0.046, wrist=0.036, gap=0.012)
HAND = hd.hand_rig((0.044, 0.046, 0.021), 0.0088)
SIDES = (('R', -1), ('L', 1))
COLOURS = dict(body=(0.85, 0.66, 0.35), iron=(0.17, 0.16, 0.15), copper=(0.76, 0.45, 0.29), lens=(0.27, 0.89, 1), tip=(1, 0.23, 0.13), shutter=(0.85, 0.66, 0.35), dial=(0.91, 0.86, 0.74), needle=(0.54, 0.1, 0.06))

# the hand hangs from the wrist in the rest pose: fingers down, palm forward, thumb out
HANG = np.diag([-1.0, -1, 1])
MIRROR = np.diag([-1.0, 1, 1])


def hand_matrix(sg):
    M = np.eye(4); M[:3, :3] = HANG
    M[:3, 3] = V(sg * SHOULDER, SH_Y - L1 - L2, SH_Z) - HANG @ hd.WRIST
    return M


def at(M, p):
    return M[:3, :3] @ p + M[:3, 3]


def skeleton():
    B = [('hips', None, V(0, -0.3, 0)), ('spine', 'hips', V(0, -0.3, 0)), ('chest', 'spine', V(0, 0, 0)), ('neck', 'chest', V(0, 0.36, 0)),
         ('head', 'neck', V(0, 0.5, 0)), ('lid', 'head', V(0, 0.53, 0.12)), ('needle', 'chest', V(0, 0.13, 0.195))]
    joints = hd.digit_frames(HAND, hd.OPEN)
    for side, sg in SIDES:
        sh = V(sg * SHOULDER, SH_Y, SH_Z); el = sh - V(0, L1, 0); wr = el - V(0, L2, 0)
        B += [(f'clavicle.{side}', 'chest', CLAV * V(sg, 1, 1)), (f'upperarm.{side}', f'clavicle.{side}', sh), (f'elbow.{side}', f'upperarm.{side}', el),
              (f'forearm.{side}', f'upperarm.{side}', el), (f'hand.{side}', f'forearm.{side}', wr)]
        M = hand_matrix(sg)
        for name in hd.DIGITS:
            parent = f'hand.{side}'
            for j in range(3):
                J = joints[name][0][j]
                B.append((f'{name}{j + 1}.{side}', parent, at(M, MIRROR @ J if side == 'L' else J)))
                parent = f'{name}{j + 1}.{side}'
    return B


# ---------- the look ----------

def body_parts():
    parts = []
    add = lambda mat, bone, *geos: parts.extend((mat, g.bind(bone)) for g in geos)
    # the boiler
    add('body', 'chest', mk.lathe([[0, -0.3], [0.16, -0.3], [0.19, -0.22], [0.215, -0.05], [0.225, 0.12], [0.2, 0.26], [0.15, 0.33], [0.075, 0.37], [0, 0.375]], 36).place(s=(1.08, 1, 0.86)))
    for y in (-0.18, 0.2):
        r = 0.204 if y < 0 else 0.22
        add('iron', 'chest', mk.torus(r, 0.012, 6, 32).place((0, y, 0), (PI / 2, 0, 0), (1.08, 0.86, 1)))
        for i in range(14):
            a = i / 14 * mk.TAU
            add('body', 'chest', mk.sphere(0.007, 5, 3).place((math.cos(a) * (r + 0.009) * 1.08, y, math.sin(a) * (r + 0.009) * 0.86)))
    for i in range(5):
        add('iron', 'chest', mk.box(0.15, 0.011, 0.02).place((0, -0.02 - i * 0.022, 0.187)))
    add('iron', 'chest', mk.round_box(0.19, 0.13, 0.03, 0.3, 16, 10).place((0, -0.064, 0.18)))
    for s in (-1, 1):
        add('copper', 'chest', mk.sweep([V(s * 0.06, 0.05, -0.17), V(s * 0.14, 0.18, -0.16), V(s * 0.17, 0.3, -0.07), V(s * 0.1, 0.36, 0.02)], 0.013, 20, 8, caps=True))
    add('body', 'chest', mk.torus(0.047, 0.01, 8, 28).place((0, 0.13, 0.19)))
    add('dial', 'chest', mk.circle(0.042, 28).place((0, 0.13, 0.192)))
    needle = mk.box(0.004, 0.036, 0.002); needle.P[:, 1] += 0.014
    add('needle', 'needle', needle.place((0, 0.13, 0.195)))
    # the domed shoulders ride on the clavicles
    for side, s in SIDES:
        add('body', f'clavicle.{side}', mk.sphere(0.1, 20, 10, 0, mk.TAU, 0, PI / 2).place((s * 0.215, 0.255, 0), (0, 0, -s * 0.35), (1, 0.8, 1)))
        add('iron', f'clavicle.{side}', mk.torus(0.1, 0.008, 6, 24).place((s * 0.215, 0.255, 0), (PI / 2, 0, -s * 0.35)))
    # neck
    neck = V(0, 0.36, 0)
    add('iron', 'neck', mk.cylinder(0.045, 0.06, 0.1, 14).place(neck + V(0, 0.03, 0)),
        *[mk.torus(0.052 - i * 0.003, 0.009, 5, 14).place(neck + V(0, -0.005 + i * 0.03, 0), (PI / 2, 0, 0)) for i in range(3)])
    # the box head, its face plate, lens surround, grille, rivets, brow and ears
    h = V(0, 0.5, 0)
    add('body', 'head', mk.round_box(0.29, 0.26, 0.25, 0.28, 24, 16).place(h + V(0, 0.005, 0)))
    add('iron', 'head', mk.round_box(0.23, 0.18, 0.04, 0.35, 18, 10).place(h + V(0, 0, 0.112)))
    add('body', 'head', mk.torus(0.058, 0.014, 10, 36).place(h + V(0, 0.03, 0.136)))
    add('iron', 'head', mk.torus(0.046, 0.005, 6, 32).place(h + V(0, 0.03, 0.136)))
    for i in range(4):
        add('body', 'head', mk.box(0.11 - i * 0.012, 0.008, 0.012).place(h + V(0, -0.045 - i * 0.014, 0.134)))
    for i in range(12):
        a = i / 12 * mk.TAU
        add('body', 'head', mk.sphere(0.0075, 5, 3).place(h + V(math.cos(a) * 0.105, math.sin(a) * 0.075, 0.13)))
    add('body', 'head', mk.round_box(0.22, 0.035, 0.05, 0.4, 16, 8).place(h + V(0, 0.105, 0.11), (0.2, 0, 0)))
    for s in (-1, 1):
        add('iron', 'head', mk.cylinder(0.034, 0.034, 0.035, 16).place(h + V(s * 0.152, 0, 0), (0, 0, PI / 2)))
        add('body', 'head', mk.torus(0.024, 0.006, 6, 16).place(h + V(s * 0.171, 0, 0), (0, PI / 2, 0)))
    add('iron', 'head', mk.tube(h + V(0.07, 0.13, -0.02), h + V(0.07, 0.26, -0.03), 0.006, 0.004, 6), mk.ball(h + V(0.07, 0.13, -0.02), 0.014, 1, 8))
    add('tip', 'head', mk.sphere(0.016, 10, 6).place(h + V(0.07, 0.27, -0.03)))
    add('lens', 'head', mk.sphere(0.046, 20, 8, 0, mk.TAU, 0, PI / 2).place(h + V(0, 0.03, 0.124), (PI / 2, 0, 0), (1, 0.35, 1)))
    add('iron', 'head', mk.torus(0.016, 0.004, 6, 20).place(h + V(0, 0.03, 0.141)))
    # the shutter blink: a cap on its own bone, swinging down over the lens
    add('shutter', 'lid', mk.sphere(0.056, 24, 8, 0, mk.TAU, 0, PI / 2).place(h + V(0, 0.03, 0.12), (0, 0, 0), (1, 1, 0.5)))
    for side, sg in SIDES:
        parts += arm_parts(side, sg)
    return parts


def arm_parts(side, sg):
    """One arm: a single tube from the shoulder to the cuff that bends at the elbow, then the hand."""
    A = ARM; end = -(L1 + L2 - A['gap']); r_in = A['wrist'] * 0.8
    sh = V(sg * SHOULDER, SH_Y, SH_Z)

    def radius(y):
        r = A['elbow'] + (A['shoulder'] - A['elbow']) * (1 + y / L1) if y > -L1 else A['elbow'] + (A['wrist'] - A['elbow']) * ((-L1 - y) / (L2 - A['gap']))
        return r + 0.003 * math.exp(-((y + L1) / 0.035) ** 2)

    ys = np.concatenate([np.linspace(end + 0.003, -0.36, 5, endpoint=False), np.linspace(-0.36, -0.18, 15, endpoint=False), np.linspace(-0.18, 0, 5)])
    # from inside the cuff's opening, round its hem, up the outside, over the shoulder
    profile = [(0, end + 0.035), (r_in, end + 0.035), (r_in, end + 0.003), ((r_in + A['wrist']) / 2, end - 0.0015)]
    profile += [(radius(y), y) for y in ys]
    profile += [(A['shoulder'] * math.cos(a), A['shoulder'] * math.sin(a)) for a in np.linspace(0, PI / 2, 6)[1:]]
    tube = mk.lathe(profile, 14)
    s = -tube.P[:, 1]
    up = 1 - mk.smoothstep(L1 - 0.08, L1 - 0.012, s); fo = mk.smoothstep(L1 + 0.012, L1 + 0.08, s)
    tube.skin([f'upperarm.{side}', f'elbow.{side}', f'forearm.{side}'], np.stack([up, 1 - up - fo, fo], 1))
    tube.P += sh
    cuff = mk.ring(sh + V(0, end + 0.012, 0), V(0, 1, 0), 0.039, 0.0075).bind(f'forearm.{side}')
    M = hand_matrix(sg)
    hand = hd.hand_geometry(HAND, side).apply(M[:3, :3], M[:3, 3])
    return [('body', tube), ('iron', cuff), ('body', hand)]


# ---------- sockets and the frames the hands are posed by ----------

G = hd.to_grip(HAND)                                   # hand frame -> the revolver's grip frame
M_R, M_L = hand_matrix(-1), hand_matrix(1)
GRIP_REST = M_R @ np.linalg.inv(G)                     # the grip frame in the rest pose
RC = dict(R=ps.q_from_mat(GRIP_REST[:3, :3]), L=ps.q_from_mat(HANG))  # each hand's control frame against its bone
WRIST_IN = dict(R=at(G, hd.WRIST), L=hd.WRIST)         # the wrist joint in the control frame
FORE_IN = dict(R=G[:3, :3] @ V(0, -1, 0), L=None)      # the hand's own line up its forearm
POSES, GLASS_IN_GRIP = hd.right_hand_poses(HAND)
GLASS_POS, GLASS_QUAT = ps.decompose(GLASS_IN_GRIP)

# the opponent's fan (src/render/cards.js lays the cards out round this frame, in the chest's space)
FAN_AT = V(0.07, 0.155, 0.37)
FAN_POSE = ps.compose(FAN_AT, q_euler(-0.42, PI, 0, 'YXZ')) @ ps.compose(V(-0.035, -0.064, -0.021), q_euler(0, 0, -1.0, 'YXZ'))


def sockets():
    return [
        ('grip_gun', 'hand.R', GRIP_REST),
        ('grip_glass', 'hand.R', GRIP_REST @ GLASS_IN_GRIP),
        ('palm_l', 'hand.L', M_L),
        ('fan', 'hand.L', M_L @ np.linalg.inv(FAN_POSE) @ ps.compose(FAN_AT, IDENT)),
        # where the hands' control frames go, on the bone each target moves with; the game reads
        # these for its contact correction, so the numbers live here only
        ('rest_r', 'hips', ps.compose(REST['R'][1], REST['R'][2])),
        ('rest_l', 'hips', ps.compose(REST['L'][1], REST['L'][2])),
        ('aim', 'head', ps.compose(V(0, 0.5, 0) + AIM[1], AIM[2])),
        ('fan_hold', 'chest', FAN_POSE),
        ('fan_up', 'chest', ps.compose(V(0.05, 0.3, 0.27), q_euler(-0.3, 0, 0, 'YXZ')) @ ps.compose(-FAN_AT, IDENT) @ FAN_POSE),
        ('mouth', 'head', ps.compose(V(0, 0.5, 0) + MOUTH, IDENT)),
    ]


# ---------- poses ----------
# A hand target is (space, position, orientation, elbow pole) for the hand's control frame: the
# revolver's grip frame on the right, the palm frame on the left. Spaces: 'seat' (stays put on the
# table when the body moves), 'chest' and 'head'.
REST = dict(R=('seat', V(-0.2, 0.017, 0.41), ps.basis(V(0, -1, 0), V(-0.25, 0, 1)), V(-1, -0.75, -0.25)),
            L=('seat', V(0.19, 0.03, 0.355), ps.frame(V(-0.28, -0.06, 1), V(0, -1, 0)), V(1, -0.75, -0.25)))
LIMP = dict(R=('chest', V(-0.27, -0.2, 0.12), ps.basis(V(1, 0, 0), V(0, -1, 0.25)), V(-1, -0.75, -0.25)),
            L=('chest', V(0.26, -0.19, 0.1), ps.frame(V(0, -1, 0.25), V(-1, 0, 0)), V(1, -0.75, -0.25)))
# out over the felt to the right, palm down on a revolver lying on its side
REACH = ('seat', V(-0.1, 0.032, 0.6), q_euler(0, 0.42, -PI / 2, 'YXZ'), V(-1, -0.45, -0.1))
# the muzzle 3 cm off the right temple, the barrel level and pointing in
AIM_DIR = unit(V(1, -0.04, -0.16)); AIM_Q = ps.basis(V(0, 0, -1), AIM_DIR)
MUZZLE = V(0, 0.012, 0.205) - hd.GUN_GRIP
AIM = ('head', V(-0.146, 0.06, 0.03) - AIM_DIR * 0.03 - q_rot(AIM_Q, MUZZLE), AIM_Q, V(-1, -0.45, 0.25))
FAN = ('chest', *ps.decompose(FAN_POSE), V(1, -0.75, -0.25))
# drinking: the rim's place from the mouth (chest space) and the glass's lean, held and at the lip
MOUTH = V(0, -0.07, 0.12)
RIM_HOLD, RIM_LIP = V(-0.01, -0.1, 0.18), V(0, -0.005, 0.025)
LEAN_HOLD, LEAN_POUR = V(0, 1, 0), unit(V(0, -0.25, -1))
ELBOW_SIP = unit(V(-0.55, -0.35, 0.75))
WRIST_GIVE = 0.25


def straight_grip(S, rim, up, pole, give):
    """The grip pose that puts the held glass's rim at `rim`, leaning toward `up`, with the hand
    running straight on from the forearm (at most `give` radians of wrist bend)."""
    wrist, fore = WRIST_IN['R'], FORE_IN['R']
    axis = q_rot(GLASS_QUAT, V(0, 1, 0))
    sw, quat = rim.copy(), IDENT
    for _ in range(4):
        _, q3, _, _ = ps.solve_arm(S, sw - q_rot(quat, wrist), quat, wrist, None, pole, L1, L2, 0)
        sh = q_between(fore, V(0, 1, 0))
        sg = q_rot(sh, axis); su = q_rot(q_conj(q3), up)
        sh = q_mul(q_axis(V(0, 1, 0), math.atan2(su[0], su[2]) - math.atan2(sg[0], sg[2])), sh)
        sg = q_rot(sh, axis)
        miss = math.acos(float(np.clip(np.dot(sg, su), -1, 1)))
        if miss > 1e-4:
            sh = q_mul(q_axis(np.cross(sg, su), min(miss, give)), sh)
        quat = q_mul(q3, sh)
        sr = q_rot(quat, q_rot(GLASS_QUAT, V(0, hd.GLASS['h'], 0)) + GLASS_POS - wrist) + sw
        sw = sw + (rim - sr)
    return sw - q_rot(quat, wrist), quat


def val(c, t):
    return c.at(t) if isinstance(c, Channel) else c


def to(A, B=None, k=0.0, arc=None, sway=0.6):
    """A hand travelling from target A to target B by `k` (a Channel, 0..1 and past it), lifted by `arc`."""
    def f(t, ctx, side):
        pa, qa = ctx['to_chest'](A[0], A[1], A[2]); pole = A[3]
        kk = float(val(k, t))
        if B is not None and kk != 0:
            pb, qb, pole_b = B(t, ctx) if callable(B) else (*ctx['to_chest'](B[0], B[1], B[2]), B[3])
            pa, qa = pa + (pb - pa) * kk, q_slerp(qa, qb, kk)
            pole = unit(pole + (pole_b - pole) * min(1, max(0, kk)))
        if arc is not None:
            pa = pa + val(arc, t)
        return pa, qa, pole, val(sway, t)
    return f


def sip(lift, tip):
    """The glass hand, straight-wristed: `lift` carries the rim from before the chest to the lip, `tip` pours."""
    def f(t, ctx):
        mouth, _ = ctx['to_chest']('head', MOUTH, IDENT)
        rim = mouth + RIM_HOLD + (RIM_LIP - RIM_HOLD) * float(val(lift, t))
        lean = unit(LEAN_HOLD + (LEAN_POUR - LEAN_HOLD) * float(val(tip, t)))
        return (*straight_grip(ctx['S'], rim, lean, ELBOW_SIP, WRIST_GIVE), ELBOW_SIP)
    return f


def solve(spec, t):
    """Every bone's rotation at time t of a clip spec (see CLIPS)."""
    e = lambda k: q_euler(*np.asarray(val(spec.get(k, V(0, 0, 0)), t), float))
    q_sp, q_ch, q_nk, q_hd = e('spine'), e('chest'), e('neck'), e('head')
    dy = float(val(spec.get('chest_dy', 0.0), t))
    pc = V(0, -0.3, 0) + q_rot(q_sp, V(0, 0.3 + dy, 0)); Qc = q_mul(q_sp, q_ch)
    Qn = q_mul(Qc, q_nk); pn = pc + q_rot(Qc, V(0, 0.36, 0)); Qh = q_mul(Qn, q_hd); ph = pn + q_rot(Qn, V(0, 0.14, 0))

    def to_chest(space, pos, quat):
        if space == 'chest':
            return pos, quat
        if space == 'head':
            pos, quat = ph + q_rot(Qh, pos), q_mul(Qh, quat)
        return q_rot(q_conj(Qc), pos - pc), q_mul(q_conj(Qc), quat)

    out = {'spine': q_sp, 'chest': q_ch, 'neck': q_nk, 'head': q_hd, ('chest', 'loc'): V(0, dy, 0)}
    for side, sg in SIDES:
        lift, fwd = np.asarray(val(spec.get(f'clav_{side}', V(0, 0)), t), float)
        q_cl = q_euler(0, -sg * fwd, sg * lift)
        cl = CLAV * V(sg, 1, 1); S = cl + q_rot(q_cl, V(sg * SHOULDER, SH_Y, SH_Z) - cl)
        ctx = dict(to_chest=to_chest, S=S)
        pos, quat, pole, sway = spec.get(f'hand_{side}', to(REST[side]))(t, ctx, side)
        q2, q3, _, _ = ps.solve_arm(S, pos, quat, WRIST_IN[side], FORE_IN[side] if sway > 0 else None, pole, L1, L2, sway)
        fo = q_mul(q_conj(q2), q3)
        out[f'clavicle.{side}'] = q_cl
        out[f'upperarm.{side}'] = q_mul(q_conj(q_cl), q2)
        out[f'forearm.{side}'] = fo
        # the elbow's own bone turns half as far as the forearm, so the tube rounds the bend
        out[f'elbow.{side}'] = q_slerp(IDENT, fo, 0.5)
        out[f'hand.{side}'] = q_mul(q_mul(q_conj(q3), quat), q_conj(RC[side]))
    return out


def fingers(pose, side):
    """Finger bone rotations for a hand pose (relative to the open rest pose)."""
    out = {}
    for name, R in hd.digit_rotations(HAND, pose).items():
        prev = np.eye(3)
        for j in range(3):
            Rm = MIRROR @ R[j] @ MIRROR if side == 'L' else R[j]
            Rm = HANG @ Rm @ HANG.T
            out[f'{name}{j + 1}.{side}'] = ps.q_from_mat(prev.T @ Rm)
            prev = Rm
    return out


# ---------- clips ----------
# Each clip keys the body's channels and says where each hand is going. Times are seconds; a key is
# (time, value, ease into it). The torso and shoulder start before the hand and the head follows, so
# no part moves alone. Every clip but `idle` and `drink` starts from the rest pose; `drink` starts
# and ends on `hold_glass`'s last frame.
K = lambda *keys: Channel(keys)
Z3, Z2 = V(0, 0, 0), V(0, 0)
BREATH = 3.6


def idle():
    b = lambda t: math.sin(mk.TAU * t / BREATH) + 0.22 * math.sin(2 * mk.TAU * t / BREATH)
    sway = lambda t: math.sin(mk.TAU * t / (2 * BREATH))
    wrap = lambda f: _Fn(f)
    return dict(
        dur=2 * BREATH,
        spine=wrap(lambda t: V(0.004 * sway(t + 0.9), 0.012 * sway(t), 0.006 * sway(t))),
        chest=wrap(lambda t: V(-0.009 * b(t), 0, 0)),
        chest_dy=wrap(lambda t: 0.0045 * b(t)),
        neck=wrap(lambda t: V(0.007 * b(t), -0.012 * sway(t), 0)),
        head=wrap(lambda t: V(0, 0, 0.012 * math.sin(mk.TAU * t / BREATH + 0.6) - 0.006 * sway(t))),
        clav_R=wrap(lambda t: V(0.02 + 0.022 * b(t - 0.12), 0)),
        clav_L=wrap(lambda t: V(0.02 + 0.022 * b(t - 0.12), 0)),
    )


class _Fn(Channel):
    """A channel that is a function of time (for loops)."""

    def __init__(self, f):
        self.f = f

    def at(self, t):
        return self.f(t)


def reach():
    return dict(
        dur=0.9,
        # a small wind-up away from the reach, then the trunk leans and turns the shoulder into it
        spine=K((0, Z3), (0.1, V(-0.015, -0.03, 0), 'soft'), (0.5, V(0.1, 0.17, -0.03), 'io'), (0.78, V(0.09, 0.155, -0.025), 'soft')),
        chest=K((0, Z3), (0.12, V(0, -0.03, 0), 'soft'), (0.54, V(0.03, 0.09, 0), 'io')),
        neck=K((0, Z3), (0.16, V(0.02, 0, 0), 'soft'), (0.6, V(-0.13, -0.08, 0), 'io')),
        head=K((0, Z3), (0.2, Z3), (0.66, V(0.1, -0.05, 0.03), 'io')),
        clav_R=K((0, Z2), (0.1, V(-0.03, -0.04), 'soft'), (0.5, V(0.07, 0.3), 'io'), (0.8, V(0.05, 0.26), 'soft')),
        hand_R=to(REST['R'], REACH, K((0, 0), (0.1, 0), (0.62, 1, 'io')), K((0, Z3), (0.1, V(0, 0.012, -0.012), 'soft'), (0.36, V(0, 0.05, 0), 'soft'), (0.62, Z3, 'soft'))),
    )


def aim():
    return dict(
        dur=1.15,
        # the shoulders sink a moment, then the arm swings out round the shoulder and up to the temple
        spine=K((0, Z3), (0.12, V(0.02, 0, 0), 'soft'), (0.6, V(-0.03, -0.03, -0.03), 'io'), (0.9, V(-0.02, -0.03, -0.025), 'soft')),
        chest=K((0, Z3), (0.5, V(0, -0.07, 0), 'io')),
        chest_dy=K((0, 0), (0.12, -0.004, 'soft'), (0.6, 0.007, 'io')),
        # the head turns a little from the muzzle and the chin comes up
        neck=K((0, Z3), (0.3, Z3), (0.75, V(-0.03, 0.09, 0), 'io')),
        head=K((0, Z3), (0.34, Z3), (0.8, V(-0.06, 0, -0.06), 'over')),
        clav_R=K((0, Z2), (0.12, V(-0.04, 0), 'soft'), (0.55, V(0.34, -0.1), 'io'), (0.85, V(0.3, -0.1), 'soft')),
        clav_L=K((0, Z2), (0.6, V(0.05, 0), 'io')),
        hand_R=to(REST['R'], AIM, K((0, 0), (0.12, -0.02, 'soft'), (0.66, 1, 'over')), K((0, Z3), (0.38, V(-0.1, 0.02, 0.07), 'soft'), (0.66, Z3, 'soft'))),
    )


def hold_cards():
    return dict(
        dur=0.75,
        chest=K((0, Z3), (0.45, V(0, 0.025, 0), 'io')),
        neck=K((0, Z3), (0.2, Z3), (0.6, V(0.02, 0.05, 0), 'io')),
        head=K((0, Z3), (0.25, Z3), (0.65, V(0.04, 0, 0), 'io')),
        clav_L=K((0, Z2), (0.08, V(-0.02, 0), 'soft'), (0.45, V(0.09, 0.05), 'io'), (0.7, V(0.06, 0.04), 'soft')),
        hand_L=to(REST['L'], FAN, K((0, 0), (0.08, 0), (0.55, 1, 'over')), K((0, Z3), (0.3, V(0, 0.03, -0.01), 'soft'), (0.55, Z3, 'soft')), sway=0),
    )


def hold_glass():
    return dict(
        dur=0.8,
        spine=K((0, Z3), (0.5, V(-0.02, 0, 0), 'io')),
        clav_R=K((0, Z2), (0.5, V(0.1, 0.06), 'io'), (0.75, V(0.08, 0.05), 'soft')),
        head=K((0, Z3), (0.3, Z3), (0.7, V(0.06, 0, 0), 'io')),
        hand_R=to(REST['R'], sip(0, 0), K((0, 0), (0.62, 1, 'over')), K((0, Z3), (0.3, V(-0.02, 0.02, 0.02), 'soft'), (0.62, Z3, 'soft')), sway=K((0, 0.6), (0.5, 0, 'soft'))),
    )


def drink():
    held = dict(spine=V(-0.02, 0, 0), clav=V(0.08, 0.05), head=V(0.06, 0, 0))
    lift = K((0, 0), (0.14, -0.1, 'soft'), (0.72, 1, 'io'), (1.22, 1), (1.82, 0, 'io'))
    tip = K((0, 0), (0.42, 0), (0.95, 0.92, 'io'), (1.2, 1, 'soft'), (1.62, 0, 'io'))
    return dict(
        dur=1.95,
        # the trunk rocks back as the glass comes up, and forward again as it comes down
        spine=K((0, held['spine']), (0.14, V(0, 0, 0), 'soft'), (0.9, V(-0.07, 0, 0.012), 'io'), (1.2, V(-0.075, 0, 0.012)), (1.85, held['spine'], 'io')),
        chest_dy=K((0, 0), (0.9, 0.006, 'io'), (1.2, 0.006), (1.8, 0, 'io')),
        # the head dips to meet the glass, then tips back with it
        neck=K((0, Z3), (0.5, Z3), (0.95, V(-0.08, 0, 0), 'io'), (1.2, V(-0.09, 0, 0)), (1.7, Z3, 'io')),
        head=K((0, held['head']), (0.4, V(0.1, 0, 0), 'soft'), (0.95, V(-0.42, 0, 0), 'io'), (1.2, V(-0.46, 0, 0), 'soft'), (1.72, V(0.09, 0, 0), 'io'), (1.95, held['head'], 'soft')),
        clav_R=K((0, held['clav']), (0.14, V(0.06, 0.05), 'soft'), (0.8, V(0.3, 0.02), 'io'), (1.2, V(0.3, 0.02)), (1.8, held['clav'], 'io')),
        hand_R=lambda t, ctx, side: (*sip(lift, tip)(t, ctx), 0),
    )


def flinch():
    return dict(
        dur=0.75,
        spine=K((0, Z3), (0.09, V(-0.05, 0, 0), 'snap'), (0.7, Z3, 'io')),
        chest_dy=K((0, 0), (0.09, -0.008, 'snap'), (0.7, 0, 'io')),
        neck=K((0, Z3), (0.1, V(0.04, 0, 0), 'snap'), (0.72, Z3, 'io')),
        head=K((0, Z3), (0.11, V(-0.1, 0, 0.02), 'snap'), (0.75, Z3, 'io')),
        clav_R=K((0, Z2), (0.08, V(0.2, 0.04), 'snap'), (0.72, Z2, 'io')),
        clav_L=K((0, Z2), (0.08, V(0.2, 0.04), 'snap'), (0.72, Z2, 'io')),
    )


def lean():
    return dict(
        dur=0.6,
        spine=K((0, Z3), (0.08, V(-0.012, 0, 0), 'soft'), (0.42, V(0.16, 0, 0), 'over')),
        neck=K((0, Z3), (0.12, Z3), (0.5, V(-0.09, 0, 0), 'io')),
        head=K((0, Z3), (0.16, Z3), (0.55, V(0.02, 0, 0), 'over')),
        clav_R=K((0, Z2), (0.4, V(0.05, 0.1), 'io')),
        clav_L=K((0, Z2), (0.4, V(0.05, 0.1), 'io')),
    )


def slump():
    return dict(
        dur=1.5,
        # a last rise, then the trunk goes and the head and arms follow it down and settle
        spine=K((0, Z3), (0.14, V(-0.03, 0, 0), 'soft'), (0.72, V(0.45, 0, 0.13), 'in'), (1.0, V(0.41, 0, 0.12), 'soft'), (1.3, V(0.42, 0, 0.12), 'soft')),
        chest_dy=K((0, 0), (0.14, 0.006, 'soft'), (0.75, -0.04, 'io')),
        neck=K((0, Z3), (0.25, Z3), (0.85, V(0, 0.25, 0), 'io')),
        head=K((0, Z3), (0.16, V(-0.05, 0, 0), 'soft'), (0.9, V(0.82, 0, 0.34), 'io'), (1.2, V(0.73, 0, 0.31), 'soft'), (1.45, V(0.75, 0, 0.32), 'soft')),
        clav_R=K((0, Z2), (0.14, V(0.05, 0), 'soft'), (0.8, V(-0.12, 0.08), 'io')),
        clav_L=K((0, Z2), (0.14, V(0.05, 0), 'soft'), (0.8, V(-0.12, 0.08), 'io')),
        hand_R=to(REST['R'], LIMP['R'], K((0, 0), (0.2, 0), (0.95, 1, 'over')), K((0, Z3), (0.5, V(-0.03, 0.03, 0.02), 'soft'), (0.95, Z3, 'soft'))),
        hand_L=to(REST['L'], LIMP['L'], K((0, 0), (0.26, 0), (1.02, 1, 'over')), K((0, Z3), (0.55, V(0.03, 0.03, 0.02), 'soft'), (1.02, Z3, 'soft')), sway=0),
    )


CLIPS = dict(idle=idle, reach=reach, aim=aim, hold_cards=hold_cards, hold_glass=hold_glass, drink=drink, flinch=flinch, lean=lean, slump=slump)
# finger poses, two frames each; the game sets their weights from what the hand holds
HAND_CLIPS = dict(fist_r=(POSES['fist'], 'R'), glass_r=(POSES['glass'], 'R'), spread_r=(hd.SPREAD, 'R'), fan_l=(hd.FAN, 'L'))


def main(out):
    rk.reset(FPS)
    arm = rk.build_armature('brass', skeleton())
    _, stats = rk.build_mesh('brass_body', body_parts(), arm, COLOURS)
    for name, bone, M in sockets():
        rk.add_socket(name, arm, bone, M)
    for name, make in CLIPS.items():
        spec = make()
        n = round(spec['dur'] * FPS)
        rk.bake_action(arm, name, [solve(spec, f / FPS) for f in range(n + 1)])
    for name, (pose, side) in HAND_CLIPS.items():
        f = fingers(pose, side)
        rk.bake_action(arm, name, [f, f])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rk.export_glb(out)
    print(f"{out}: {stats['vertices']} vertices, {stats['triangles']} triangles, materials {stats['materials']}, {os.path.getsize(out) / 1024:.0f} KB")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'brass.glb'))

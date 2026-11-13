"""The player's own right arm, seen in first person: writes assets/models/player_arm.glb.

    tools/models/build.sh player_arm

One skinned mesh (a dark cloth sleeve, a rolled linen shirt cuff, a bare forearm and the shared
hand from lib/hand.py), a skeleton, sockets for what the hand holds and finger poses. The game
(src/render/playerArm.js) solves the arm itself every frame, so there are no body clips.

The arm's own space, in the rest pose: the elbow at the origin, the upper arm running up +y from it
(much longer than an arm: only its far end is off-screen, and the game points it at a shoulder below
the view), the forearm hanging down -y to the wrist, and the elbow's point (the olecranon) facing +z,
so the forearm bends toward -z. The hand hangs straight on in mid-pronation: palm toward -x (the
body's middle, for a right arm), thumb toward -z, the side the elbow bends to.

Every bone is an axis-aligned stub with an identity rest rotation, as in lib/biped.py. The forearm's
roll is carried by two bones that only twist about it, `twist.R` (halfway, half the turn) and
`wrist.R` (all of it), so a turned hand doesn't wring the skin at the wrist; `hand.R` bends.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from lib import meshkit as mk, hand as hd, pose as ps, rigkit as rk
from lib.meshkit import V, unit

L2 = 0.27             # elbow to wrist (src/render/playerArm.js uses the same)
UPPER = 0.95          # the upper arm's tube, from the elbow
SKIN_TOP = 0.165      # bare forearm up to here above the wrist, under the cuff
CUFF = (0.148, 0.19)  # the rolled shirt sleeve, above the wrist
HEM = 0.182           # where the coat sleeve ends, above the wrist
HAND = hd.hand_rig((0.044, 0.048, 0.021), 0.0092)   # the size playerArm.js has always used
COLOURS = dict(skin=(0.75, 0.54, 0.41), cloth=(0.17, 0.125, 0.153), linen=(0.85, 0.80, 0.71))

# the hand frame (hd: palm +z, fingers +y, thumb +x) in the arm's rest pose
R_REST = np.stack([V(0, 0, -1), V(0, -1, 0), V(-1, 0, 0)], 1)
WRIST_AT = V(0, -L2, 0)
M_HAND = np.eye(4); M_HAND[:3, :3] = R_REST; M_HAND[:3, 3] = WRIST_AT - R_REST @ hd.WRIST

# the dice cup (src/render/diceTable.js): mouth down, so its closed end is the top
CUP_R, CUP_H = 0.076, 0.132
# The cup's control frame is where dice.js sends the hand: 1.6 cm over the middle of the cup's top,
# +y up the cup, +z away from you. The hand lies palm down on the top, fingers away over the far rim.
CUP_TOP = -0.016
R_CUP = np.stack([V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)], 1)          # hand axes in the cup frame
CUP_HAND = np.eye(4); CUP_HAND[:3, :3] = R_CUP; CUP_HAND[:3, 3] = V(0.004, CUP_TOP + 0.0215, -0.022)


def cup_sdf(p):
    """The cup as a signed distance in its control frame: a cone narrowing to its top, edges rounded."""
    y = p[1] - CUP_TOP
    h = min(0, max(-CUP_H, y))
    r = CUP_R * 0.85 + (CUP_R - CUP_R * 0.85) * (-h / CUP_H)
    side = math.hypot(p[0], p[2]) - (r - 0.006)
    cap = max(y - 0.002, -CUP_H - y)
    return math.hypot(max(side, 0), max(cap, 0)) + min(max(side, cap), 0) - 0.006


def cup_pose():
    """Fingers over the far rim and down the side; the thumb down the near side."""
    to_cup = lambda p: R_CUP @ p + CUP_HAND[:3, 3]
    sdf = lambda p: cup_sdf(to_cup(p))
    fingers = hd.wrap_fingers(HAND, sdf, [-0.1, 0.1, 0.05])
    thumb = hd.wrap_thumb(HAND, sdf, [0.95, 0.15, 0.35, 0.05, 0.05])
    return dict(fingers=fingers, thumb=thumb)


RELAXED = dict(fingers=hd.loose([0.32, 0.5, 0.3], 0.08), thumb=[0.45, 0.45, 0.7, 0.3, 0.35])


def skeleton():
    B = [('upperarm.R', None, V(0, 0, 0)), ('elbow.R', 'upperarm.R', V(0, 0, 0)), ('forearm.R', 'upperarm.R', V(0, 0, 0)),
         ('twist.R', 'forearm.R', V(0, -L2 / 2, 0)), ('wrist.R', 'forearm.R', WRIST_AT), ('hand.R', 'wrist.R', WRIST_AT)]
    joints = hd.digit_frames(HAND, hd.OPEN)
    for name in hd.DIGITS:
        parent = 'hand.R'
        for j in range(3):
            B.append((f'{name}{j + 1}.R', parent, M_HAND[:3, :3] @ joints[name][0][j] + M_HAND[:3, 3]))
            parent = f'{name}{j + 1}.R'
    return B


# ---------- skin weights ----------

ARM_BONES = ['upperarm.R', 'elbow.R', 'forearm.R', 'twist.R', 'wrist.R', 'hand.R']


def arm_weights(y):
    """Weights over ARM_BONES for points at rest heights y: the elbow's three-way blend, the forearm's
    twist shared out along it (none at the elbow, all of it at the wrist), and the hand over the wrist."""
    y = np.asarray(y, float); s = y + L2
    up = mk.smoothstep(0.012, 0.08, y); fo = mk.smoothstep(0.012, 0.08, -y); el = 1 - up - fo
    hand = 1 - mk.smoothstep(0.0, 0.03, s)
    tau = 1 - mk.smoothstep(0.015, 0.23, s)
    wr = np.clip(2 * tau - 1, 0, 1); tw = np.where(tau >= 0.5, 2 - 2 * tau, 2 * tau); f0 = np.clip(1 - 2 * tau, 0, 1)
    W = np.stack([up, el, fo * f0, fo * tw, fo * wr, np.zeros_like(y)], 1)
    W[:, :5] *= (1 - hand)[:, None]; W[:, 5] = hand
    return W


def skinned(g):
    return g.skin(ARM_BONES, arm_weights(g.P[:, 1]))


# ---------- the look ----------

def forearm_skin():
    """The bare forearm from inside the hand's wrist up under the cuff: flatter toward the wrist
    (wide across the thumb's side), fuller under the cuff."""
    ss = np.concatenate([np.linspace(-0.012, 0.05, 7, endpoint=False), np.linspace(0.05, SKIN_TOP, 9)])
    r = lambda s: 0.0245 + 0.0075 * mk.smoothstep(0.0, 0.14, s) + 0.0012 * math.sin(min(1, max(0, s / SKIN_TOP)) * math.pi)
    prof = [(float(r(s)), s - L2) for s in ss] + [(0.001, SKIN_TOP - L2)]
    g = mk.lathe(prof, 18)
    s = g.P[:, 1] + L2
    # across the palm (x) the wrist is thin; up the arm it rounds out
    g.P[:, 0] *= 0.74 + 0.2 * mk.smoothstep(0.0, 0.13, s)
    g.P[:, 2] *= 1.0 + 0.04 * mk.smoothstep(0.03, 0.12, s)
    g.smooth_normals()
    return skinned(g)


def cuff():
    """A shirt sleeve rolled up into a soft band, tucked under the coat's hem."""
    a, b = CUFF
    prof = [(0.0305, a + 0.004), (0.034, a - 0.0005), (0.0385, a + 0.0005), (0.041, a + 0.006), (0.0418, (a + b) / 2), (0.0412, b - 0.008), (0.0395, b - 0.002), (0.037, b)]
    g = mk.lathe([(x, y - L2) for x, y in prof], 18)
    g.P[:, 0] *= 0.93
    g.smooth_normals()
    return skinned(g)


def sleeve():
    """The coat sleeve: one tube from inside its hem, round it, up over the elbow and the upper arm."""
    def radius(y):
        r = 0.0465 + 0.006 * mk.smoothstep(-0.09, 0.0, y) + 0.008 * mk.smoothstep(0.0, 0.25, y) - 0.004 * mk.smoothstep(0.3, 0.6, y)
        return float(r + 0.004 * math.exp(-((y - 0.005) / 0.04) ** 2))
    hem = HEM - L2; r_in = 0.04
    ys = np.concatenate([np.linspace(hem + 0.004, -0.1, 3, endpoint=False), np.linspace(-0.1, 0.1, 16, endpoint=False), np.linspace(0.1, UPPER - 0.03, 8)])
    prof = [(r_in - 0.002, hem + 0.025), (r_in, hem + 0.004), (r_in + 0.004, hem - 0.002), (0.045, hem - 0.001)]
    prof += [(radius(y), y) for y in ys]
    top = UPPER - 0.03
    prof += [(radius(top) * math.cos(a), top + 0.03 * math.sin(a)) for a in np.linspace(0, math.pi / 2, 5)[1:]]
    g = mk.lathe(prof, 18)
    g.smooth_normals()
    return skinned(g)


def hand():
    """The shared hand, placed in the rest pose; its wrist stub follows the forearm above the wrist."""
    g = hd.hand_geometry(HAND, 'R').apply(M_HAND[:3, :3], M_HAND[:3, 3])
    y = g.P[:, 1]
    above = y > -L2 - 0.004
    if above.any():
        bones = list(g.bones)
        for b in ARM_BONES:
            if b not in bones:
                bones.append(b)
        W = np.zeros((len(g.P), len(bones)))
        W[:, :len(g.bones)] = g.W
        wa = arm_weights(y[above])
        h = bones.index('hand.R'); own = W[above, h].copy()
        W[above] = 0
        for k, b in enumerate(ARM_BONES):
            W[above, bones.index(b)] += wa[:, k] * own
        W[above, h] += 1 - own
        g.bones, g.W = bones, W / W.sum(axis=1, keepdims=True)
    return g


def parts():
    return [('cloth', sleeve()), ('linen', cuff()), ('skin', forearm_skin()), ('skin', hand())]


# ---------- poses and sockets ----------

def fingers(pose):
    """Finger bone rotations for a hand pose, against the open rest pose."""
    out = {}
    for name, R in hd.digit_rotations(HAND, pose).items():
        prev = np.eye(3)
        for j in range(3):
            Rm = R_REST @ R[j] @ R_REST.T
            out[f'{name}{j + 1}.R'] = ps.q_from_mat(prev.T @ Rm)
            prev = Rm
    return out


def sockets():
    G = hd.to_grip(HAND)
    poses, glass_in_grip = hd.right_hand_poses(HAND)
    grip = M_HAND @ np.linalg.inv(G)
    return poses, [
        ('grip_gun', 'hand.R', grip),
        ('grip_glass', 'hand.R', grip @ glass_in_grip),
        ('grip_cup', 'hand.R', M_HAND @ np.linalg.inv(CUP_HAND)),
    ]


def build(out):
    rk.reset(30)
    arm = rk.build_armature('player_arm', skeleton())
    _, stats = rk.build_mesh('player_arm_body', parts(), arm, COLOURS)
    poses, socks = sockets()
    for name, bone, M in socks:
        rk.add_socket(name, arm, bone, M)
    clips = dict(relaxed=RELAXED, open=hd.SPREAD, gun=poses['fist'], glass=poses['glass'], cup=cup_pose())
    for name, pose in clips.items():
        f = fingers(pose)
        rk.bake_action(arm, name, [f, f])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rk.export_glb(out)
    print(f"{out}: {stats['vertices']} vertices, {stats['triangles']} triangles, materials {stats['materials']}, {os.path.getsize(out) / 1024:.0f} KB")


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'player_arm.glb'))

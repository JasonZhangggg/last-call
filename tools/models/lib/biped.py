"""The body the seated characters share: the skeleton, the sleeve, the hands' sockets and pose
targets, the arm solve that turns a clip spec into bone rotations, and the build itself.

A character's generator makes a Body with its own sizes, adds its look (parts bound to these bones)
and its clips, and calls build(). This is the general form of what tools/models/brass.py does for
itself, so the numbers and conventions are the same: the game's space (metres, +y up, +z toward
the table, the table top at y = 0, the right hand on -x), and every bone an axis-aligned stub.
"""
import math
import os
import numpy as np
from . import meshkit as mk, hand as hd, pose as ps, rigkit as rk
from .meshkit import V, unit
from .pose import Channel, q_mul, q_conj, q_rot, q_euler, q_slerp, q_axis, q_between, IDENT

FPS = 30
PI = math.pi
# the arm's bone lengths are the game's too (src/render/rig.js solves the same chain)
L1, L2 = 0.27, 0.26
SIDES = (('R', -1), ('L', 1))
# the hand hangs from the wrist in the rest pose: fingers down, palm forward, thumb out
HANG = np.diag([-1.0, -1, 1])
MIRROR = np.diag([-1.0, 1, 1])
HEAD_AT = V(0, 0.5, 0)
# the opponent's fan (src/render/cards.js lays the cards out round this frame, in the chest's space)
FAN_AT = V(0.07, 0.155, 0.37)
FAN_POSE = ps.compose(FAN_AT, q_euler(-0.42, PI, 0, 'YXZ')) @ ps.compose(V(-0.035, -0.064, -0.021), q_euler(0, 0, -1.0, 'YXZ'))
MUZZLE = V(0, 0.012, 0.205) - hd.GUN_GRIP

K = lambda *keys: Channel(keys)
Z3, Z2 = V(0, 0, 0), V(0, 0)


class Fn(Channel):
    """A channel that is a function of time (for loops)."""

    def __init__(self, f):
        self.f = f

    def at(self, t):
        return self.f(t)


def at(M, p):
    return M[:3, :3] @ p + M[:3, 3]


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


class Body:
    """Sizes and pose targets. A hand target is (space, position, orientation, elbow pole) for the
    hand's control frame: the revolver's grip frame on the right, the palm frame on the left.
    Spaces: 'seat' (stays put on the table when the body moves), 'chest' and 'head'."""

    def __init__(self, name, arm, palm, finger_r, temple, mouth, shoulder=0.215, sh_y=0.245, sh_z=-0.01, clav=V(0.09, 0.27, -0.01), bones=(), **over):
        self.name, self.arm, self.extra_bones = name, arm, list(bones)
        self.shoulder, self.sh_y, self.sh_z, self.clav = shoulder, sh_y, sh_z, clav
        self.hand = hd.hand_rig(palm, finger_r)
        G = hd.to_grip(self.hand)                               # hand frame -> the revolver's grip frame
        self.M_R, self.M_L = self.hand_matrix(-1), self.hand_matrix(1)
        self.GRIP_REST = self.M_R @ np.linalg.inv(G)            # the grip frame in the rest pose
        self.RC = dict(R=ps.q_from_mat(self.GRIP_REST[:3, :3]), L=ps.q_from_mat(HANG))  # each hand's control frame against its bone
        self.WRIST_IN = dict(R=at(G, hd.WRIST), L=hd.WRIST)     # the wrist joint in the control frame
        self.FORE_IN = dict(R=G[:3, :3] @ V(0, -1, 0), L=None)  # the hand's own line up its forearm
        self.POSES, self.GLASS_IN_GRIP = hd.right_hand_poses(self.hand)
        self.GLASS_POS, self.GLASS_QUAT = ps.decompose(self.GLASS_IN_GRIP)
        self.REST = dict(R=('seat', V(-0.2, 0.017, 0.41), ps.basis(V(0, -1, 0), V(-0.25, 0, 1)), V(-1, -0.75, -0.25)),
                         L=('seat', V(0.19, 0.03, 0.355), ps.frame(V(-0.28, -0.06, 1), V(0, -1, 0)), V(1, -0.75, -0.25)))
        self.LIMP = dict(R=('chest', V(-0.27, -0.2, 0.12), ps.basis(V(1, 0, 0), V(0, -1, 0.25)), V(-1, -0.75, -0.25)),
                         L=('chest', V(0.26, -0.19, 0.1), ps.frame(V(0, -1, 0.25), V(-1, 0, 0)), V(1, -0.75, -0.25)))
        # out over the felt to the right, palm down on a revolver lying on its side
        self.REACH = ('seat', V(-0.1, 0.032, 0.6), q_euler(0, 0.42, -PI / 2, 'YXZ'), V(-1, -0.45, -0.1))
        # the muzzle 3 cm off the right temple, the barrel level and pointing in
        aim_dir = unit(V(1, -0.04, -0.16)); aim_q = ps.basis(V(0, 0, -1), aim_dir)
        self.AIM = ('head', temple - aim_dir * 0.03 - q_rot(aim_q, MUZZLE), aim_q, V(-1, -0.45, 0.25))
        self.FAN = ('chest', *ps.decompose(FAN_POSE), V(1, -0.75, -0.25))
        self.FAN_UP = ps.compose(V(0.05, 0.3, 0.27), q_euler(-0.3, 0, 0, 'YXZ')) @ ps.compose(-FAN_AT, IDENT) @ FAN_POSE
        # drinking: the rim's place from the mouth (chest space) and the glass's lean, held and at the lip
        self.MOUTH = mouth
        self.RIM_HOLD, self.RIM_LIP = V(-0.01, -0.1, 0.18), V(0, -0.005, 0.025)
        self.LEAN_HOLD, self.LEAN_POUR = V(0, 1, 0), unit(V(0, -0.25, -1))
        self.ELBOW_SIP = unit(V(-0.55, -0.35, 0.75))
        self.WRIST_GIVE = 0.25
        for k, v in over.items():
            assert hasattr(self, k), k
            setattr(self, k, v)

    # ---------- skeleton and skin ----------

    def hand_matrix(self, sg):
        M = np.eye(4); M[:3, :3] = HANG
        M[:3, 3] = V(sg * self.shoulder, self.sh_y - L1 - L2, self.sh_z) - HANG @ hd.WRIST
        return M

    def skeleton(self):
        B = [('hips', None, V(0, -0.3, 0)), ('spine', 'hips', V(0, -0.3, 0)), ('chest', 'spine', V(0, 0, 0)), ('neck', 'chest', V(0, 0.36, 0)), ('head', 'neck', HEAD_AT)]
        B += self.extra_bones
        joints = hd.digit_frames(self.hand, hd.OPEN)
        for side, sg in SIDES:
            sh = V(sg * self.shoulder, self.sh_y, self.sh_z); el = sh - V(0, L1, 0); wr = el - V(0, L2, 0)
            B += [(f'clavicle.{side}', 'chest', self.clav * V(sg, 1, 1)), (f'upperarm.{side}', f'clavicle.{side}', sh), (f'elbow.{side}', f'upperarm.{side}', el),
                  (f'forearm.{side}', f'upperarm.{side}', el), (f'hand.{side}', f'forearm.{side}', wr)]
            M = self.hand_matrix(sg)
            for name in hd.DIGITS:
                parent = f'hand.{side}'
                for j in range(3):
                    J = joints[name][0][j]
                    B.append((f'{name}{j + 1}.{side}', parent, at(M, MIRROR @ J if side == 'L' else J)))
                    parent = f'{name}{j + 1}.{side}'
        return B

    def sleeve_end(self):
        return -(L1 + L2 - self.arm['gap'])

    def arm_parts(self, side, sg):
        """One arm as (sleeve, hand): a single tube from the shoulder to the hem that bends at the
        elbow, and the hand. Both in place and skinned; the character adds its own cuff."""
        A = self.arm; end = self.sleeve_end(); r_in = A['wrist'] * 0.8
        sh = V(sg * self.shoulder, self.sh_y, self.sh_z)

        def radius(y):
            r = A['elbow'] + (A['shoulder'] - A['elbow']) * (1 + y / L1) if y > -L1 else A['elbow'] + (A['wrist'] - A['elbow']) * ((-L1 - y) / (L2 - A['gap']))
            return r + 0.003 * math.exp(-((y + L1) / 0.035) ** 2)

        ys = np.concatenate([np.linspace(end + 0.003, -0.36, 5, endpoint=False), np.linspace(-0.36, -0.18, 15, endpoint=False), np.linspace(-0.18, 0, 5)])
        # from inside the hem's opening, round it, up the outside, over the shoulder
        profile = [(0, end + 0.035), (r_in, end + 0.035), (r_in, end + 0.003), ((r_in + A['wrist']) / 2, end - 0.0015)]
        profile += [(radius(y), y) for y in ys]
        profile += [(A['shoulder'] * math.cos(a), A['shoulder'] * math.sin(a)) for a in np.linspace(0, PI / 2, 6)[1:]]
        tube = mk.lathe(profile, 14)
        s = -tube.P[:, 1]
        up = 1 - mk.smoothstep(L1 - 0.08, L1 - 0.012, s); fo = mk.smoothstep(L1 + 0.012, L1 + 0.08, s)
        tube.skin([f'upperarm.{side}', f'elbow.{side}', f'forearm.{side}'], np.stack([up, 1 - up - fo, fo], 1))
        tube.P += sh
        M = self.hand_matrix(sg)
        hand = hd.hand_geometry(self.hand, side).apply(M[:3, :3], M[:3, 3])
        return tube, hand

    def sockets(self):
        return [
            ('grip_gun', 'hand.R', self.GRIP_REST),
            ('grip_glass', 'hand.R', self.GRIP_REST @ self.GLASS_IN_GRIP),
            ('palm_l', 'hand.L', self.M_L),
            ('fan', 'hand.L', self.M_L @ np.linalg.inv(FAN_POSE) @ ps.compose(FAN_AT, IDENT)),
            # where the hands' control frames go, on the bone each target moves with; the game reads
            # these for its contact correction, so the numbers live here only
            ('rest_r', 'hips', ps.compose(self.REST['R'][1], self.REST['R'][2])),
            ('rest_l', 'hips', ps.compose(self.REST['L'][1], self.REST['L'][2])),
            ('aim', 'head', ps.compose(HEAD_AT + self.AIM[1], self.AIM[2])),
            ('fan_hold', 'chest', FAN_POSE),
            ('fan_up', 'chest', self.FAN_UP),
            ('mouth', 'head', ps.compose(HEAD_AT + self.MOUTH, IDENT)),
        ]

    # ---------- poses ----------

    def straight_grip(self, S, rim, up, pole, give):
        """The grip pose that puts the held glass's rim at `rim`, leaning toward `up`, with the hand
        running straight on from the forearm (at most `give` radians of wrist bend)."""
        wrist, fore = self.WRIST_IN['R'], self.FORE_IN['R']
        axis = q_rot(self.GLASS_QUAT, V(0, 1, 0))
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
            sr = q_rot(quat, q_rot(self.GLASS_QUAT, V(0, hd.GLASS['h'], 0)) + self.GLASS_POS - wrist) + sw
            sw = sw + (rim - sr)
        return sw - q_rot(quat, wrist), quat

    def sip(self, lift, tip):
        """The glass hand, straight-wristed: `lift` carries the rim from before the chest to the lip, `tip` pours."""
        def f(t, ctx):
            mouth, _ = ctx['to_chest']('head', self.MOUTH, IDENT)
            rim = mouth + self.RIM_HOLD + (self.RIM_LIP - self.RIM_HOLD) * float(val(lift, t))
            lean = unit(self.LEAN_HOLD + (self.LEAN_POUR - self.LEAN_HOLD) * float(val(tip, t)))
            return (*self.straight_grip(ctx['S'], rim, lean, self.ELBOW_SIP, self.WRIST_GIVE), self.ELBOW_SIP)
        return f

    def solve(self, spec, t):
        """Every bone's rotation at time t of a clip spec. A spec keys the body's channels as Euler
        angles (spine, chest, neck, head, clav_R/L as (lift, forward), chest_dy, and any other bone
        under `bones`) and says where each hand is going (hand_R, hand_L)."""
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
        for bone, c in spec.get('bones', {}).items():
            out[bone] = q_euler(*np.asarray(val(c, t), float))
        for side, sg in SIDES:
            lift, fwd = np.asarray(val(spec.get(f'clav_{side}', V(0, 0)), t), float)
            q_cl = q_euler(0, -sg * fwd, sg * lift)
            cl = self.clav * V(sg, 1, 1); S = cl + q_rot(q_cl, V(sg * self.shoulder, self.sh_y, self.sh_z) - cl)
            ctx = dict(to_chest=to_chest, S=S)
            pos, quat, pole, sway = spec.get(f'hand_{side}', to(self.REST[side]))(t, ctx, side)
            q2, q3, _, _ = ps.solve_arm(S, pos, quat, self.WRIST_IN[side], self.FORE_IN[side] if sway > 0 else None, pole, L1, L2, sway)
            fo = q_mul(q_conj(q2), q3)
            out[f'clavicle.{side}'] = q_cl
            out[f'upperarm.{side}'] = q_mul(q_conj(q_cl), q2)
            out[f'forearm.{side}'] = fo
            # the elbow's own bone turns half as far as the forearm, so the tube rounds the bend
            out[f'elbow.{side}'] = q_slerp(IDENT, fo, 0.5)
            out[f'hand.{side}'] = q_mul(q_mul(q_conj(q3), quat), q_conj(self.RC[side]))
        return out

    def fingers(self, pose, side):
        """Finger bone rotations for a hand pose (relative to the open rest pose)."""
        out = {}
        for name, R in hd.digit_rotations(self.hand, pose).items():
            prev = np.eye(3)
            for j in range(3):
                Rm = MIRROR @ R[j] @ MIRROR if side == 'L' else R[j]
                Rm = HANG @ Rm @ HANG.T
                out[f'{name}{j + 1}.{side}'] = ps.q_from_mat(prev.T @ Rm)
                prev = Rm
        return out

    def hand_clips(self):
        """Finger poses, two frames each; the game sets their weights from what the hand holds."""
        return dict(fist_r=(self.POSES['fist'], 'R'), glass_r=(self.POSES['glass'], 'R'), spread_r=(hd.SPREAD, 'R'), fan_l=(hd.FAN, 'L'))

    # ---------- the build ----------

    def build(self, out, parts, colours, clips, after=None):
        """Writes the .glb: `parts` are (material, Geo), `clips` name -> a function returning a spec.
        `after(path)` runs on the written file (see lib/quantise.py)."""
        rk.reset(FPS)
        arm = rk.build_armature(self.name, self.skeleton())
        _, stats = rk.build_mesh(f'{self.name}_body', parts, arm, colours)
        for name, bone, M in self.sockets():
            rk.add_socket(name, arm, bone, M)
        for name, make in clips.items():
            spec = make()
            n = round(spec['dur'] * FPS)
            rk.bake_action(arm, name, [self.solve(spec, f / FPS) for f in range(n + 1)])
        for name, (pose, side) in self.hand_clips().items():
            f = self.fingers(pose, side)
            rk.bake_action(arm, name, [f, f])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        rk.export_glb(out)
        if after:
            after(out)
        print(f"{out}: {stats['vertices']} vertices, {stats['triangles']} triangles, materials {stats['materials']}, {os.path.getsize(out) / 1024:.0f} KB")

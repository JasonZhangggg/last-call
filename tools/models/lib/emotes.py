"""The six table gestures, as clips for any Body: wave, flip (the middle finger), thumbs (up),
laugh (point and laugh), shrug and clap (a slow clap).

Every clip starts and ends on the rest pose and is keyed in the chest's space with the gesture
aimed straight ahead (+z, the table centre); the game turns it toward whoever it is aimed at and
plays it as an additive layer. A style dict gives each character its flavour:

    tempo     time scale (above 1 is slower)
    big       how far the gesture reaches and how much the body joins in
    ease      the ease into each held pose ('snap' is crisp, 'over' overshoots and settles)
    crisp     moves in clean steps, no secondary wobble (Brass)
    flourish  a twirl of the wrist before the gesture lands, and a little finger out (Noctua)
    jaw       a jaw bone that drops when it laughs (Gristle)

Hands are placed by their palm frame: the palm centre, where the fingers point and where the palm
faces, in the chest's space. A right hand's control frame is the revolver's grip frame, so its
pose is converted through the hand's grip (lib/hand.py); a left hand's is its palm frame.
"""
import math
import numpy as np
from . import hand as hd, pose as ps
from .meshkit import V, unit
from .pose import Channel, q_slerp

K = lambda *keys: Channel(keys)
Z3, Z2 = V(0, 0, 0), V(0, 0)
TAU = 2 * math.pi
MIRROR = V(-1, 1, 1)
# a clap lands this far into each beat (src/emotes.js times its sound from it)
STRIKE = 0.35

# finger poses (lib/hand.py's form: per finger [knuckle, middle, end] bends; the thumb's
# [spread, lift, roll, bend1, bend2]). Curled is a tight fist; the thumb lies across it.
CURL = [1.5, 1.65, 1.05]
THUMB_TUCK = [0.25, 0.85, 0.55, 0.65, 0.55]
FLAT = dict(fingers=[[0.04, 0.06, 0.03], [0.02, 0.05, 0.03], [0.04, 0.06, 0.03], [0.07, 0.08, 0.04]], thumb=[0.42, 0.2, 0.4, 0.08, 0.1])
FLIP = dict(fingers=[CURL, [0.0, 0.03, 0.02], CURL, CURL], thumb=THUMB_TUCK)
THUMBS = dict(fingers=[[1.45, 1.6, 1.0], CURL, CURL, CURL], thumb=[1.25, 0.05, 0.3, -0.05, -0.08])
POINT = dict(fingers=[[0.0, 0.04, 0.02], CURL, CURL, CURL], thumb=[0.35, 0.75, 0.5, 0.45, 0.4])
CUPPED = dict(fingers=[[0.12, 0.18, 0.1], [0.08, 0.16, 0.1], [0.12, 0.2, 0.12], [0.18, 0.26, 0.14]], thumb=[0.75, 0.35, 0.5, 0.15, 0.15])
# Noctua's: the little finger kept out
FLIP_DAINTY = dict(fingers=[CURL, [0.0, 0.03, 0.02], CURL, [0.95, 0.75, 0.35]], thumb=THUMB_TUCK)
THUMBS_DAINTY = dict(fingers=[[1.45, 1.6, 1.0], CURL, CURL, [0.5, 0.45, 0.2]], thumb=[1.25, 0.05, 0.3, -0.05, -0.08])
POSES = dict(wave=FLAT, flip=FLIP, thumbs=THUMBS, laugh=POINT, shrug=CUPPED, clap=FLAT)


def blend(a, b, k):
    """A hand pose k of the way from a to b (the bends blend; each is a joint angle)."""
    return dict(fingers=[[x + (y - x) * k for x, y in zip(fa, fb)] for fa, fb in zip(a['fingers'], b['fingers'])],
                thumb=[x + (y - x) * k for x, y in zip(a['thumb'], b['thumb'])])


def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def window(t, a, b, c, d):
    """0 before a, rising to 1 by b, 1 until c, back to 0 by d."""
    return smooth((t - a) / max(1e-6, b - a)) * (1 - smooth((t - c) / max(1e-6, d - c)))


def rot(axis, angle, v):
    return ps.q_rot(ps.q_axis(axis, angle), v)


class Gestures:
    """Builds the gesture clips for one Body in one style."""

    def __init__(self, body, style=None):
        self.b = body
        self.s = dict(tempo=1.0, big=1.0, ease='io', crisp=False, flourish=False, jaw=False)
        self.s.update(style or {})
        self.G_inv = np.linalg.inv(hd.to_grip(body.hand))

    # ---------- hand frames ----------

    def grip(self, palm, finger, facing):
        """The right hand's control frame (pos, quat) for a palm frame in chest space."""
        f = unit(np.asarray(finger, float)); n = np.asarray(facing, float); n = unit(n - f * np.dot(n, f))
        M = np.eye(4); M[:3, :3] = np.stack([np.cross(f, n), f, n], 1); M[:3, 3] = palm
        return ps.decompose(M @ self.G_inv)

    @staticmethod
    def palm_l(palm, finger, facing):
        """The left hand's control frame (its palm frame) for a palm frame in chest space."""
        f = unit(np.asarray(finger, float)); n = np.asarray(facing, float); n = unit(n - f * np.dot(n, f))
        return np.asarray(palm, float), ps.q_from_mat(np.stack([np.cross(f, n), f, n], 1))

    def hand(self, side, k, pose, pole, sway=0.5):
        """A hand channel: from rest to `pose(t)` -> (palm, finger, facing) by `k` (a Channel)."""
        b = self.b

        def B(t, ctx):
            palm, finger, facing = pose(t)
            if side == 'R':
                p, q = self.grip(palm, finger, facing)
            else:
                p, q = self.palm_l(palm * MIRROR, finger * MIRROR, facing * MIRROR)
            return p, q, (pole if side == 'R' else pole * MIRROR)

        rest = b.REST[side]

        def f(t, ctx, _side):
            pa, qa = ctx['to_chest'](rest[0], rest[1], rest[2])
            kk = float(k.at(t))
            pb, qb, pole_b = B(t, ctx)
            pos, quat = pa + (pb - pa) * kk, q_slerp(qa, qb, kk)
            # lifted on the way, so fingers coming off the felt never dip into it
            pos = pos + V(0, 0.05 * 4 * kk * (1 - kk), 0) if 0 < kk < 1 else pos
            return pos, quat, unit(rest[3] + (pole_b - rest[3]) * min(1, max(0, kk))), sway
        return f

    def fingers(self, side, k, pose):
        """Finger channel: the open hand to `pose` by `k`."""
        return lambda t: (pose, float(k.at(t)))

    def T(self, *ts):
        return [x * self.s['tempo'] for x in ts]

    def env(self, up, hold, down, end, ease=None):
        """The usual 0 -> 1 -> 0 envelope: rises by `up`, holds until `hold`, rests again by `down`."""
        e = ease or self.s['ease']
        return K((0, 0), (up, 1, e), (hold, 1), (down, 0, 'io'), (end, 0))

    # ---------- the gestures ----------

    def wave(self):
        s = self.s; big = s['big']
        up, wag0, wag1, down, dur = self.T(0.42, 0.5, 1.5, 1.95, 2.05)
        k = self.env(up, wag1, down, dur)
        n = 3 if not s['crisp'] else 4
        amp = 0.42 * (0.85 if s['flourish'] else 1.0)

        def wag(t):
            u = min(1, max(0, (t - wag0) / (wag1 - wag0)))
            if s['crisp']:
                # a metronome: a steady triangle wave, eased only at its turns
                ph = (u * n) % 1.0; tri = 4 * abs(ph - 0.5) - 1
                return amp * math.copysign(smooth(abs(tri)) ** 0.6, tri) * window(t, wag0 - 0.05, wag0 + 0.1, wag1 - 0.1, wag1)
            return amp * math.sin(TAU * n * u) * window(t, wag0 - 0.05, wag0 + 0.15, wag1 - 0.15, wag1)

        def pose(t):
            a = wag(t)
            palm = V(-0.31 - 0.03 * big, 0.5 + 0.06 * big, 0.12 + 0.03 * big)
            # the hand rocks side to side about the wrist, the palm to the table
            finger = rot(V(0, 0, 1), -a, V(0.12, 1, 0.05))
            palm = palm + V(-math.sin(a) * 0.07, 0, 0)
            return palm, finger, V(0.15, 0, 1)

        return dict(
            dur=dur,
            spine=K((0, Z3), (up, V(-0.02, 0.04, -0.03 * big)), (wag1, V(-0.02, 0.04, -0.03 * big)), (down, Z3)),
            neck=K((0, Z3), (up + 0.1, V(-0.04, 0, 0.05 if s['flourish'] else 0.0)), (wag1, V(-0.04, 0, 0.05 if s['flourish'] else 0.0)), (down, Z3)),
            head=K((0, Z3), (up + 0.15, V(-0.06, 0, -0.06 if s['flourish'] else 0.02)), (wag1, V(-0.06, 0, -0.06 if s['flourish'] else 0.02)), (down + 0.05, Z3)),
            clav_R=K((0, Z2), (up, V(0.22, 0.04)), (wag1, V(0.22, 0.04)), (down, Z2)),
            hand_R=self.hand('R', k, pose, V(-1, -0.7, -0.1)),
            fingers_R=self.fingers('R', k, FLAT),
        )

    def flip(self):
        s = self.s; big = s['big']
        if s['flourish']:
            # the hand rises palm out, rolls over in a twirl, and the finger is presented
            up, land, hold, down, dur = self.T(0.45, 0.95, 1.85, 2.3, 2.4)
        else:
            up, land, hold, down, dur = self.T(0.38, 0.38, 1.6, 2.05, 2.15)
        k = self.env(up, hold, down, dur)
        out = 0.06 * (big - 1)

        def pose(t):
            palm = V(-0.13 - out, 0.44 + 0.03 * big, 0.34 + 0.08 * (big - 1))
            if s['flourish']:
                # a full turn of the wrist about the forearm, finishing back-of-hand to the table
                u = smooth((t - up * 0.7) / (land - up * 0.7))
                twirl = (1 - u) * TAU * 0.75
                facing = rot(V(0, 1, 0.1), twirl, V(0.05, -0.05, -1))
                palm = palm + V(0.03 * math.sin(TAU * u), 0.03 * math.sin(math.pi * u), 0)
                return palm, V(0.05, 1, 0.12), facing
            if s['big'] > 1.05:
                # a thrust at them, then held there shaking a little
                thrust = window(t, up - 0.05, up + 0.12, up + 0.25, up + 0.5)
                shake = 0.008 * math.sin(TAU * 7 * t) * window(t, up + 0.3, up + 0.4, hold - 0.1, hold)
                palm = palm + V(shake, 0, 0.07 * thrust)
            return palm, V(0.05, 1, 0.12), V(0.05, -0.05, -1)

        if s['flourish']:
            fk = K((0, 0), (land - 0.2, 0.15), (land, 1, 'over'), (hold, 1), (down, 0, 'io'), (dur, 0))
            fingers = FLIP_DAINTY
        else:
            fk = K((0, 0), (up * 0.8, 1, s['ease']), (hold, 1), (down, 0, 'io'), (dur, 0))
            fingers = FLIP
        lean = V(0.06 * big, 0, 0) if big > 1.05 else V(0.02, 0, 0)
        return dict(
            dur=dur,
            spine=K((0, Z3), (up, lean, s['ease']), (hold, lean), (down, Z3)),
            chest=K((0, Z3), (up, V(0, 0.05, 0)), (hold, V(0, 0.05, 0)), (down, Z3)),
            neck=K((0, Z3), (up, V(-0.03, 0, 0)), (hold, V(-0.03, 0, 0)), (down, Z3)),
            # the chin up (Noctua's cocked as well)
            head=K((0, Z3), (land, V(-0.1, 0, 0.12 if s['flourish'] else 0.0), s['ease']), (hold, V(-0.1, 0, 0.12 if s['flourish'] else 0.0)), (down, Z3)),
            clav_R=K((0, Z2), (up, V(0.16 * big, 0.12)), (hold, V(0.16 * big, 0.12)), (down, Z2)),
            clav_L=K((0, Z2), (up, V(0.05 * big, 0)), (hold, V(0.05 * big, 0)), (down, Z2)),
            hand_R=self.hand('R', k, pose, V(-1, -0.6, -0.2)),
            fingers_R=self.fingers('R', fk, fingers),
            **self.jaw_open(K((0, 0), (up, 0.12), (hold, 0.12), (down, 0))),
        )

    def thumbs(self):
        s = self.s; big = s['big']
        up, hold, down, dur = self.T(0.42, 1.45, 1.85, 1.95)
        k = self.env(up, hold, down, dur)

        def pose(t):
            # a little pump at the top (none for Brass, who just presents it)
            pump = 0 if s['crisp'] else 0.025 * big * math.sin(math.pi * min(1, max(0, (t - up) / 0.3)))
            palm = V(-0.21, 0.25 + 0.03 * big + pump, 0.38 + 0.03 * big)
            return palm, V(0.35, 0, 1), V(1, -0.1, 0.1)

        fk = K((0, 0), (up * 0.7, 1, s['ease']), (hold, 1), (down, 0, 'io'), (dur, 0))
        return dict(
            dur=dur,
            spine=K((0, Z3), (up, V(0.04 * big, 0, 0)), (hold, V(0.04 * big, 0, 0)), (down, Z3)),
            neck=K((0, Z3), (up, V(0, 0, 0)), (hold, Z3), (down, Z3)),
            # a nod (Noctua tips her head instead)
            head=K((0, Z3), (up, V(0.1, 0, 0.1 if s['flourish'] else 0.0), s['ease']), (up + 0.3, V(-0.02, 0, 0.1 if s['flourish'] else 0.0)), (hold, V(-0.02, 0, 0.1 if s['flourish'] else 0.0)), (down, Z3)),
            clav_R=K((0, Z2), (up, V(0.08, 0.2)), (hold, V(0.08, 0.2)), (down, Z2)),
            hand_R=self.hand('R', k, pose, V(-1, -0.8, -0.2)),
            fingers_R=self.fingers('R', fk, THUMBS_DAINTY if s['flourish'] else THUMBS),
        )

    def laugh(self):
        s = self.s; big = s['big']
        up, hold, down, dur = self.T(0.4, 2.0, 2.45, 2.55)
        k = self.env(up, hold, down, dur)
        rate = 3.2 if s['crisp'] else 2.6 / max(1, big ** 0.5)

        def shake(t):
            # the laugh's bounce: steady pulses for Brass, ragged ones otherwise
            w = window(t, up - 0.1, up + 0.1, hold - 0.2, hold)
            if s['crisp']:
                return w * (1 if (rate * (t - up)) % 1 < 0.5 else -1) * smooth(abs(math.sin(math.pi * 2 * rate * (t - up))) * 3)
            return w * (math.sin(TAU * rate * (t - up)) * 0.7 + math.sin(TAU * rate * 1.7 * (t - up) + 1) * 0.3)

        def pose(t):
            j = shake(t)
            palm = V(-0.2, 0.33 + 0.006 * j, 0.44 + 0.02 * big + 0.012 * j)
            return palm, unit(V(0.18, 0.1 + 0.04 * j, 1)), V(0.25, -1, 0)

        bob = lambda amp: Fn(lambda t: amp * shake(t))
        spine = lambda t: V(-0.05 * big * window(t, 0, up, hold, down) + 0.025 * big * shake(t), 0, 0)
        fk = K((0, 0), (up * 0.7, 1, s['ease']), (hold, 1), (down, 0, 'io'), (dur, 0))
        return dict(
            dur=dur,
            spine=Fn(spine),
            chest_dy=bob(0.006 * big),
            neck=Fn(lambda t: V(-0.06 * window(t, 0, up, hold, down), 0, 0)),
            # the head goes back with it
            head=Fn(lambda t: V(-0.16 * big * window(t, 0, up + 0.2, hold, down) + 0.04 * shake(t), 0, (0.08 if s['flourish'] else 0.0) * window(t, 0, up, hold, down))),
            clav_R=K((0, Z2), (up, V(0.12, 0.28)), (hold, V(0.12, 0.28)), (down, Z2)),
            clav_L=Fn(lambda t: V(0.06 * window(t, 0, up, hold, down) + 0.03 * shake(t), 0)),
            hand_R=self.hand('R', k, pose, V(-1, -0.6, -0.1)),
            fingers_R=self.fingers('R', fk, POINT),
            **self.jaw_open(Fn(lambda t: (0.22 + 0.1 * shake(t)) * window(t, 0.1, up + 0.1, hold, down))),
        )

    def shrug(self):
        s = self.s; big = s['big']
        up, hold, down, dur = self.T(0.45, 1.25, 1.75, 1.85)
        k = self.env(up, hold, down, dur)

        def pose(t):
            return V(-0.33 - 0.03 * big, 0.16, 0.23), unit(V(-0.45, 0.15, 1)), V(-0.15, 1, 0.1)

        lift = V(0.32 * big, 0.06)
        return dict(
            dur=dur,
            spine=K((0, Z3), (up, V(-0.03, 0, 0)), (hold, V(-0.03, 0, 0)), (down, Z3)),
            chest_dy=K((0, 0), (up, 0.006 * big), (hold, 0.006 * big), (down, 0)),
            neck=K((0, Z3), (up, V(0, 0, 0)), (hold, Z3), (down, Z3)),
            # the head tilts and the brows go up with the shoulders
            head=K((0, Z3), (up + 0.1, V(-0.04, 0, 0.16 if not s['crisp'] else 0.1), s['ease']), (hold, V(-0.04, 0, 0.16 if not s['crisp'] else 0.1)), (down + 0.05, Z3)),
            clav_R=K((0, Z2), (up, lift, s['ease']), (hold, lift), (down, Z2)),
            clav_L=K((0, Z2), (up, lift, s['ease']), (hold, lift), (down, Z2)),
            hand_R=self.hand('R', k, pose, V(-1, -0.9, -0.3)),
            hand_L=self.hand('L', k, pose, V(-1, -0.9, -0.3), sway=0),
            fingers_R=self.fingers('R', k, CUPPED),
        )

    def clap(self):
        s = self.s; big = s['big']
        n = 3
        up = 0.45 * s['tempo']; gap = (0.62 if not s['crisp'] else 0.55) * s['tempo']
        hold = up + gap * n; down = hold + 0.45; dur = down + 0.1
        k = self.env(up, hold, down, dur)
        # Noctua claps with her fingertips, close in; Gristle with his whole hands, wide
        wide = 0.1 * big * (0.6 if s['flourish'] else 1.0)

        def apart(t):
            if t < up or t > hold:
                return 1.0
            ph = ((t - up) / gap) % 1.0
            # the hands speed up into each other (struck at STRIKE of the beat) and part slowly
            return 1 - (ph / STRIKE) ** 2 if ph < STRIKE else smooth((ph - STRIKE) / (1 - STRIKE))

        def pose(t):
            a = apart(t)
            palm = V(-0.032 - wide * a, 0.25 + 0.02 * big, 0.36 + 0.02 * big)
            return palm, unit(V(-0.05, 0.75, 1)), V(1, 0.05, -0.1)

        return dict(
            dur=dur,
            spine=K((0, Z3), (up, V(-0.02, 0, 0)), (hold, V(-0.02, 0, 0)), (down, Z3)),
            neck=K((0, Z3), (up, V(0, 0, 0)), (hold, Z3), (down, Z3)),
            head=K((0, Z3), (up, V(0.05, 0, 0.05 if s['flourish'] else 0.0)), (hold, V(0.05, 0, 0.05 if s['flourish'] else 0.0)), (down, Z3)),
            clav_R=K((0, Z2), (up, V(0.05, 0.22)), (hold, V(0.05, 0.22)), (down, Z2)),
            clav_L=K((0, Z2), (up, V(0.05, 0.22)), (hold, V(0.05, 0.22)), (down, Z2)),
            hand_R=self.hand('R', k, pose, V(-1, -0.7, -0.2)),
            hand_L=self.hand('L', k, pose, V(-1, -0.7, -0.2), sway=0),
            fingers_R=self.fingers('R', k, FLAT),
            fingers_L=self.fingers('L', k, FLAT),
        )

    def jaw_open(self, ch):
        return dict(bones={'jaw': Fn(lambda t: V(float(ch.at(t)), 0, 0))}) if self.s['jaw'] else {}

    def clips(self):
        return {f'emote_{name}': getattr(self, name) for name in ('wave', 'flip', 'thumbs', 'laugh', 'shrug', 'clap')}


class Fn(Channel):
    def __init__(self, f):
        self.f = f

    def at(self, t):
        return self.f(t)

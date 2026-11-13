"""Quaternions (x, y, z, w, as three.js), the arm solver and keyed channels for baking clips.

The arm maths is the game's own (src/render/rig.js solves the same two-bone chain at run time), so
a clip's baked arm and the run-time correction agree about where a hand is.
"""
import math
import numpy as np
from .meshkit import V, unit

IDENT = np.array([0.0, 0, 0, 1])


def q_mul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz])


def q_conj(q):
    return np.array([-q[0], -q[1], -q[2], q[3]])


def q_rot(q, v):
    u, w = np.asarray(q[:3]), q[3]
    v = np.asarray(v, float)
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def q_axis(axis, angle):
    a = unit(axis) * math.sin(angle / 2)
    return np.array([a[0], a[1], a[2], math.cos(angle / 2)])


def q_mat(q):
    return np.stack([q_rot(q, V(1, 0, 0)), q_rot(q, V(0, 1, 0)), q_rot(q, V(0, 0, 1))], 1)


def q_from_mat(R):
    """From a rotation matrix whose columns are the frame's x, y and z."""
    m = np.asarray(R, float); t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = 0.5 / math.sqrt(t + 1); q = [(m[2, 1] - m[1, 2]) * s, (m[0, 2] - m[2, 0]) * s, (m[1, 0] - m[0, 1]) * s, 0.25 / s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2 * math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]); q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = 2 * math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]); q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = 2 * math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]); q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    return unit(np.array(q))


def q_euler(rx, ry, rz, order='XYZ'):
    """A three.js Euler: 'XYZ' is Object3D.rotation's default, 'YXZ' is the game's quatE()."""
    q = {'X': q_axis(V(1, 0, 0), rx), 'Y': q_axis(V(0, 1, 0), ry), 'Z': q_axis(V(0, 0, 1), rz)}
    return q_mul(q_mul(q[order[0]], q[order[1]]), q[order[2]])


def q_between(a, b):
    a, b = unit(a), unit(b); c = np.cross(a, b); d = float(np.dot(a, b))
    if d < -0.999999:
        ax = np.cross(a, V(1, 0, 0)); ax = np.cross(a, V(0, 1, 0)) if np.linalg.norm(ax) < 1e-6 else ax
        return q_axis(ax, math.pi)
    return unit(np.array([c[0], c[1], c[2], 1 + d]))


def q_slerp(a, b, t):
    """Slerp that also runs past either end (t < 0 or t > 1), for overshoot."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.999999:
        return unit(a + (b - a) * t)
    th = math.acos(min(1, d))
    return unit((math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th))


def basis(x, z):
    """Grip-frame orientation from the grip's +x (the shooter's left) and barrel (+z) directions."""
    z = unit(z); y = unit(np.cross(z, x)); x = np.cross(y, z)
    return q_from_mat(np.stack([x, y, z], 1))


def frame(y, z):
    """Orientation from where +y and +z should point (z is made orthogonal to y)."""
    y = unit(y); z = unit(np.asarray(z, float) - y * np.dot(z, y)); x = np.cross(y, z)
    return q_from_mat(np.stack([x, y, z], 1))


def bone_quat(a, b, bend):
    """Orientation whose -y runs from a to b and whose +z leans toward `bend`."""
    y = unit(a - b); z = unit(bend - y * np.dot(bend, y)); x = np.cross(y, z)
    return q_from_mat(np.stack([x, y, z], 1))


def compose(p, q):
    M = np.eye(4); M[:3, :3] = q_mat(q); M[:3, 3] = p
    return M


def decompose(M):
    return M[:3, 3].copy(), q_from_mat(M[:3, :3])


def solve_arm(S, pos, quat, wrist, fore, pole, L1, L2, sway=0.6):
    """Two-bone IK in the chest's space. `pos`/`quat` pose the hand's control frame, `wrist` is the
    wrist joint in that frame and `fore` the hand's own line up its forearm (or None). Returns the
    upper arm's and forearm's orientations, and the elbow and wrist points."""
    W = q_rot(quat, wrist) + pos
    d = W - S; dist = float(np.linalg.norm(d)); d = d / dist
    reach, knee = L1 + L2 - 0.002, L1 + L2 - 0.022
    if dist > knee:
        dist = knee + (reach - knee) * (1 - math.exp((knee - dist) / (reach - knee)))
    dist = max(0.08, dist)
    W = S + d * dist
    cos_a = float(np.clip((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1)); sin_a = math.sqrt(1 - cos_a * cos_a)
    n = unit(pole - d * np.dot(pole, d))
    if fore is not None and sway > 0:
        x = q_rot(quat, fore) * L2 + W - S; x = x - d * np.dot(x, d)
        if np.dot(x, x) > 1e-8:
            x = unit(x)
            swing = math.atan2(np.dot(np.cross(n, x), d), np.dot(n, x))
            n = q_rot(q_axis(d, float(np.clip(swing, -sway, sway))), n)
    E = S + d * (cos_a * L1) + n * (sin_a * L1)
    return bone_quat(S, E, n), bone_quat(E, W, n), E, W


# ---- keyed channels ----

EASE = {
    'linear': lambda u: u,
    'in': lambda u: u * u * u,
    'out': lambda u: 1 - (1 - u) ** 3,
    'io': lambda u: u * u * u * (u * (u * 6 - 15) + 10),
    'soft': lambda u: u * u * (3 - 2 * u),
    # leaves gently, overshoots its key by about 7% and comes back onto it
    'over': lambda u: 1 + 2.4 * (u ** 1.6 - 1) ** 3 + 1.4 * (u ** 1.6 - 1) ** 2,
    'snap': lambda u: 1 - (1 - u) ** 5,
}


class Channel:
    """Keys (time, value, ease-into-this-key). Values are numbers, vectors or quaternions (`quat=True`)."""

    def __init__(self, keys, quat=False):
        self.keys = [(float(t), np.asarray(v, float), e) for t, v, e in ((k if len(k) == 3 else (*k, 'io')) for k in keys)]
        self.quat = quat

    def at(self, t):
        k = self.keys
        if t <= k[0][0]:
            return k[0][1]
        for (t0, v0, _), (t1, v1, e) in zip(k, k[1:]):
            if t <= t1:
                u = EASE[e]((t - t0) / (t1 - t0))
                return q_slerp(v0, v1, u) if self.quat else v0 + (v1 - v0) * u
        return k[-1][1]

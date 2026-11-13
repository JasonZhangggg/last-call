"""Geometry in numpy, in the game's own space (metres, +y up, +z toward the table).

A Geo holds positions, normals, uvs and triangles, plus skin weights once `bind` or `skin` has been
called. The primitives lay out their vertices the way three.js does, so the game's procedural
textures tile on them as they did on the code-built models. No Blender in this file.
"""
import math
import numpy as np

TAU = math.tau


def V(*a):
    return np.array(a, dtype=float)


def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(n < 1e-12, 1, n)


def smoothstep(a, b, x):
    u = np.clip((np.asarray(x, dtype=float) - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def euler_yxz(rx, ry, rz):
    """Rotation matrix of a three.js Euler in 'YXZ' order (the order place() uses)."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Ry @ Rx @ Rz


class Geo:
    def __init__(self, P, N, UV, F):
        self.P, self.N, self.UV, self.F = np.asarray(P, float), np.asarray(N, float), np.asarray(UV, float), np.asarray(F, int)
        self.bones = None  # list of names, with self.W (n, len(bones))

    def copy(self):
        g = Geo(self.P.copy(), self.N.copy(), self.UV.copy(), self.F.copy())
        if self.bones:
            g.bones, g.W = list(self.bones), self.W.copy()
        return g

    def apply(self, M3, t=(0, 0, 0)):
        """Linear map then translation; normals by the inverse transpose, winding flipped by a mirror."""
        M3 = np.asarray(M3, float)
        self.P = self.P @ M3.T + np.asarray(t, float)
        self.N = unit(self.N @ np.linalg.inv(M3))
        if np.linalg.det(M3) < 0:
            self.F = self.F[:, ::-1].copy()
        return self

    def place(self, p=(0, 0, 0), r=(0, 0, 0), s=1):
        S = np.diag([s, s, s] if np.isscalar(s) else list(s)).astype(float)
        return self.apply(euler_yxz(*r) @ S, p)

    def bind(self, bone):
        self.bones, self.W = [bone], np.ones((len(self.P), 1))
        return self

    def skin(self, bones, W):
        W = np.asarray(W, float)
        self.bones, self.W = list(bones), W / W.sum(axis=1, keepdims=True)
        return self

    def smooth_normals(self):
        """Area-weighted normals, shared by vertices at the same place (so seams stay smooth)."""
        key = np.round(self.P / 1e-6).astype(np.int64)
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        a, b, c = self.P[self.F[:, 0]], self.P[self.F[:, 1]], self.P[self.F[:, 2]]
        fn = np.cross(b - a, c - a)
        acc = np.zeros((inv.max() + 1, 3))
        for k in range(3):
            np.add.at(acc, inv[self.F[:, k]], fn)
        self.N = unit(acc[inv])
        return self


def merge(geos):
    """One Geo from many; bones are unioned."""
    bones = []
    for g in geos:
        for b in g.bones or []:
            if b not in bones:
                bones.append(b)
    P, N, UV, F, W, off = [], [], [], [], [], 0
    for g in geos:
        P.append(g.P); N.append(g.N); UV.append(g.UV); F.append(g.F + off); off += len(g.P)
        w = np.zeros((len(g.P), len(bones)))
        for i, b in enumerate(g.bones or []):
            w[:, bones.index(b)] = g.W[:, i]
        W.append(w)
    out = Geo(np.concatenate(P), np.concatenate(N), np.concatenate(UV), np.concatenate(F))
    out.bones, out.W = bones, np.concatenate(W)
    return out


def _grid_faces(rows, cols):
    """Triangles of a (rows+1) x (cols+1) vertex grid, wound like three's parametric surfaces."""
    i, j = np.meshgrid(np.arange(rows), np.arange(cols), indexing='ij')
    a = (i * (cols + 1) + j).ravel(); b = a + cols + 1; c = b + 1; d = a + 1
    return np.concatenate([np.stack([a, b, d], 1), np.stack([b, c, d], 1)])


def sphere(r=1, wseg=16, hseg=12, phi0=0, phi_len=TAU, th0=0, th_len=math.pi):
    v, u = np.meshgrid(np.linspace(0, 1, hseg + 1), np.linspace(0, 1, wseg + 1), indexing='ij')
    ph, th = phi0 + u * phi_len, th0 + v * th_len
    n = np.stack([-np.cos(ph) * np.sin(th), np.cos(th), np.sin(ph) * np.sin(th)], -1).reshape(-1, 3)
    return Geo(n * r, n, np.stack([u, 1 - v], -1).reshape(-1, 2), _grid_faces(hseg, wseg)[:, ::-1])


def rings(centres, radii, frames=None, radial=12, cap0=False, cap1=False, vscale=1.0):
    """A tube of circular rings round `centres` (n, 3). `frames` (n, 3, 3) has each ring's x, y(axis), z rows."""
    centres, radii = np.asarray(centres, float), np.asarray(radii, float)
    n = len(centres)
    if frames is None:
        frames = transport_frames(centres)
    a = np.linspace(0, TAU, radial + 1)
    ring = np.stack([np.sin(a), np.zeros_like(a), np.cos(a)], -1)  # in ring space, about its y
    dirs = np.einsum('rk,nkj->nrj', ring, frames)
    P = centres[:, None, :] + dirs * radii[:, None, None]
    # normals lean with the taper
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(centres, axis=0), axis=1))])
    slope = np.gradient(radii, np.where(np.gradient(s) == 0, 1, s)) if n > 1 else np.zeros(n)
    Nn = unit(dirs - slope[:, None, None] * frames[:, None, 1, :])
    u, v = np.meshgrid(np.linspace(0, 1, radial + 1), s / (s[-1] or 1) * vscale, indexing='xy')
    g = Geo(P.reshape(-1, 3), Nn.reshape(-1, 3), np.stack([u, v], -1).reshape(-1, 2), _grid_faces(n - 1, radial))
    g.ring_of = np.repeat(np.arange(n), radial + 1)
    parts = [g]
    for on, i, sign in ((cap0, 0, -1), (cap1, n - 1, 1)):
        if on:
            c = circle(radii[i], radial)
            R = np.stack([frames[i][0] * -sign, frames[i][2], frames[i][1] * sign])  # disc's x, y, z(normal)
            c.apply(R.T, centres[i]); c.ring_of = np.full(len(c.P), i)
            parts.append(c)
    if len(parts) > 1:
        ro = np.concatenate([p.ring_of for p in parts]); g = merge(parts); g.bones = None; g.ring_of = ro
    return g


def transport_frames(centres):
    """A frame per point along a polyline, carried along without twisting."""
    c = np.asarray(centres, float)
    t = unit(np.gradient(c, axis=0))
    x = np.cross(t[0], V(0, 0, 1))
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(t[0], V(1, 0, 0))
    x = unit(x)
    out = []
    for i in range(len(c)):
        x = unit(x - t[i] * np.dot(x, t[i]))
        out.append(np.stack([x, t[i], np.cross(x, t[i])]))
    return np.array(out)


def tube(a, b, ra, rb=None, seg=14, caps=True):
    """A capped cylinder from a to b, radius ra at a and rb at b."""
    rb = ra if rb is None else rb
    return rings(np.array([a, b], float), [ra, rb], radial=seg, cap0=caps, cap1=caps)


def cylinder(rt, rb, h, seg=14, open_=False):
    return tube(V(0, -h / 2, 0), V(0, h / 2, 0), rb, rt, seg, not open_)


def circle(r, seg=24):
    a = np.linspace(0, TAU, seg + 1)
    P = np.concatenate([[[0, 0, 0]], np.stack([np.cos(a) * r, np.sin(a) * r, np.zeros_like(a)], -1)])
    F = np.array([[0, i, i + 1] for i in range(1, seg + 1)])
    return Geo(P, np.tile([0, 0, 1.0], (len(P), 1)), P[:, :2] / (2 * r) + 0.5, F)


def torus(R, r, rseg=8, tseg=24):
    """Round the z axis, like three's TorusGeometry."""
    v, u = np.meshgrid(np.linspace(0, TAU, rseg + 1), np.linspace(0, TAU, tseg + 1), indexing='ij')
    P = np.stack([(R + r * np.cos(v)) * np.cos(u), (R + r * np.cos(v)) * np.sin(u), r * np.sin(v)], -1).reshape(-1, 3)
    C = np.stack([R * np.cos(u), R * np.sin(u), np.zeros_like(u)], -1).reshape(-1, 3)
    return Geo(P, unit(P - C), np.stack([u / TAU, v / TAU], -1).reshape(-1, 2), _grid_faces(rseg, tseg)[:, ::-1])


def lathe(pts, seg=32):
    """Profile points (x, y) spun round y."""
    pts = np.asarray(pts, float)
    ph = np.linspace(0, TAU, seg + 1)
    P = np.stack([np.outer(np.sin(ph), pts[:, 0]), np.tile(pts[:, 1], (seg + 1, 1)), np.outer(np.cos(ph), pts[:, 0])], -1).reshape(-1, 3)
    u, v = np.meshgrid(np.linspace(0, 1, seg + 1), np.linspace(0, 1, len(pts)), indexing='ij')
    # the normal is the profile's tangent turned outward: a profile running up the outside faces out
    d = np.gradient(pts, axis=0); n2 = unit(np.stack([d[:, 1], -d[:, 0]], -1))
    N = np.stack([np.outer(np.sin(ph), n2[:, 0]), np.tile(n2[:, 1], (seg + 1, 1)), np.outer(np.cos(ph), n2[:, 0])], -1).reshape(-1, 3)
    return Geo(P, N, np.stack([u, v], -1).reshape(-1, 2), _grid_faces(seg, len(pts) - 1))


def box(w, h, d):
    P, N, UV, F = [], [], [], []
    for ax in range(3):
        for sign in (-1, 1):
            n = np.zeros(3); n[ax] = sign
            u = np.zeros(3); u[(ax + 1) % 3] = 1
            v = np.cross(n, u)
            k = len(P)
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                P.append((n + u * su + v * sv) * V(w, h, d) / 2); N.append(n); UV.append(((su + 1) / 2, (sv + 1) / 2))
            F += [[k, k + 1, k + 2], [k, k + 2, k + 3]]
    return Geo(P, N, UV, F)


def round_box(w, h, d, e=0.3, wseg=22, hseg=14):
    """A superellipsoid: a box with fully rounded edges and true normals."""
    g = sphere(1, wseg, hseg)
    f = lambda v, k: np.sign(v) * np.abs(v) ** k
    x, y, z = g.P.T
    g.N = unit(np.stack([f(x, 2 - e) / w, f(y, 2 - e) / h, f(z, 2 - e) / d], -1))
    g.P = np.stack([f(x, e) * w / 2, f(y, e) * h / 2, f(z, e) * d / 2], -1)
    return g


def catmull(points, n):
    """n+1 points along a centripetal Catmull-Rom spline through `points`, evenly spaced in arc length."""
    p = np.asarray(points, float)
    p = np.concatenate([[2 * p[0] - p[1]], p, [2 * p[-1] - p[-2]]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0; t1 = t0 + max(1e-6, np.linalg.norm(p1 - p0)) ** 0.5; t2 = t1 + max(1e-6, np.linalg.norm(p2 - p1)) ** 0.5; t3 = t2 + max(1e-6, np.linalg.norm(p3 - p2)) ** 0.5
        for t in np.linspace(t1, t2, 24, endpoint=(i == len(p) - 3)):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out = np.array(out)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(out, axis=0), axis=1))])
    want = np.linspace(0, s[-1], n + 1)
    return np.stack([np.interp(want, s, out[:, k]) for k in range(3)], -1)


def sweep(points, radius, seg=24, radial=8, caps=False):
    """A tube along a spline through `points`; `radius` is a number or a function of 0..1 along it."""
    c = catmull(points, seg)
    t = np.linspace(0, 1, seg + 1)
    r = np.array([radius(x) for x in t]) if callable(radius) else np.full(seg + 1, float(radius))
    return rings(c, r, radial=radial, cap0=caps, cap1=caps)


def ball(p, r, s=1, seg=14):
    return sphere(r, seg, max(6, int(seg * 0.7))).place(p, (0, 0, 0), s)


def ring(p, direction, R, r, rseg=6, tseg=24):
    """A torus round axis `direction` at p."""
    g = torus(R, r, rseg, tseg)
    z = unit(direction); x = unit(np.cross(V(0, 1, 0), z) if abs(z[1]) < 0.99 else np.cross(V(1, 0, 0), z)); y = np.cross(z, x)
    return g.apply(np.stack([x, y, z], 1), p)

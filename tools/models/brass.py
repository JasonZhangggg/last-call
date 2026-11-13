"""Brass, the brass automaton: writes assets/models/brass.glb.

    npm run models            (tools/models/build.sh: makes a Python 3.11 venv with bpy, runs this)

One skinned mesh on a real skeleton, sockets for what the hands hold, and keyed clips (the skeleton,
sockets and pose maths are lib/biped.py, shared with the other characters). The look is
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
from lib import meshkit as mk
from lib.meshkit import V
from lib.biped import Body, SIDES, K, Z3, Z2, Fn, to

PI = math.pi
SHOULDER, SH_Y, SH_Z = 0.215, 0.245, -0.01
BODY = Body('brass', arm=dict(shoulder=0.055, elbow=0.046, wrist=0.036, gap=0.012), palm=(0.044, 0.046, 0.021), finger_r=0.0088,
            temple=V(-0.146, 0.06, 0.03), mouth=V(0, -0.07, 0.12), bones=[('lid', 'head', V(0, 0.53, 0.12)), ('needle', 'chest', V(0, 0.13, 0.195))])
REST, LIMP, REACH, AIM, FAN, sip = BODY.REST, BODY.LIMP, BODY.REACH, BODY.AIM, BODY.FAN, BODY.sip
COLOURS = dict(body=(0.85, 0.66, 0.35), iron=(0.17, 0.16, 0.15), copper=(0.76, 0.45, 0.29), lens=(0.27, 0.89, 1), tip=(1, 0.23, 0.13), shutter=(0.85, 0.66, 0.35), dial=(0.91, 0.86, 0.74), needle=(0.54, 0.1, 0.06))


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
    """One arm: the shared sleeve and hand, and his iron cuff."""
    tube, hand = BODY.arm_parts(side, sg)
    cuff = mk.ring(V(sg * SHOULDER, SH_Y, SH_Z) + V(0, BODY.sleeve_end() + 0.012, 0), V(0, 1, 0), 0.039, 0.0075).bind(f'forearm.{side}')
    return [('body', tube), ('iron', cuff), ('body', hand)]


# ---------- clips ----------
# Each clip keys the body's channels and says where each hand is going. Times are seconds; a key is
# (time, value, ease into it). The torso and shoulder start before the hand and the head follows, so
# no part moves alone. Every clip but `idle` and `drink` starts from the rest pose; `drink` starts
# and ends on `hold_glass`'s last frame.
BREATH = 3.6


def idle():
    b = lambda t: math.sin(mk.TAU * t / BREATH) + 0.22 * math.sin(2 * mk.TAU * t / BREATH)
    sway = lambda t: math.sin(mk.TAU * t / (2 * BREATH))
    wrap = Fn
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


if __name__ == '__main__':
    BODY.build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models', 'brass.glb'), body_parts(), COLOURS, CLIPS)

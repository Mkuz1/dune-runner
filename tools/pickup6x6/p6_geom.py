# p6_geom.py — the original 6x6 off-road pickup ("Dune Runner 6x6").
#
# Pure modelling against the p6lib API, so this one file builds the model
# both inside Blender (../p6lib.py) and headlessly (headless/p6lib.py).
# Game coordinates throughout: +Y up, +Z forward, origin on the ground at
# the centre of the chassis. Physics reads the same numbers (see AXLES).
#
# Engineering targets: 5.90 m long over bumpers, 2.15 m wide over the
# flares, 2.03 m to the top of the roof basket, 360 mm under the diffs,
# tandem rear axles 1,150 mm apart, 37x12.5R17 tyres on beadlocks.
import math
from mathutils import Matrix, Vector
from p6lib import *

sc, coll = scene()

# ---------------- key dimensions ----------------
R, TW = 0.47, 0.318                 # tyre radius (37"), tyre width (12.5")
RIM = 0.216                         # 17" bead seat radius
AF, AM, AR = 1.80, -1.20, -2.35     # front axle, tandem axles (1.15 m apart)
TRACK = 0.88                        # wheel centre half-track
HW, ARCH = 0.98, 0.62               # body half width, wheel-arch radius
NOSE, BUMP_F = 2.62, 2.80           # nose face, front bumper face
ZF, ZB = -0.95, -2.95               # bed front, tailgate (2.0 m bed)
BT, BF = 1.45, 1.12                 # bed rail top, bed floor top
ROOF = 1.905

def on_arch(cz, a): return (cz + ARCH * math.cos(a), R + ARCH * math.sin(a))
def arc(cz, a0, a1, n): return [on_arch(cz, a0 + (a1 - a0) * i / n) for i in range(n + 1)]
def tumble(y):
    t = min(max((y - 1.36) / (ROOF - 1.36), 0), 1); t = t * t * (3 - 2 * t)
    return 1 - 0.115 * t
def sidex(y, off=0.0): return HW * tumble(y) + off
def tube(P, key, p0, p1, r, segs=12):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    rot = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    P.cyl(key, tuple((p0 + p1) / 2), r, r, d.length, segs=segs, axis='Y', rot=rot)
def dring(P, c, axis='X'):
    prof = [(0.045 + 0.013 * math.cos(2 * math.pi * k / 8), 0.013 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
    P.lathe("red", prof, segs=14, center=c, axis=axis)

# angles where the arches meet the body lines
A_CAB_REAR = math.acos((-0.88 - AM) / ARCH)          # tandem arch at the cab back wall
A_LOW = math.atan2(0.62 - R, math.sqrt(ARCH**2 - (0.62 - R)**2))
A_WEB = math.asin((0.86 - R) / ARCH)                 # web between the twin arches
A_BED_F = math.acos((ZF - AM) / ARCH)
A_BED_R = math.acos((ZB - AR) / ARCH)

# ======================= BODY SHELL =======================
# Every panel is a loft of rounded cross-sections: soft shoulders, crowned
# hood and roof, a rolled nose, and wheel arches carved into the section
# itself so the lower edge flows around each wheel.
import numpy as _np

def sstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0); return t * t * (3 - 2 * t)
def smin(a, b, k):
    h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25
def arch_y(z, az):
    d = abs(z - az)
    return R + math.sqrt(ARCH * ARCH - d * d) if d < ARCH else -1.0

ZN, ZCR = NOSE + 0.04, -0.88          # nose face, cab back
SILL = 0.62

def lower_bottom(z):
    y = SILL
    y = max(y, arch_y(z, AF))
    if z < AM + ARCH: y = max(y, arch_y(z, AM))
    return y
def lower_top(z):
    if z >= 1.20:                      # hood: falls gently to the nose
        t = (z - 1.20) / (ZN - 1.20)
        return 1.36 - 0.035 * t - 0.055 * t ** 3
    return 1.36
def lower_half(z):
    return HW - 0.028 * sstep(2.15, ZN, z)

body = Part("p6_body")
rows = []
zs = sorted(set([ZCR + (ZN - ZCR) * i / 70 for i in range(71)]
               + [AF + ARCH * math.cos(math.pi * k / 16) for k in range(17)]
               + [AM + ARCH * math.cos(math.pi * k / 24) for k in range(13) if AM + ARCH * math.cos(math.pi * k / 24) > ZCR]))
for z in zs:
    y0, y1, a_ = lower_bottom(z), lower_top(z), lower_half(z)
    # roll the nose in the last 9 cm, like a pressed panel edge
    t = sstep(ZN - 0.09, ZN, z)
    roll = 1 - math.sqrt(max(1 - t * t, 0))
    a_ -= 0.035 * roll; y1 -= 0.05 * roll; y0 += 0.02 * roll
    crown = 0.028 if z > 1.2 else 0.0
    sec = rounded_rect(-a_, a_, y0, y1, 0.035, 0.085, crown=crown)
    rows.append([(x, y, z) for x, y in sec])
body.grid(rows, "paint")

# ---- cabin: raked screen, crowned roof, tumblehome, glazing in-surface ----
CZF, CZR = 1.20, ZCR
def cab_top(z):
    ws = 1.36 + (CZF - z) / 0.70 * 0.50
    y = smin(ws, ROOF, 0.09)
    rr = 1.85 + (z - CZR) / 0.20 * 0.055
    return smin(y, rr, 0.06)
W_EDGE = 0.07
def front_window(z, y):  # door glass: A-pillar edge follows the screen rake
    return 1.43 < y < 1.80 and -0.06 < z < 1.02 - (y - 1.43) * 1.25
def rear_window(z, y):
    return 1.43 < y < 1.80 and -0.70 + (1.80 - y) * 0.20 < z < -0.16
def cab_key(c, n):
    x, y, z = c
    if n[1] > 0.45 and 0.55 < z < 1.14 and abs(x) < 0.86 - W_EDGE:
        return "tint"                                     # windscreen
    if abs(n[0]) > 0.55:
        if front_window(z, y) or rear_window(z, y): return "tint"
        if front_window(z + 0.025, y) or front_window(z - 0.025, y) or rear_window(z + 0.025, y) \
           or rear_window(z - 0.025, y) or front_window(z, y + 0.025) or front_window(z, y - 0.025) \
           or rear_window(z, y + 0.025) or rear_window(z, y - 0.025):
            return "trim"                                 # rubber surround
    return "paint"
cab = Part("p6_cab")
rows = []
czs = sorted(set([CZR + (CZF - CZR) * i / 60 for i in range(61)] + [-0.06, -0.16, 0.56, 1.02]))
for z in czs:
    top = max(cab_top(z), 1.375)
    h = top - 1.36
    ab, at = lower_half(z), 0.86
    rt = min(0.09, h * 0.42)
    pts = []
    for k in range(5): pts.append((-ab + 2 * ab * k / 5, 1.36))                        # sill line
    for k in range(9): pts.append((ab + (at - ab) * k / 9, 1.36 + (h - rt) * k / 9))     # right side
    for k in range(5):
        a_ = (math.pi / 2) * k / 5; pts.append((at - rt + rt * math.cos(a_), top - rt + rt * math.sin(a_)))
    for k in range(10):
        x = (at - rt) - 2 * (at - rt) * k / 10
        pts.append((x, top + 0.02 * (1 - (x / at) ** 2)))                                # crowned roof
    for k in range(5):
        a_ = math.pi / 2 + (math.pi / 2) * k / 5; pts.append((-at + rt + rt * math.cos(a_), top - rt + rt * math.sin(a_)))
    for k in range(9): pts.append((-at + (-ab + at) * k / 9, top - rt - (h - rt) * k / 9))
    rows.append([(x, y, z) for x, y in pts])
cab.grid(rows, "paint", key_fn=cab_key)

# ---- bed sides: lofted panels with rolled top rails and twin arches ----
def bed_bottom(z):
    y = max(arch_y(z, AM), arch_y(z, AR))
    web = 0.86 if AR + 0.40 < z < AM - 0.40 else -1      # web between the twin arches
    return max(y, web, 0.64)
for s in (1, -1):
    rows = []
    for i in range(61):
        z = ZF + (ZB - ZF) * i / 60
        yb = bed_bottom(z)
        sec = []
        for k in range(9):                                 # outer skin, gently bowed
            y = yb + (BT - 0.03 - yb) * k / 8
            bow = 0.008 * math.sin(math.pi * k / 8)
            sec.append((s * (HW + bow), y))
        for k in range(7):                                 # rolled rail
            a_ = math.pi * k / 6
            sec.append((s * (HW - 0.03 + 0.03 * math.cos(a_)), BT - 0.03 + 0.03 * math.sin(a_)))
        for k in range(5):                                 # inner wall
            sec.append((s * (HW - 0.06), BT - 0.03 - (BT - 0.03 - BF) * k / 4))
        if s < 0: sec = sec[::-1]
        rows.append([(x, y, z) for x, y in sec])
    body.grid(rows, "paint")
body.box("paint", (0, (BF + 1.04) / 2, (ZF + ZB) / 2), (2 * HW - 0.10, BF - 1.04, ZF - ZB))   # floor
body.rbox("paint", (0, (BT + 1.04) / 2, ZF - 0.03), (2 * HW - 0.01, BT - 1.04, 0.06), r=0.025)
body.rbox("paint", (0, (BT + 0.66) / 2, ZB + 0.03), (2 * HW - 0.01, BT - 0.66, 0.06), r=0.025)

# baked grime: occlusion low down and in the wheel wells, road dust near the ground
AXZ = (AF, AM, AR)
def grime(p, n):
    x, y, z = float(p[0]), float(p[1]), float(p[2])
    low = min(max((1.00 - y) / 0.48, 0.0), 1.0)
    d = min(math.hypot(z - az, y - R) for az in AXZ)
    well = min(max((ARCH + 0.10 - d) / 0.28, 0.0), 1.0)
    ao = 1.0 - 0.38 * well - 0.12 * low
    if n[1] < -0.4: ao *= 0.55                               # undersides
    dust = low ** 1.6 * 0.6
    return (ao * (1 - 0.18 * dust), ao * (1 - 0.24 * dust), ao * (1 - 0.34 * dust))
body.set_vcol(grime); cab.set_vcol(grime)
body.finalize(coll, smooth_angle=50)
cab.finalize(coll, smooth_angle=50)

# ======================= WHEEL =======================
# origin at the hub, axle along X, outer face toward +X
wh = Part("p6_wheel")
wh.lathe("rubber", [(RIM + 0.006, -0.142), (0.29, -0.160), (0.38, -0.163), (0.448, -0.152), (R - 0.004, -0.122),
                    (R - 0.004, 0.122), (0.448, 0.152), (0.38, 0.163), (0.29, 0.160), (RIM + 0.006, 0.142)], segs=40)
NB = 26
for i in range(NB):
    for xc, off in ((0.068, 0.0), (-0.068, 0.5)):               # staggered mud blocks
        a = 2 * math.pi * (i + off) / NB
        wh.box("rubber", tuple(Matrix.Rotation(a, 4, 'X') @ Vector((xc, R + 0.010, 0))), (0.112, 0.030, 0.082), rot=(a, 0, 0))
    a = 2 * math.pi * (i + 0.25) / NB
    for sx in (1, -1):                                          # open shoulder lugs
        wh.box("rubber", tuple(Matrix.Rotation(a, 4, 'X') @ Vector((sx * 0.158, 0.442, 0))), (0.024, 0.060, 0.064), rot=(a, 0, 0))
for i in range(18):                                             # sidewall puncture ribs
    a = 2 * math.pi * i / 18
    for sx in (1, -1):
        wh.box("rubber", tuple(Matrix.Rotation(a, 4, 'X') @ Vector((sx * 0.162, 0.345, 0))), (0.010, 0.036, 0.050), rot=(a, 0, 0))
wh.cyl("gunmetal", (0, 0, 0), RIM, RIM, 0.24, segs=32)          # barrel
wh.cyl("trim", (0.082, 0, 0), RIM - 0.012, RIM - 0.012, 0.02, segs=32)
for i in range(6):                                              # six-spoke face
    a = 2 * math.pi * i / 6
    wh.box("gunmetal", tuple(Matrix.Rotation(a, 4, 'X') @ Vector((0.098, 0.125, 0))), (0.034, 0.15, 0.058), rot=(a, 0, 0))
wh.cyl("gunmetal", (0.095, 0, 0), 0.072, 0.072, 0.045, segs=18)
wh.cyl("silver", (0.122, 0, 0), 0.040, 0.032, 0.025, segs=14)
for i in range(6):
    a = 2 * math.pi * i / 6 + 0.26
    wh.cyl("silver", (0.12, 0.055 * math.cos(a), 0.055 * math.sin(a)), 0.010, 0.010, 0.025, segs=6)
wh.lathe("trim", [(RIM - 0.010, 0.098), (RIM + 0.028, 0.098), (RIM + 0.028, 0.126), (RIM - 0.010, 0.126)], segs=32)
for i in range(24):                                             # 24 plated beadlock bolts
    a = 2 * math.pi * i / 24
    wh.cyl("gold", (0.132, (RIM + 0.009) * math.cos(a), (RIM + 0.009) * math.sin(a)), 0.0075, 0.0075, 0.016, segs=6)
wh.finalize(coll, smooth_angle=40)

# ======================= DETAIL =======================
D = Part("p6_detail")

# ---- glasshouse: screen and door glass are part of the cabin surface now;
#      only the flat rear light stays a separate pane ----
for key, z, w in (("trim", -0.884, 0.70), ("tint", -0.889, 0.64)):
    D.quad(key, (w, 1.44, z), (-w, 1.44, z), (-w * 0.95, 1.80, z), (w * 0.95, 1.80, z))

# ---- shut lines, chunky handles, big off-road mirrors ----
for s in (1, -1):
    x = s * HW
    for z, y0, y1 in ((1.12, 0.70, 1.36), (-0.11, 0.66, 1.40), (-0.86, 1.02, 1.36)):
        D.box("trim", (x, (y0 + y1) / 2, z), (0.012, y1 - y0, 0.005))   # 5 mm shut line
    D.box("trim", (x, 0.668, 0.25), (0.012, 0.005, 1.60))
    for z in (0.58, -0.30):
        D.box("trim", (s * (HW + 0.016), 1.28, z), (0.035, 0.05, 0.20))
    D.box("trim", (s * (HW + 0.07), 1.44, 0.98), (0.16, 0.04, 0.05))
    D.rbox("trim", (s * (HW + 0.175), 1.52, 0.98), (0.075, 0.30, 0.20), r=0.025)
    D.box("lampAmber", (s * (HW + 0.214), 1.60, 0.98), (0.004, 0.035, 0.14))
    D.box("lampWhite", (s * (HW + 0.175), 1.368, 0.98), (0.04, 0.004, 0.06))   # puddle lamp
    gx0, gx1 = s * (HW + 0.145), s * (HW + 0.205)
    D.quad("glass", (gx0, 1.39, 0.877), (gx1, 1.39, 0.877), (gx1, 1.65, 0.877), (gx0, 1.65, 0.877),
           outward_from=(s * (HW + 0.175), 1.52, 2.0))

# ---- front end ----
D.rbox("grille", (0, 0.95, NOSE + 0.035), (1.16, 0.34, 0.05), r=0.02)
for i in range(4):
    D.box("silver", (0, 0.83 + i * 0.08, NOSE + 0.065), (1.10, 0.024, 0.03))
for s in (1, -1):
    D.rbox("trim", (s * 0.78, 1.04, NOSE + 0.04), (0.32, 0.18, 0.05), r=0.02)
    D.box("lampWhite", (s * 0.78, 1.065, NOSE + 0.07), (0.27, 0.075, 0.02))
    D.box("lampWhite", (s * 0.78, 0.99, NOSE + 0.068), (0.19, 0.045, 0.02))
    D.box("lampAmber", (s * 0.78, 0.92, NOSE + 0.066), (0.27, 0.028, 0.02))
D.rbox("paint", (0, 1.37, 1.95), (0.70, 0.06, 0.95), r=0.028)                       # power dome
D.box("trim", (0, 1.372, 2.40), (0.52, 0.035, 0.07))                       # low scoop above the grille
D.box("grille", (0, 1.376, 2.437), (0.48, 0.022, 0.005))
for s in (1, -1):
    for i in range(4):
        D.box("trim", (s * 0.52, 1.335, 2.12 - i * 0.07), (0.18, 0.012, 0.025))
# high-clearance steel bumper, wings swept up toward the wheels
D.rbox("metal", (0, 0.68, BUMP_F - 0.10), (1.42, 0.24, 0.20), r=0.035)
for s in (1, -1):
    D.rbox("metal", (s * 0.88, 0.76, BUMP_F - 0.22), (0.40, 0.20, 0.18), r=0.03, rot=(-0.22, s * 0.62, 0))
    D.box("lampAmber", (s * 0.84, 0.78, BUMP_F - 0.115), (0.075, 0.075, 0.02))   # cube fog lights
    D.box("trim", (s * 0.84, 0.78, BUMP_F - 0.13), (0.095, 0.095, 0.02))
    dring(D, (s * 0.42, 0.57, BUMP_F + 0.02))                                  # red shackles
D.rbox("trim", (0, 0.68, BUMP_F + 0.005), (0.50, 0.15, 0.04), r=0.015)                   # winch cradle
D.box("red", (0, 0.68, BUMP_F + 0.03), (0.17, 0.05, 0.015))                    # hawse fairlead
D.box("trim", (0, 0.60, BUMP_F + 0.05), (0.035, 0.07, 0.025))                  # hook
D.rbox("metal", (0, 0.42, 2.38), (1.00, 0.03, 0.62), r=0.012, rot=(0.20, 0, 0))          # skid plate

# ---- flares with exposed bolts ----
def bolts(path, x, step=4):
    for (z, y) in path[1:-1:step]:
        D.cyl("silver", (x, y + 0.045, z), 0.010, 0.010, 0.02, segs=6, axis='X')
for s in (1, -1):
    x = s * HW
    fp = arch(AF, R, ARCH, 0.62, n=18)
    D.sweep("trim", fp, x, 0.10, 0.075); bolts(fp, s * (HW + 0.078))
    cab_q = arc(AM, A_LOW, A_CAB_REAR, 6)
    D.sweep("trim", cab_q, x, 0.09, 0.075)
    bed_p = arc(AR, A_BED_R, A_WEB, 10) + [on_arch(AM, math.pi - A_WEB)] + arc(AM, math.pi - A_WEB, A_BED_F, 10)[1:]
    D.sweep("trim", bed_p, x, 0.09, 0.075); bolts(bed_p, s * (HW + 0.078))
    D.rbox("metal", (s * (HW + 0.02), 0.56, 0.30), (0.10, 0.08, 1.40), r=0.03)          # rock slider
    for z in (0.90, 0.30, -0.30):
        D.box("metal", (s * (HW - 0.10), 0.58, z), (0.26, 0.05, 0.05))

# ---- chassis, suspension, drivetrain ----
for s in (1, -1):
    D.box("chassis", (s * 0.46, 0.70, -0.08), (0.10, 0.16, 5.6))              # ladder frame
for z in (2.3, 0.6, -0.6, -1.78, -2.85):
    D.box("chassis", (0, 0.70, z), (0.92, 0.10, 0.08))
# IFS: diff, control arms, coilovers with red adjusters
D.cyl("chassis", (0, 0.50, AF), 0.13, 0.13, 0.22, segs=16, axis='Z')
for s in (1, -1):
    tube(D, "metal", (s * 0.20, 0.44, AF + 0.06), (s * 0.72, 0.42, AF + 0.02), 0.03)
    tube(D, "metal", (s * 0.22, 0.62, AF - 0.04), (s * 0.70, 0.60, AF - 0.02), 0.025)
    tube(D, "silver", (s * 0.56, 0.50, AF - 0.10), (s * 0.48, 1.06, AF - 0.14), 0.045)
    D.cyl("red", (s * 0.48, 1.08, AF - 0.14), 0.03, 0.03, 0.05, segs=10, axis='Y')
# tandem solid axles + ribbed diffs (360 mm under the pumpkins)
for z in (AM, AR):
    D.cyl("chassis", (0, R, z), 0.055, 0.055, 1.44, segs=12, axis='X')
    D.cyl("chassis", (0, R, z), 0.11, 0.11, 0.22, segs=16, axis='Z')
    for k in range(4):
        D.box("silver", (-0.06 + k * 0.04, R, z - 0.115), (0.012, 0.16, 0.012))
for s in (1, -1):
    D.box("chassis", (s * 0.62, 0.56, (AM + AR) / 2), (0.08, 0.10, AM - AR + 0.12))   # walking beam
    D.cyl("yellow", (s * 0.62, 0.56, (AM + AR) / 2), 0.05, 0.05, 0.12, segs=12, axis='X')
    for z in (AM, AR):
        tube(D, "silver", (s * 0.62, 0.60, z), (s * 0.56, 0.96, z + 0.10), 0.035)       # bypass shocks
        D.cyl("red", (s * 0.56, 0.98, z + 0.10), 0.03, 0.03, 0.04, segs=10, axis='Y')
tube(D, "silver", (0, 0.52, AF - 0.15), (0, 0.50, AM + 0.12), 0.04)            # driveshafts
tube(D, "silver", (0, 0.50, AM - 0.12), (0, 0.50, AR + 0.12), 0.04)
# dual side-exit exhaust on the -X side, ahead of the lead tandem axle
for dz in (0.0, -0.10):
    D.cyl("chrome", (-(HW + 0.02), 0.60, -0.42 + dz), 0.042, 0.048, 0.24, segs=12, axis='X',
          rot=Matrix.Rotation(-0.35, 4, 'Z'))
tube(D, "chassis", (-0.30, 0.58, -0.47), (-(HW - 0.05), 0.62, -0.47), 0.05)

# ---- bed: liner, L-tracks, chase rack, gear ----
D.box("trim", (0, BF + 0.006, (ZF + ZB) / 2), (2 * HW - 0.14, 0.012, ZF - ZB - 0.08))     # bedliner
for s in (1, -1):
    D.box("silver", (s * (HW - 0.065), 1.33, (ZF + ZB) / 2), (0.012, 0.03, 1.90))        # L-track walls
    D.box("silver", (s * 0.45, BF + 0.014, (ZF + ZB) / 2), (0.03, 0.006, 1.86))          # L-track floor
    D.box("trim", (s * (HW - 0.035), BT + 0.035, (ZF + ZB) / 2), (0.05, 0.02, 1.90))
HZ, HT = -1.10, 1.98
for s in (1, -1):
    tube(D, "trim", (s * 0.82, BT, HZ), (s * 0.82, HT, HZ), 0.032)
    tube(D, "trim", (s * 0.82, HT - 0.03, HZ - 0.02), (s * 0.84, BT + 0.02, -1.85), 0.028)
tube(D, "trim", (-0.84, HT, HZ), (0.84, HT, HZ), 0.032)
D.rbox("trim", (0, HT + 0.04, HZ + 0.01), (0.80, 0.07, 0.05), r=0.018)
D.box("lampWhite", (0, HT + 0.04, HZ - 0.016), (0.74, 0.045, 0.004))
# recovery boards (orange), standing against the left wall
for k in range(2):
    D.box("orange", (HW - 0.12 - k * 0.05, 1.33, -2.05), (0.04, 0.34, 1.05))
    for z in (-1.70, -2.05, -2.40):
        D.box("orange", (HW - 0.12 - k * 0.05 - 0.015, 1.33, z), (0.012, 0.30, 0.04))
# two 20 L jerry cans (red)
for z in (-1.18, -1.40):
    D.rbox("red", (-0.66, BF + 0.24, z), (0.17, 0.46, 0.33), r=0.03)
    for dy in (-0.10, 0.06):
        D.box("red", (-0.66, BF + 0.24 + dy, z), (0.18, 0.02, 0.31))
    D.box("trim", (-0.66, BF + 0.50, z + 0.10), (0.05, 0.05, 0.05))
    D.box("silver", (-0.66, BF + 0.485, z - 0.05), (0.03, 0.02, 0.15))
# high-lift jack lying across the tailgate end
D.box("trim", (0.05, BF + 0.05, ZB + 0.18), (1.20, 0.06, 0.05))
D.box("red", (0.55, BF + 0.07, ZB + 0.18), (0.14, 0.10, 0.10))
D.box("red", (-0.55, BF + 0.05, ZB + 0.18), (0.10, 0.08, 0.16))
# pre-runner rack for the spare (the wheel itself is an instance of p6_wheel)
for s in (1, -1):
    tube(D, "trim", (s * 0.36, BF + 0.02, -1.95), (s * 0.36, 1.48, -1.28), 0.022)
tube(D, "trim", (-0.38, 1.48, -1.28), (0.38, 1.48, -1.28), 0.022)
spare = (Matrix.Translation(Vector((0.0, 1.43, -1.62))) @ Matrix.Rotation(-0.55, 4, 'X')
         @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
add_instance("p6_spare", "p6_wheel", spare)

# ---- rear ----
for i in range(3):                                                           # tailgate ridges
    D.box("paint", (0, 0.92 + i * 0.13, ZB - 0.008), (1.50, 0.03, 0.016))
D.box("trim", (0, 1.34, ZB - 0.01), (0.30, 0.06, 0.02))                       # recessed latch
for s in (1, -1):
    D.rbox("trim", (s * 0.90, 1.16, ZB - 0.008), (0.15, 0.50, 0.025), r=0.01)
    D.box("lampRed", (s * 0.90, 1.27, ZB - 0.02), (0.11, 0.24, 0.012))
    D.box("lampAmber", (s * 0.90, 1.09, ZB - 0.02), (0.11, 0.07, 0.012))
    D.box("lampWhite", (s * 0.90, 1.00, ZB - 0.02), (0.11, 0.07, 0.012))
D.cyl("metal", (0, 0.66, ZB - 0.10), 0.07, 0.07, 1.80, segs=14, axis='X')     # tubular rear bumper
for s in (1, -1):
    D.cyl("metal", (s * 0.90, 0.66, ZB + 0.05), 0.065, 0.065, 0.30, segs=12, axis='Z')
    dring(D, (s * 0.55, 0.555, ZB - 0.19))
    D.box("lampWhite", (s * 0.30, 0.66, ZB - 0.17), (0.07, 0.07, 0.01))       # backup pods
    D.box("trim", (s * 0.30, 0.66, ZB - 0.16), (0.09, 0.09, 0.02))
D.box("trim", (0, 0.56, ZB - 0.16), (0.075, 0.075, 0.18))                      # receiver hitch

# ---- roof basket + 40" bar ----
RT = ROOF + 0.07
for s in (1, -1):
    tube(D, "trim", (s * 0.76, RT, 0.30), (s * 0.76, RT, -0.68), 0.016)
    tube(D, "trim", (s * 0.76, RT + 0.05, 0.28), (s * 0.76, RT + 0.05, -0.66), 0.014)
    for z in (0.28, -0.20, -0.66):
        D.box("trim", (s * 0.76, ROOF + 0.04, z), (0.03, 0.07, 0.03))
for z in (0.30, -0.18, -0.68):
    tube(D, "trim", (-0.76, RT, z), (0.76, RT, z), 0.014)
D.rbox("trim", (0, RT + 0.02, 0.37), (1.06, 0.06, 0.07), r=0.02)
D.box("lampWhite", (0, RT + 0.02, 0.406), (1.00, 0.03, 0.004))

# ---- snorkel up the -X A-pillar ----
sx = -(HW + 0.045)
tube(D, "trim", (sx, 1.10, 1.30), (sx, 1.36, 1.20), 0.052)
tube(D, "trim", (sx - 0.02, 1.36, 1.20), (sx - 0.02, 1.88, 0.56), 0.052)
D.rbox("trim", (sx - 0.02, 1.92, 0.58), (0.12, 0.12, 0.20), r=0.035)
D.box("grille", (sx - 0.02, 1.92, 0.685), (0.10, 0.09, 0.01))

D.set_vcol(grime)
D.finalize(coll, smooth_angle=45)

# what the game needs to know (physics + attachments), exported as extras
AXLES = {"front": AF, "middle": AM, "rear": AR, "track": TRACK, "wheelR": R, "wheelW": TW}

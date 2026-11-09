# p6lib.py — modelling helpers for the original 6x6 pickup.
#
# Everything is authored in GAME coordinates (three.js: +Y up, +Z forward,
# vehicle origin on the ground under the chassis) so dimensions can be read
# straight against physics.js. finalize() converts each part to Blender's
# Z-up once; the glTF exporter converts back, so the game gets these numbers.

import bpy, bmesh, math
from mathutils import Matrix, Vector

SCENE_NAME = "Pickup6x6"
COLL_NAME = "Pickup6x6"

# game (x, y, z)  ->  blender (x, -z, y)
G2B = Matrix(((1, 0, 0, 0),
              (0, 0, -1, 0),
              (0, 1, 0, 0),
              (0, 0, 0, 1)))

# Material keys are the game's own material names (vehicle.js this.M), so the
# game can swap in its tuned materials by name and lights keep working.
MATS = {
    "paint":     ((0.93, 0.94, 0.95, 1), 0.0, 0.32),
    "trim":      ((0.035, 0.037, 0.04, 1), 0.0, 0.62),
    "grille":    ((0.02, 0.022, 0.025, 1), 0.2, 0.5),
    "metal":     ((0.18, 0.19, 0.2, 1), 0.85, 0.38),
    "chrome":    ((0.8, 0.8, 0.82, 1), 1.0, 0.12),
    "silver":    ((0.55, 0.56, 0.58, 1), 0.9, 0.3),
    "glass":     ((0.05, 0.07, 0.08, 1), 0.0, 0.05),
    "lampWhite": ((0.95, 0.95, 0.92, 1), 0.0, 0.1),
    "lampRed":   ((0.7, 0.02, 0.02, 1), 0.0, 0.15),
    "lampAmber": ((0.95, 0.45, 0.02, 1), 0.0, 0.15),
    "lampDrl": ((1.0, 0.55, 0.08, 1), 0.0, 0.15),
    "lampBar": ((1.0, 0.70, 0.30, 1), 0.0, 0.15),
    "rubber":    ((0.025, 0.025, 0.027, 1), 0.0, 0.92),
    "gunmetal": ((0.2, 0.21, 0.22, 1), 0.8, 0.42),
    "gold": ((0.78, 0.62, 0.28, 1), 1.0, 0.35),
    "red": ((0.62, 0.04, 0.03, 1), 0.3, 0.4),
    "orange": ((0.95, 0.38, 0.03, 1), 0.0, 0.55),
    "yellow": ((0.92, 0.72, 0.05, 1), 0.0, 0.6),
    "chassis": ((0.045, 0.045, 0.048, 1), 0.1, 0.8),
    "interior":  ((0.06, 0.06, 0.065, 1), 0.0, 0.8),
}


def scene():
    sc = bpy.data.scenes.get(SCENE_NAME)
    if sc is None:
        sc = bpy.data.scenes.new(SCENE_NAME)
        sc.unit_settings.system = 'METRIC'
    coll = bpy.data.collections.get(COLL_NAME)
    if coll is None:
        coll = bpy.data.collections.new(COLL_NAME)
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    return sc, coll


def mat(key):
    name = "p6_" + key
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        col, metal, rough = MATS[key]
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = col
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough
        if key == "glass":
            b.inputs["Alpha"].default_value = 0.55
            m.blend_method = 'BLEND' if hasattr(m, "blend_method") else None
        if key.startswith("lamp"):
            b.inputs["Emission Color"].default_value = col
            b.inputs["Emission Strength"].default_value = 0.4
        if key == "paint":
            b.inputs["Coat Weight"].default_value = 0.8
            b.inputs["Coat Roughness"].default_value = 0.05
        m.diffuse_color = col
    return m


class Part:
    """A bmesh in game coordinates with named material slots."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.keys = []

    def mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def _tag(self, faces, key):
        i = self.mi(key)
        for f in faces:
            f.material_index = i
        return faces

    # ---------- primitives ----------
    def box(self, key, c, size, rot=(0, 0, 0)):
        """Box centred at c (game coords), full size (sx, sy, sz), rotated XYZ."""
        M = (Matrix.Translation(Vector(c))
             @ Matrix.Rotation(rot[1], 4, 'Y')
             @ Matrix.Rotation(rot[0], 4, 'X')
             @ Matrix.Rotation(rot[2], 4, 'Z')
             @ Matrix.Diagonal((size[0], size[1], size[2], 1)))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        faces = list({f for v in r["verts"] for f in v.link_faces})
        return self._tag(faces, key)

    def cyl(self, key, c, r1, r2, length, segs=16, axis='X', rot=None):
        """Cylinder/cone centred at c, along a game axis."""
        R = Matrix.Identity(4)
        # create_cone builds along local Z
        if axis == 'X':
            R = Matrix.Rotation(math.pi / 2, 4, 'Y')
        elif axis == 'Y':
            R = Matrix.Rotation(-math.pi / 2, 4, 'X')
        if rot is not None:
            R = rot @ R
        M = Matrix.Translation(Vector(c)) @ R
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False,
                                    segments=segs, radius1=r1, radius2=r2,
                                    depth=length, matrix=M)
        faces = list({f for v in res["verts"] for f in v.link_faces})
        return self._tag(faces, key)

    def prism(self, key, pts_zy, x0, x1):
        """Extrude a side profile (list of (z, y)) across x0..x1."""
        bm = self.bm
        a = [bm.verts.new((x0, y, z)) for z, y in pts_zy]
        b = [bm.verts.new((x1, y, z)) for z, y in pts_zy]
        faces = [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
        n = len(pts_zy)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        return self._tag(faces, key), a + b

    def front_profile_prism(self, key, pts_xy, z0, z1):
        """Extrude a cross-section (list of (x, y)) along z0..z1."""
        bm = self.bm
        a = [bm.verts.new((x, y, z0)) for x, y in pts_xy]
        b = [bm.verts.new((x, y, z1)) for x, y in pts_xy]
        faces = [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
        n = len(pts_xy)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        return self._tag(faces, key)

    def quad(self, key, p0, p1, p2, p3, outward_from=None):
        vs = [self.bm.verts.new(p) for p in (p0, p1, p2, p3)]
        return self._tag([self.bm.faces.new(vs)], key)

    def lathe(self, key, prof_rx, segs=48, closed=True, center=(0, 0, 0), axis='X'):
        """Revolve a profile of (radius, axial) around a game axis through center."""
        bm = self.bm
        cx, cy, cz = center
        rings = []
        for s in range(segs):
            a = 2 * math.pi * s / segs
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for r, x in prof_rx:
                if axis == 'X': p = (cx + x, cy + r * ca, cz + r * sa)
                elif axis == 'Z': p = (cx + r * ca, cy + r * sa, cz + x)
                else: p = (cx + r * ca, cy + x, cz + r * sa)
                ring.append(bm.verts.new(p))
            rings.append(ring)
        faces = []
        n = len(prof_rx)
        last = n if closed else n - 1
        for s in range(segs):
            A, B = rings[s], rings[(s + 1) % segs]
            for i in range(last):
                j = (i + 1) % n
                if not closed and j == 0:
                    continue
                faces.append(bm.faces.new((A[i], A[j], B[j], B[i])))
        return self._tag(faces, key)

    def strip(self, key, path_zy, x, width, depth):
        """A raised band (fender flare, trim strip) along a side path at
        plane x. Band spans `width` outward from the path, `depth` in x."""
        bm = self.bm
        sgn = 1 if x >= 0 else -1
        faces = []
        prev = None
        n = len(path_zy)
        for i, (z, y) in enumerate(path_zy):
            # outward normal of the path in the side plane
            z0, y0 = path_zy[max(0, i - 1)]
            z1, y1 = path_zy[min(n - 1, i + 1)]
            tz, ty = z1 - z0, y1 - y0
            l = math.hypot(tz, ty) or 1
            nz, ny = -ty / l, tz / l
            ring = [bm.verts.new((x, y, z)),
                    bm.verts.new((x + sgn * depth, y, z)),
                    bm.verts.new((x + sgn * depth, y + ny * width, z + nz * width)),
                    bm.verts.new((x, y + ny * width, z + nz * width))]
            if prev:
                for k in range(4):
                    kk = (k + 1) % 4
                    faces.append(bm.faces.new((prev[k], prev[kk], ring[kk], ring[k])))
            else:
                faces.append(bm.faces.new(list(reversed(ring))))
            prev = ring
        faces.append(bm.faces.new(prev))
        return self._tag(faces, key)

    # ---------- output ----------
    def finalize(self, coll, bevel=0.0, bevel_segs=2, smooth_angle=None):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        vfn = getattr(self, "vcol", None)
        if vfn is not None:
            bm.normal_update()
            lay = bm.verts.layers.float_color.new("Col")
            for v in bm.verts:
                r_, g_, b_ = vfn(v.co, v.normal); v[lay] = (r_, g_, b_, 1.0)
        bmesh.ops.transform(bm, matrix=G2B, verts=bm.verts)
        old = bpy.data.objects.get(self.name)
        if old is not None:
            bpy.data.objects.remove(old, do_unlink=True)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for k in self.keys:
            me.materials.append(mat(k))
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        if bevel > 0:
            m = ob.modifiers.new("bevel", 'BEVEL')
            m.width = bevel
            m.segments = bevel_segs
            m.limit_method = 'ANGLE'
            m.angle_limit = math.radians(32)
            m.harden_normals = False
            apply_modifiers(ob)
        me = ob.data          # apply_modifiers swaps the mesh datablock
        if smooth_angle is not None:
            for p in me.polygons:
                p.use_smooth = True
            try:
                me.set_sharp_from_angle(angle=math.radians(smooth_angle))
            except Exception:
                pass
        return ob


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    me.name = ob.name


def arch(cz, cy, r, y_cut, n=14, reverse=False):
    """Points of a wheel-arch opening (z, y) over a wheel at (cz, cy),
    from the rear intersection with y_cut to the front one."""
    dz = math.sqrt(max(r * r - (y_cut - cy) ** 2, 0))
    a0 = math.atan2(y_cut - cy, -dz)      # rear side
    a1 = math.atan2(y_cut - cy, dz)       # front side
    if a0 < a1:
        a0 += 2 * math.pi
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        pts.append((cz + r * math.cos(a), cy + r * math.sin(a)))
    return list(reversed(pts)) if reverse else pts


def add_instance(name, src, matrix):
    """A linked duplicate of an existing part (used for the bed spare)."""
    sc, coll = scene()
    ob = bpy.data.objects.get(name)
    if ob is not None: bpy.data.objects.remove(ob, do_unlink=True)
    ob = bpy.data.objects.new(name, bpy.data.objects[src].data)
    ob.matrix_world = G2B @ matrix @ G2B.inverted()
    coll.objects.link(ob)
    return ob



# ---------- surfacing primitives (mirror headless/p6lib.py) ----------
import numpy as np

def rounded_rect(x0, x1, y0, y1, rb, rt, nb=4, ns=5, nc=5, nt=6, crown=0.0):
    h = y1 - y0
    rt = min(rt, h * 0.45); rb = min(rb, h * 0.45)
    pts = []
    def seg(p, q, n):
        for k in range(n): pts.append((p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n))
    def corner(cx, cy, r, a0, a1, n):
        for k in range(n): a = a0 + (a1 - a0) * k / n; pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    seg((x0 + rb, y0), (x1 - rb, y0), nb)
    corner(x1 - rb, y0 + rb, rb, -math.pi / 2, 0, nc)
    seg((x1, y0 + rb), (x1, y1 - rt), ns)
    corner(x1 - rt, y1 - rt, rt, 0, math.pi / 2, nc)
    for k in range(nt):
        x = (x1 - rt) + ((x0 + rt) - (x1 - rt)) * k / nt
        xm = (x - (x0 + x1) / 2) / ((x1 - x0) / 2)
        pts.append((x, y1 + crown * (1 - xm * xm)))
    corner(x0 + rt, y1 - rt, rt, math.pi / 2, math.pi, nc)
    seg((x0, y1 - rt), (x0, y0 + rb), ns)
    corner(x0 + rb, y0 + rb, rb, math.pi, 1.5 * math.pi, nc)
    return pts


def _grid(self, rows, key, closed_u=True, cap_start=True, cap_end=True, key_fn=None):
    bm = self.bm
    ids = [[bm.verts.new(p) for p in row] for row in rows]
    nu = len(rows[0]); last_u = nu if closed_u else nu - 1
    for i in range(len(rows) - 1):
        A, B = ids[i], ids[i + 1]
        for j in range(last_u):
            jj = (j + 1) % nu
            q = [A[j], A[jj], B[jj], B[j]]
            k = key
            if key_fn is not None:
                P = np.array([v.co[:] for v in q]); c = P.mean(0)
                n = np.cross(P[1] - P[0], P[2] - P[0]) + np.cross(P[2] - P[0], P[3] - P[0])
                l = np.linalg.norm(n); k = key_fn(c, n / l if l > 0 else n)
            try:
                f = bm.faces.new(q); f.material_index = self.mi(k)
            except ValueError:
                pass
    if cap_start:
        self._tag([bm.faces.new(ids[0][::-1])], key)
    if cap_end:
        self._tag([bm.faces.new(ids[-1])], key)
    return ids

def _rbox(self, key, c, size, r=0.02, rot=(0, 0, 0)):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    r = min(r, hx * 0.9, hy * 0.9, hz * 0.9)
    M = (Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot[1], 4, 'Y')
         @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[2], 4, 'Z'))
    lines = lambda h: [-h, -(h - r), (h - r), h]
    cache = {}; faces = []
    def vert(q):
        k_ = tuple(round(v, 7) for v in q)
        if k_ in cache: return cache[k_]
        inner = np.clip(q, [-hx + r, -hy + r, -hz + r], [hx - r, hy - r, hz - r])
        d = q - inner; l = np.linalg.norm(d)
        p = inner + (d / l * r if l > 1e-9 else 0)
        v = self.bm.verts.new(M @ Vector(p)); cache[k_] = v
        return v
    H = (hx, hy, hz)
    for axis in range(3):
        for sign in (-1, 1):
            u, v = [a for a in range(3) if a != axis]
            U, V = lines(H[u]), lines(H[v])
            for a in range(3):
                for b in range(3):
                    quad = []
                    for (iu, iv) in ((a, b), (a + 1, b), (a + 1, b + 1), (a, b + 1)):
                        q = np.zeros(3); q[axis] = sign * H[axis]; q[u] = U[iu]; q[v] = V[iv]
                        quad.append(vert(q))
                    if sign < 0: quad = quad[::-1]
                    faces.append(self.bm.faces.new(quad))
    return self._tag(faces, key)

def _sweep(self, key, path_zy, x, width, depth):
    sgn = 1 if x >= 0 else -1
    prof = [(0.0, 0.0), (0.55, 0.0), (0.92, 0.12), (1.0, 0.40), (1.0, 0.70), (0.85, 0.95), (0.5, 1.0), (0.0, 1.0)]
    rows = []; n = len(path_zy)
    for i, (z, y) in enumerate(path_zy):
        z0, y0 = path_zy[max(0, i - 1)]; z1, y1 = path_zy[min(n - 1, i + 1)]
        tz, ty = z1 - z0, y1 - y0; l = math.hypot(tz, ty) or 1
        nz, ny = -ty / l, tz / l
        rows.append([(x + sgn * depth * o, y + ny * width * w, z + nz * width * w) for o, w in prof])
    return self.grid(rows, key)

def _set_vcol(self, fn): self.vcol = fn

Part.grid = _grid; Part.rbox = _rbox; Part.sweep = _sweep; Part.set_vcol = _set_vcol
MATS.setdefault("tint", ((0.02, 0.026, 0.03, 1), 0.0, 0.06))

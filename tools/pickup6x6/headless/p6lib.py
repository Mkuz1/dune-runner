# p6lib (headless) — the same modelling API as ../p6lib.py, but instead of
# building Blender meshes it collects polygons and writes a glTF 2.0 binary.
#
# Authoring space is GAME space (+Y up, +Z forward), which is also glTF's
# space, so no axis conversion is needed on the way out.

import json, math, struct
import numpy as np
from mathutils import Matrix, Vector

# key -> (base colour sRGB 0..1, metallic, roughness, extra)
MATS = {
    "paint":     ((0.910, 0.925, 0.933), 0.05, 0.28, {"coat": 1.0}),  # #E8ECEE
    "trim":      ((0.102, 0.110, 0.118), 0.0, 0.68, {}),              # #1A1C1E
    "metal":     ((0.067, 0.071, 0.075), 0.2, 0.55, {}),              # #111213 crinkle coat
    "chassis":   ((0.045, 0.045, 0.048), 0.1, 0.8, {}),
    "grille":    ((0.03, 0.032, 0.035), 0.2, 0.5, {}),
    "chrome":    ((0.82, 0.82, 0.84), 1.0, 0.14, {}),
    "silver":    ((0.62, 0.63, 0.65), 0.9, 0.3, {}),
    "gunmetal":  ((0.20, 0.21, 0.22), 0.8, 0.42, {}),
    "gold":      ((0.78, 0.62, 0.28), 1.0, 0.35, {}),
    "red":       ((0.62, 0.04, 0.03), 0.3, 0.4, {}),
    "orange":    ((0.95, 0.38, 0.03), 0.0, 0.55, {}),
    "yellow":    ((0.92, 0.72, 0.05), 0.0, 0.6, {}),
    "glass":     ((0.05, 0.07, 0.08), 0.0, 0.05, {"alpha": 0.55}),
    "lampWhite": ((0.95, 0.95, 0.92), 0.0, 0.1, {"emit": 0.3}),
    "lampRed":   ((0.70, 0.02, 0.02), 0.0, 0.15, {"emit": 0.3}),
    "lampAmber": ((0.95, 0.45, 0.02), 0.0, 0.15, {"emit": 0.3}),
    "rubber":    ((0.141, 0.145, 0.149), 0.0, 0.84, {}),              # #242526
    "tint":      ((0.020, 0.026, 0.030), 0.0, 0.06, {}),              # opaque tinted glazing
    "interior":  ((0.06, 0.06, 0.065), 0.0, 0.8, {}),
}

PARTS = []          # finalized parts, in order
EXTRA_NODES = []    # (name, mesh_part_name, matrix) — instances such as the spare


def scene():
    return None, None


class _V:
    __slots__ = ("co",)
    def __init__(self, p): self.co = Vector(p)


class Part:
    def __init__(self, name):
        self.name = name
        self.verts = []       # list of _V
        self.faces = []       # list of (index list, key)
        self.keys = []

    def mi(self, key):
        if key not in self.keys: self.keys.append(key)
        return self.keys.index(key)

    # ---- bookkeeping ----
    def _v(self, p):
        self.verts.append(_V(p)); return len(self.verts) - 1

    def _begin(self): return len(self.faces)

    def _end_closed(self, start):
        """Make a closed primitive face outward: flip it if its signed volume
        is negative (the builders below are consistent within a primitive)."""
        vol = 0.0
        for idx, _ in self.faces[start:]:
            p0 = self.verts[idx[0]].co.v
            for k in range(1, len(idx) - 1):
                vol += np.dot(p0, np.cross(self.verts[idx[k]].co.v, self.verts[idx[k + 1]].co.v))
        if vol < 0:
            for i in range(start, len(self.faces)):
                idx, key = self.faces[i]
                self.faces[i] = (idx[::-1], key)
        return self.faces[start:]

    def _face(self, idx, key):
        self.mi(key); self.faces.append((list(idx), key))

    # ---- primitives (game coords) ----
    def box(self, key, c, size, rot=(0, 0, 0)):
        M = (Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot[1], 4, 'Y')
             @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[2], 4, 'Z')
             @ Matrix.Diagonal((size[0], size[1], size[2], 1)))
        s = self._begin()
        ids = [self._v(M @ Vector((x * 0.5, y * 0.5, z * 0.5)))
               for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        # index = 4*ix + 2*iy + iz
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            self._face([ids[i] for i in f], key)
        return self._end_closed(s)

    def cyl(self, key, c, r1, r2, length, segs=16, axis='X', rot=None):
        R = Matrix.Identity(4)
        if axis == 'X': R = Matrix.Rotation(math.pi / 2, 4, 'Y')
        elif axis == 'Y': R = Matrix.Rotation(-math.pi / 2, 4, 'X')
        if rot is not None: R = rot @ R
        M = Matrix.Translation(Vector(c)) @ R
        s = self._begin()
        bot = [self._v(M @ Vector((r1 * math.cos(2 * math.pi * i / segs), r1 * math.sin(2 * math.pi * i / segs), -length / 2))) for i in range(segs)]
        top = [self._v(M @ Vector((r2 * math.cos(2 * math.pi * i / segs), r2 * math.sin(2 * math.pi * i / segs), length / 2))) for i in range(segs)]
        for i in range(segs):
            j = (i + 1) % segs
            self._face([bot[i], bot[j], top[j], top[i]], key)
        self._face(top, key); self._face(bot[::-1], key)
        return self._end_closed(s)

    def prism(self, key, pts_zy, x0, x1):
        s = self._begin()
        a = [self._v((x0, y, z)) for z, y in pts_zy]
        b = [self._v((x1, y, z)) for z, y in pts_zy]
        # caps wound opposite to the side quads they share edges with, so the
        # whole primitive is consistent and the volume test can orient it
        self._face(a[::-1], key); self._face(b, key)
        n = len(pts_zy)
        for i in range(n):
            j = (i + 1) % n
            self._face([a[i], a[j], b[j], b[i]], key)
        return self._end_closed(s), [self.verts[i] for i in a + b]

    def quad(self, key, p0, p1, p2, p3, outward_from=(0.0, 1.3, -0.4)):
        ids = [self._v(p) for p in (p0, p1, p2, p3)]
        P = [self.verts[i].co.v for i in ids]
        n = np.cross(P[1] - P[0], P[2] - P[0])
        if np.dot(n, np.mean(P, axis=0) - np.array(outward_from)) < 0:
            ids = ids[::-1]
        self._face(ids, key)
        return self.faces[-1:]

    def lathe(self, key, prof_rx, segs=48, closed=True, center=(0, 0, 0), axis='X'):
        """Revolve (radius, axial) around an axis through `center`."""
        cx, cy, cz = center
        s = self._begin()
        rings = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for r, x in prof_rx:
                if axis == 'X': p = (cx + x, cy + r * ca, cz + r * sa)
                elif axis == 'Z': p = (cx + r * ca, cy + r * sa, cz + x)
                else: p = (cx + r * ca, cy + x, cz + r * sa)
                ring.append(self._v(p))
            rings.append(ring)
        n = len(prof_rx)
        for k in range(segs):
            A, B = rings[k], rings[(k + 1) % segs]
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                self._face([A[i], A[j], B[j], B[i]], key)
        return self._end_closed(s)

    def strip(self, key, path_zy, x, width, depth):
        sgn = 1 if x >= 0 else -1
        s = self._begin()
        prev = None
        n = len(path_zy)
        for i, (z, y) in enumerate(path_zy):
            z0, y0 = path_zy[max(0, i - 1)]; z1, y1 = path_zy[min(n - 1, i + 1)]
            tz, ty = z1 - z0, y1 - y0; l = math.hypot(tz, ty) or 1
            nz, ny = -ty / l, tz / l
            ring = [self._v((x, y, z)), self._v((x + sgn * depth, y, z)),
                    self._v((x + sgn * depth, y + ny * width, z + nz * width)),
                    self._v((x, y + ny * width, z + nz * width))]
            if prev:
                for k in range(4):
                    kk = (k + 1) % 4
                    self._face([prev[k], prev[kk], ring[kk], ring[k]], key)
            else:
                self._face(ring[::-1], key)
            prev = ring
        self._face(prev, key)
        return self._end_closed(s)

    def finalize(self, coll=None, bevel=0.0, bevel_segs=2, smooth_angle=None):
        self.smooth = smooth_angle
        PARTS.append(self)
        return self


def arch(cz, cy, r, y_cut, n=14, reverse=False):
    dz = math.sqrt(max(r * r - (y_cut - cy) ** 2, 0))
    a0 = math.atan2(y_cut - cy, -dz); a1 = math.atan2(y_cut - cy, dz)
    if a0 < a1: a0 += 2 * math.pi
    pts = [(cz + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    return list(reversed(pts)) if reverse else pts


# =================== triangulation, normals, GLB ===================

def _earclip(P):
    """Triangulate a planar polygon (possibly concave). Returns index triples.

    Points lying *on* a candidate ear's edge must not veto it: profiles here
    have long collinear runs (sills, roof lines), and a strict "on the edge
    counts as inside" test blocks every ear and degrades to a fan, which is
    wrong for a concave shape and was dropping the cab's side panels."""
    n = len(P)
    if n == 3: return [(0, 1, 2)]
    nrm = np.zeros(3)
    for i in range(n):
        nrm += np.cross(P[i], P[(i + 1) % n])
    if np.linalg.norm(nrm) < 1e-12: return [(0, i, i + 1) for i in range(1, n - 1)]
    nrm /= np.linalg.norm(nrm)
    u = np.cross(nrm, [1, 0, 0] if abs(nrm[0]) < 0.9 else [0, 1, 0]); u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    Q = [(float(np.dot(p, u)), float(np.dot(p, v))) for p in P]
    def cr(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    EPS = 1e-10
    # drop exactly-collinear / duplicate vertices up front
    idx = list(range(n))
    changed = True
    while changed and len(idx) > 3:
        changed = False
        for k in range(len(idx)):
            m = len(idx); a0, a1, a2 = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            if abs(cr(Q[a0], Q[a1], Q[a2])) < EPS and (Q[a1][0] - Q[a0][0]) * (Q[a2][0] - Q[a1][0]) + (Q[a1][1] - Q[a0][1]) * (Q[a2][1] - Q[a1][1]) >= 0:
                idx.pop(k); changed = True; break
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 20000:
        guard += 1
        m = len(idx); best = None
        for k in range(m):
            i0, i1, i2 = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            area = cr(Q[i0], Q[i1], Q[i2])
            if area <= EPS: continue                      # reflex or degenerate
            ok = True
            for j in idx:
                if j in (i0, i1, i2): continue
                p = Q[j]
                if p == Q[i0] or p == Q[i1] or p == Q[i2]: continue
                if cr(Q[i0], Q[i1], p) > EPS and cr(Q[i1], Q[i2], p) > EPS and cr(Q[i2], Q[i0], p) > EPS:
                    ok = False; break                     # strictly inside only
            if ok:
                best = k; break
        if best is None:
            raise RuntimeError("ear clipping failed on a %d-gon" % n)
        m = len(idx)
        tris.append((idx[(best - 1) % m], idx[best], idx[(best + 1) % m])); idx.pop(best)
    tris.append(tuple(idx))
    return tris


def _part_triangles(part):
    V = np.array([v.co.v for v in part.verts])
    fn = []; tris_by_face = []
    for idx, key in part.faces:
        P = [V[i] for i in idx]
        n = np.zeros(3)
        for i in range(len(P)):
            n += np.cross(P[i], P[(i + 1) % len(P)])
        l = np.linalg.norm(n); fn.append(n / l if l > 0 else np.array([0, 1.0, 0]))
        tris_by_face.append([(idx[a], idx[b], idx[c]) for a, b, c in _earclip(P)])
    return V, fn, tris_by_face


def _part_geometry(part):
    """Per-material (positions, normals, indices) with angle-limited smoothing."""
    V, fn, tris_by_face = _part_triangles(part)
    cos_t = math.cos(math.radians(part.smooth)) if part.smooth is not None else 2.0
    adj = {}
    for f, (idx, _) in enumerate(part.faces):
        for i in idx: adj.setdefault(i, []).append(f)
    out = {}
    for f, (idx, key) in enumerate(part.faces):
        g = out.setdefault(key, {"pos": [], "nrm": [], "ind": [], "map": {}})
        for tri in tris_by_face[f]:
            for vi in tri:
                n = fn[f]
                if cos_t <= 1.0:
                    acc = np.zeros(3)
                    for g2 in adj[vi]:
                        if np.dot(fn[g2], fn[f]) >= cos_t: acc += fn[g2]
                    if np.linalg.norm(acc) > 0: n = acc / np.linalg.norm(acc)
                k = (vi, round(n[0], 3), round(n[1], 3), round(n[2], 3))
                if k not in g["map"]:
                    g["map"][k] = len(g["pos"]); g["pos"].append(V[vi]); g["nrm"].append(n)
                    vfn = getattr(part, "vcol", None)
                    g.setdefault("col", []).append(vfn(V[vi], n) if vfn else (1.0, 1.0, 1.0))
                g["ind"].append(g["map"][k])
    return out


def _srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def write_glb(path):
    js = {"asset": {"version": "2.0", "generator": "dune-runner p6 headless"},
          "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
          "materials": [], "accessors": [], "bufferViews": [], "buffers": []}
    blob = bytearray(); mat_index = {}; stats = {}
    def add_view(data, target):
        while len(blob) % 4: blob.append(0)
        off = len(blob); blob.extend(data)
        js["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target})
        return len(js["bufferViews"]) - 1
    def material(key):
        if key in mat_index: return mat_index[key]
        col, metal, rough, ex = MATS[key]
        m = {"name": key, "pbrMetallicRoughness": {
            "baseColorFactor": [_srgb_to_lin(c) for c in col] + [ex.get("alpha", 1.0)],
            "metallicFactor": metal, "roughnessFactor": rough}}
        if "alpha" in ex: m["alphaMode"] = "BLEND"; m["doubleSided"] = True
        if "emit" in ex: m["emissiveFactor"] = [_srgb_to_lin(c) * ex["emit"] for c in col]
        js["materials"].append(m); mat_index[key] = len(js["materials"]) - 1
        return mat_index[key]
    mesh_of = {}
    for part in PARTS:
        geo = _part_geometry(part); prims = []; tris = 0
        for key, g in geo.items():
            pos = np.array(g["pos"], dtype=np.float32); nrm = np.array(g["nrm"], dtype=np.float32)
            ind = np.array(g["ind"], dtype=np.uint32 if len(pos) > 65535 else np.uint16)
            col = np.array(g["col"], dtype=np.float32)
            bp = add_view(pos.tobytes(), 34962); bn = add_view(nrm.tobytes(), 34962); bi = add_view(ind.tobytes(), 34963)
            bc = add_view(col.tobytes(), 34962)
            js["accessors"] += [
                {"bufferView": bp, "componentType": 5126, "count": len(pos), "type": "VEC3",
                 "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
                {"bufferView": bn, "componentType": 5126, "count": len(nrm), "type": "VEC3"},
                {"bufferView": bi, "componentType": 5125 if ind.dtype == np.uint32 else 5123, "count": len(ind), "type": "SCALAR"}]
            a = len(js["accessors"])
            js["accessors"].append({"bufferView": bc, "componentType": 5126, "count": len(col), "type": "VEC3"})
            prims.append({"attributes": {"POSITION": a - 3, "NORMAL": a - 2, "COLOR_0": a}, "indices": a - 1, "material": material(key)})
            tris += len(ind) // 3
        js["meshes"].append({"name": part.name, "primitives": prims})
        mesh_of[part.name] = len(js["meshes"]) - 1
        js["nodes"].append({"name": part.name, "mesh": mesh_of[part.name]})
        js["scenes"][0]["nodes"].append(len(js["nodes"]) - 1)
        stats[part.name] = tris
    for name, src, M in EXTRA_NODES:
        js["nodes"].append({"name": name, "mesh": mesh_of[src], "matrix": np.array(M.m).T.flatten().tolist()})
        js["scenes"][0]["nodes"].append(len(js["nodes"]) - 1)
        stats[name] = "instance of " + src
    while len(blob) % 4: blob.append(0)
    js["buffers"].append({"byteLength": len(blob)})
    jb = json.dumps(js, separators=(",", ":")).encode()
    while len(jb) % 4: jb += b" "
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob)))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
    return stats


def add_instance(name, src, matrix):
    """Another node sharing an existing part's mesh (used for the spare)."""
    EXTRA_NODES.append((name, src, matrix))


# =================== surfacing primitives (realism pass) ===================

def _grid_faces(self, rows, key, closed_u=True, cap_start=True, cap_end=True, key_fn=None):
    """Skin a list of stations (each a list of points, same length).
    key_fn(centre, normal) -> material key lets one surface carry several
    materials (glass areas on a cabin, for instance)."""
    s = self._begin()
    ids = [[self._v(p) for p in row] for row in rows]
    nu = len(rows[0])
    last_u = nu if closed_u else nu - 1
    def k_of(idx):
        if key_fn is None: return key
        P = np.array([self.verts[i].co.v for i in idx])
        c = P.mean(0)
        n = np.cross(P[1] - P[0], P[2] - P[0]) + np.cross(P[2] - P[0], P[3] - P[0] if len(P) > 3 else P[2] - P[1])
        l = np.linalg.norm(n)
        return key_fn(c, n / l if l > 0 else n)
    for i in range(len(rows) - 1):
        A, B = ids[i], ids[i + 1]
        for j in range(last_u):
            jj = (j + 1) % nu
            f = [A[j], A[jj], B[jj], B[j]]
            self._face(f, k_of(f))
    if cap_start: self._face(ids[0][::-1], key)
    if cap_end: self._face(ids[-1], key)
    if closed_u and cap_start and cap_end:
        self._end_closed(s)
    return ids

Part.grid = _grid_faces


def rounded_rect(x0, x1, y0, y1, rb, rt, nb=4, ns=5, nc=5, nt=6, crown=0.0):
    """Closed cross-section (x, y): rectangle with bottom corner radius rb and
    top corner radius rt, CCW starting at bottom-left. Fixed point counts so
    every station of a loft has identical topology."""
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
    for k in range(nt):                       # crowned top, right to left
        x = (x1 - rt) + ((x0 + rt) - (x1 - rt)) * k / nt
        xm = (x - (x0 + x1) / 2) / ((x1 - x0) / 2)
        pts.append((x, y1 + crown * (1 - xm * xm)))
    corner(x0 + rt, y1 - rt, rt, math.pi / 2, math.pi, nc)
    seg((x0, y1 - rt), (x0, y0 + rb), ns)
    corner(x0 + rb, y0 + rb, rb, math.pi, 1.5 * math.pi, nc)
    return pts


def _rbox(self, key, c, size, r=0.02, rot=(0, 0, 0)):
    """Box with softened edges: a cube lattice whose edge vertices are pulled
    onto radius r. Reads as rounded once normals are smoothed, at ~108 tris."""
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    r = min(r, hx * 0.9, hy * 0.9, hz * 0.9)
    M = (Matrix.Translation(Vector(c)) @ Matrix.Rotation(rot[1], 4, 'Y')
         @ Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[2], 4, 'Z'))
    lines = lambda h: [-h, -(h - r), (h - r), h]
    s = self._begin()
    cache = {}
    def vert(q):
        key_ = tuple(round(v, 7) for v in q)
        if key_ in cache: return cache[key_]
        inner = np.clip(q, [-hx + r, -hy + r, -hz + r], [hx - r, hy - r, hz - r])
        d = q - inner; l = np.linalg.norm(d)
        p = inner + (d / l * r if l > 1e-9 else 0)
        i = self._v(M @ Vector(p)); cache[key_] = i
        return i
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
                    self._face(quad, key)
    return self._end_closed(s)

Part.rbox = _rbox


def _sweep(self, key, path_zy, x, width, depth, segs_cap=True):
    """A flare or trim moulding along a side path at plane x, with a rounded
    (half-round shouldered) section instead of a sharp rectangle."""
    sgn = 1 if x >= 0 else -1
    prof = [(0.0, 0.0), (0.55, 0.0), (0.92, 0.12), (1.0, 0.40), (1.0, 0.70), (0.85, 0.95), (0.5, 1.0), (0.0, 1.0)]
    rows = []
    n = len(path_zy)
    for i, (z, y) in enumerate(path_zy):
        z0, y0 = path_zy[max(0, i - 1)]; z1, y1 = path_zy[min(n - 1, i + 1)]
        tz, ty = z1 - z0, y1 - y0; l = math.hypot(tz, ty) or 1
        nz, ny = -ty / l, tz / l
        rows.append([(x + sgn * depth * o, y + ny * width * w, z + nz * width * w) for o, w in prof])
    return self.grid(rows, key, closed_u=True, cap_start=True, cap_end=True)

Part.sweep = _sweep


# per-part vertex colour: fn(position, normal) -> (r, g, b) multiplier
def _set_vcol(self, fn): self.vcol = fn
Part.set_vcol = _set_vcol

# Minimal stand-in for Blender's mathutils, covering exactly what the p6 build
# scripts use, so they run outside Blender. Conventions match Blender:
# right-handed rotations, Matrix @ Vector(3) transforms a point (w = 1).
import math
import numpy as np


class Vector:
    __slots__ = ("v",)

    def __init__(self, seq=(0.0, 0.0, 0.0)):
        self.v = np.array(list(seq), dtype=float)

    x = property(lambda s: s.v[0], lambda s, a: s.v.__setitem__(0, a))
    y = property(lambda s: s.v[1], lambda s, a: s.v.__setitem__(1, a))
    z = property(lambda s: s.v[2], lambda s, a: s.v.__setitem__(2, a))

    def __iter__(self): return iter(self.v.tolist())
    def __len__(self): return len(self.v)
    def __getitem__(self, i): return float(self.v[i])
    def __setitem__(self, i, a): self.v[i] = a
    def __add__(self, o): return Vector(self.v + _a(o))
    def __sub__(self, o): return Vector(self.v - _a(o))
    def __mul__(self, k): return Vector(self.v * k)
    __rmul__ = __mul__
    def __truediv__(self, k): return Vector(self.v / k)
    def __neg__(self): return Vector(-self.v)
    def __repr__(self): return "Vector(%s)" % (tuple(round(c, 4) for c in self.v),)

    @property
    def length(self): return float(np.linalg.norm(self.v))

    def normalized(self):
        l = self.length
        return Vector(self.v / l) if l > 0 else Vector(self.v)

    def dot(self, o): return float(np.dot(self.v, _a(o)))
    def cross(self, o): return Vector(np.cross(self.v, _a(o)))
    def lerp(self, o, t): return Vector(self.v + (_a(o) - self.v) * t)

    def rotation_difference(self, o):
        a, b = self.normalized().v, Vector(o).normalized().v
        axis = np.cross(a, b)
        s, c = np.linalg.norm(axis), float(np.clip(np.dot(a, b), -1, 1))
        if s < 1e-9:
            if c > 0:
                return _Rot(np.eye(3))
            # 180°: any axis perpendicular to a
            p = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
            axis = np.cross(a, p); axis /= np.linalg.norm(axis)
            return _Rot(_axis_angle(axis, math.pi))
        return _Rot(_axis_angle(axis / s, math.atan2(s, c)))


def _a(o): return o.v if isinstance(o, Vector) else np.array(list(o), dtype=float)


def _axis_angle(k, ang):
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


class _Rot:
    def __init__(self, m3): self.m3 = m3
    def to_matrix(self): return self
    def to_4x4(self):
        m = np.eye(4); m[:3, :3] = self.m3
        return Matrix(m)


class Matrix:
    def __init__(self, rows=None):
        self.m = np.eye(4) if rows is None else np.array([list(r) for r in rows], dtype=float)

    def __matmul__(self, o):
        if isinstance(o, Matrix):
            return Matrix(self.m @ o.m)
        p = _a(o)
        if len(p) == 3:
            return Vector((self.m @ np.append(p, 1.0))[:3])
        return Vector(self.m @ p)

    @staticmethod
    def Identity(n=4): return Matrix(np.eye(4))

    @staticmethod
    def Translation(t):
        m = np.eye(4); m[:3, 3] = list(t)[:3]
        return Matrix(m)

    @staticmethod
    def Diagonal(d):
        d = list(d) + [1.0] * (4 - len(d))
        return Matrix(np.diag(d[:4]))

    @staticmethod
    def Rotation(ang, n, axis):
        c, s = math.cos(ang), math.sin(ang)
        r = {"X": [[1, 0, 0], [0, c, -s], [0, s, c]],
             "Y": [[c, 0, s], [0, 1, 0], [-s, 0, c]],
             "Z": [[c, -s, 0], [s, c, 0], [0, 0, 1]]}[axis]
        m = np.eye(4); m[:3, :3] = r
        return Matrix(m)

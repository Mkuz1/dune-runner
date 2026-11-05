# gen_glb.py — build the pickup headlessly and write the GLB.
#   python3 -I gen_glb.py <out.glb>
import os, sys, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)                       # headless p6lib + mathutils shim
import p6lib
t = time.time()
ns = {"__name__": "p6"}
exec(open(os.path.join(HERE, "..", "p6_geom.py")).read(), ns)
out = sys.argv[1]
stats = p6lib.write_glb(out)
print(json.dumps({"stats": stats, "axles": ns["AXLES"], "bytes": os.path.getsize(out), "secs": round(time.time() - t, 1)}, indent=1))

"""Segment labels for the NSITC L5 blue-line layout. A segment = panels joined by normal 20 mm joints; a gap > 2 ft starts a new segment."""
import json, math, re, sys, collections
from shapely.geometry import Polygon
from shapely.ops import unary_union
LSP = sys.argv[1]; OUT = sys.argv[2]
W, L = 3.93701, 7.30643; WP = 620; TH = 2.0
mods = []; cur = []; zlab = {}
for line in open(LSP):
    m = re.match(r'\s*\(pvI ([-\d.]+) ([-\d.]+) ([-\d.]+)\)', line)
    if m: cur.append(tuple(map(float, m.groups()))); continue
    m = re.search(r'\(pvT "PV-TEXT" "([^:]+):[^"]*" \(list ([-\d.]+) ([-\d.]+)\)', line)
    if m:
        mods += [(m.group(1),) + c for c in cur]; cur = []; zlab[m.group(1)] = (float(m.group(2)), float(m.group(3)))
assert not cur and len(mods) == 6915
def poly(x, y, r):
    c, s = math.cos(r), math.sin(r)
    return Polygon([(x + u*c - v*s, y + u*s + v*c) for u, v in [(0,0),(W,0),(W,L),(0,L)]])
P = [poly(*m[1:]) for m in mods]
# split where consecutive tables (5 inserts each, in run order) are more than TH apart
tables = [list(range(i, i + 5)) for i in range(0, len(mods), 5)]
assert all(len({mods[i][0] for i in t}) == 1 and len({round(mods[i][3], 6) for i in t}) == 1 for t in tables)
TP = [unary_union([P[i] for i in t]) for t in tables]
segs = [[0]]
for k in range(1, len(tables)):
    if mods[tables[k][0]][0] != mods[tables[k-1][0]][0] or TP[k].distance(TP[k-1]) > TH: segs.append([k])
    else: segs[-1].append(k)
# cross-check with a full proximity clustering (order independent)
from shapely.strtree import STRtree
T = STRtree(TP); par = list(range(len(TP)))
def f(a):
    while par[a] != a: par[a] = par[par[a]]; a = par[a]
    return a
for i, p in enumerate(TP):
    for j in T.query(p.buffer(TH)):
        if p.distance(TP[j]) <= TH: par[f(i)] = f(j)
assert sorted(len(s) for s in segs) == sorted(collections.Counter(f(i) for i in range(len(TP))).values()), 'run order != clustering'
# number the segments continuously round the site: inside a zone, start with the part nearest the previous segment
order = []
for s_ in segs:
    if order and mods[tables[order[-1][-1][0]][0]][0] == mods[tables[s_[0]][0]][0]: order[-1].append(s_)
    else: order.append([s_])
segs = []
for grp in order:
    if segs and len(grp) > 1:
        last = unary_union([TP[k] for k in segs[-1]])
        if last.distance(unary_union([TP[k] for k in grp[-1]])) < last.distance(unary_union([TP[k] for k in grp[0]])): grp = grp[::-1]
    segs += grp
zfull = {}
for line in open(LSP):
    m = re.search(r'\(pvT "PV-TEXT" "([^"]+)" \(list ([-\d.]+) ([-\d.]+)\) ([-\d.]+)\)', line)
    if m: zfull[m.group(1)] = tuple(map(float, m.groups()[1:]))
def zbox(t, x, y, r, h=8.0):
    w = len(t) * 0.95 * h / 2; hh = 0.75 * h; ca, sa = math.cos(r), math.sin(r)
    return Polygon([(x + u * ca - v * sa, y + u * sa + v * ca) for u, v in ((-w, -hh), (w, -hh), (w, hh), (-w, hh))])
OBST = unary_union([p.buffer(5.0) for p in TP] + [zbox(t, *v) for t, v in zfull.items()])
zparts = collections.Counter(mods[tables[s[0]][0]][0] for s in segs); zseen = collections.Counter()
out = []
for n, s in enumerate(segs, 1):
    z = mods[tables[s[0]][0]][0]; zseen[z] += 1
    nm = len(s) * 5
    cen = [TP[k].centroid for k in s]
    length = sum(cen[i].distance(cen[i+1]) for i in range(len(cen) - 1)) + L
    k = s[len(s) // 2]; c = cen[len(s) // 2]; r = mods[tables[k][0]][3]
    ux, uy = -math.sin(r), math.cos(r)          # block +Y (module long side) = along the run
    nx, ny = math.cos(r), math.sin(r)           # across the run
    ang = math.atan2(uy, ux); ang = (ang + math.pi / 2) % math.pi - math.pi / 2
    up = (-math.sin(ang), math.cos(ang))
    part = f' ({zseen[z]} OF {zparts[z]})' if zparts[z] > 1 else ''
    l1 = f'SEG {n:02d} - {z}{part}'; l2 = f'{nm} MODULES = {len(s)} TABLES = {nm * WP / 1000:.1f} kWp'
    def tbox(t, p, h):                          # generous TEXT footprint (txt.shx ~ 0.9 h per character)
        w = len(t) * 0.95 * h / 2; hh = 0.75 * h; ca, sa = math.cos(ang), math.sin(ang)
        return Polygon([(p[0] + u * ca - v * sa, p[1] + u * sa + v * ca) for u, v in ((-w, -hh), (w, -hh), (w, hh), (-w, hh))])
    zx, zy = zlab[z]
    pref = -1 if (zx - c.x) * nx + (zy - c.y) * ny > 0 else 1    # opposite side from the zone label first
    choice = None
    for extra in (0, 6, 12, 20, 30, 45):
        for sgn in (pref, -pref):
            mx, my = sgn * nx, sgn * ny; down = (up[0] * mx + up[1] * my) < 0
            dn, df = 9.97 + 9.0 + extra, 9.97 + 18.5 + extra
            d1, d2 = (dn, df) if down else (df, dn)           # line 1 (segment no.) always reads above line 2
            p1 = (c.x + mx * d1, c.y + my * d1); p2 = (c.x + mx * d2, c.y + my * d2)
            boxes = unary_union([tbox(l1, p1, 7.0), tbox(l2, p2, 5.5)])
            if not boxes.intersects(OBST): choice = (p1, p2); print("   label", n, "side", sgn == pref, "extra", extra); break
        if choice: break
    assert choice, n
    p1, p2 = choice
    ol = unary_union([TP[k].buffer(1.5, join_style=2) for k in s]).buffer(-0.5, join_style=2).simplify(0.1)
    assert ol.geom_type == 'Polygon', (n, ol.geom_type)
    out.append(dict(n=n, zone=z, part=part.strip(), modules=nm, tables=len(s), kwp=nm * WP / 1000, length=length,
                    l1=l1, l2=l2, p1=p1, p2=p2, ang=ang, outline=list(ol.exterior.coords)[:-1], centre=(c.x, c.y)))
SU = [unary_union([TP[k] for k in s_]) for s_ in segs]
for i in range(len(segs) - 1): out[i]['gap_after'] = SU[i].distance(SU[i + 1])
json.dump(out, open(OUT, 'w'), indent=0)
for o in out: print(o['n'], o['l1'], '|', o['l2'], f"| ~{o['length']:.0f} ft", '| gap to next', o.get('gap_after') and round(o['gap_after'], 1), '| outline pts', len(o['outline']))
print('TOTAL', sum(o['modules'] for o in out))

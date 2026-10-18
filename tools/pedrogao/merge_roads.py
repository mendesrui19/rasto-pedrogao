"""Merge OSM road segments (data/pedrogao/osm.json) into continuous routes by reference (EN/IC/EM), >1.5 km."""
import json, math, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'data/pedrogao/osm.json'
d = json.load(open(p))
groups = {}
for r in d['roads']:
    if r['r'] > 3 and not r['ref'].startswith('EN'): continue
    if not r['ref']: continue
    groups.setdefault(r['ref'], []).append([tuple(q) for q in r['p']])
def chain(segs):
    segs = [s[:] for s in segs]; out = []
    while segs:
        cur = segs.pop(0); changed = True
        while changed:
            changed = False
            for i, s in enumerate(segs):
                for a, b, rev in [(cur[-1], s[0], False), (cur[-1], s[-1], True), (cur[0], s[-1], False), (cur[0], s[0], True)]:
                    if math.dist(a, b) < 25:
                        s2 = s[::-1] if rev else s
                        cur = cur + s2[1:] if a is cur[-1] else s2[:-1] + cur
                        segs.pop(i); changed = True; break
                if changed: break
        out.append(cur)
    return out
main = []
for ref, segs in groups.items():
    for c in chain(segs):
        L = sum(math.dist(c[i], c[i + 1]) for i in range(len(c) - 1))
        if L >= 1500: main.append({'ref': ref, 'len': round(L), 'p': [list(q) for q in c]})
d['main'] = sorted(main, key=lambda r: -r['len'])
json.dump(d, open(p, 'w'), separators=(',', ':'))
print(len(main), 'routes')

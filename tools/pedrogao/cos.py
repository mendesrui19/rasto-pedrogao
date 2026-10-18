"""Download DGT COS2018 (level 1) polygons for the domain and rasterize them into data/pedrogao/fuel.u8 + cos.u8.
fuel: 0 agriculture/pasture, 1 shrubland (matos), 2 forest, 3 water / bare / artificial."""
import json, os, sys
import numpy as np, requests
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin

OUT = sys.argv[1]
meta = json.load(open(os.path.join(OUT, 'meta.json')))
LAT0, LON0, HALF, FN = meta['lat0'], meta['lon0'], meta['half'], meta['fn']
fwd = Transformer.from_crs('EPSG:4326', f'+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m', always_xy=True)
URL = 'https://infogeo.dgterritorio.gov.pt/arcgis/rest/services/Hosted/Carta_de_Uso_e_Ocupa%C3%A7%C3%A3o_do_Solo___2018/FeatureServer/0/query'
feats, off = [], 0
while True:
    p = {'f': 'json', 'where': '1=1', 'geometry': '-8.46,39.73,-7.88,40.18', 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'outSR': 4326,
         'spatialRel': 'esriSpatialRelIntersects', 'outFields': 'cos18n1_c', 'resultOffset': off, 'resultRecordCount': 1000, 'maxAllowableOffset': 0.0002, 'geometryPrecision': 6}
    d = requests.get(URL, params=p, timeout=300).json()
    fs = d.get('features', []); feats += fs; off += len(fs)
    print('got', off)
    if not fs or not d.get('exceededTransferLimit'): break
CLS2FUEL = {1: 3, 2: 0, 3: 0, 4: 1, 5: 2, 6: 1, 7: 3, 8: 3, 9: 3}
def shapes(n):
    res = 2 * HALF / n
    for f in feats:
        c = int(f['attributes']['cos18n1_c'])
        rings = []
        for ring in f['geometry'].get('rings', []):
            xs, ys = fwd.transform([q[0] for q in ring], [q[1] for q in ring])
            rings.append([(x, y) for x, y in zip(xs, ys)])
        if rings: yield {'type': 'Polygon', 'coordinates': rings}, c
tr = from_origin(-HALF, HALF, 2 * HALF / FN, 2 * HALF / FN)
cos = rasterize(shapes(FN), out_shape=(FN, FN), transform=tr, fill=5, dtype='uint8')
fuel = np.vectorize(lambda c: CLS2FUEL.get(int(c), 1))(cos).astype('uint8')
fuel.tofile(os.path.join(OUT, 'fuel.u8')); cos.tofile(os.path.join(OUT, 'cos.u8'))
u, n = np.unique(cos, return_counts=True); print(dict(zip(u.tolist(), n.tolist())))

"""Download the extra datasets used by analysis.py into <raw>/extra/.
  dlt2015.tif                 Copernicus HRL Dominant Leaf Type 2015 (EEA ImageServer, pre-fire; 1 broadleaved, 2 coniferous)
  icnf_<layer>.json           ICNF burned areas 1975–2025 (WFS BDG:ardida_*), clipped to the domain bbox
  buildings.json              OpenStreetMap building centroids (Overpass)
  meteostat_<id>.csv.gz       hourly synop data (08540 Monte Real, 08570 Castelo Branco)
  lpmr_metar.csv              Monte Real METAR (Iowa Environmental Mesonet)
Usage: python fetch_extra.py <raw>"""
import json, os, sys, time, requests
RAW = os.path.join(sys.argv[1], 'extra'); os.makedirs(RAW, exist_ok=True)
H = {'User-Agent': 'FireTrace-Pedrogao/1.0 (research visualisation)'}
W, S, E, N = -8.50, 39.70, -7.84, 40.21
def save(name, content, mode='wb'):
    open(os.path.join(RAW, name), mode).write(content); print(name, len(content))

for name, svc in [('dlt2015.tif', 'HRL_DominantLeafType_2015')]:
    if os.path.exists(os.path.join(RAW, name)): continue
    r = requests.get(f'https://image.discomap.eea.europa.eu/arcgis/rest/services/GioLandPublic/{svc}/ImageServer/exportImage', headers=H, timeout=300,
                     params={'bbox': f'{W},{S},{E},{N}', 'bboxSR': 4326, 'imageSR': 3035, 'size': '2900,2900', 'format': 'tiff', 'pixelType': 'U8', 'interpolation': 'RSP_NearestNeighbor', 'f': 'image'})
    r.raise_for_status(); save(name, r.content)

layers = ['ardida_1975_1989', 'ardida_1990_1999', 'ardida_2000_2008'] + [f'ardida_{y}' for y in range(2009, 2026) if y != 2017]
for lyr in layers:
    for k in range(3):
        try:
            r = requests.get('http://si.icnf.pt/geoserverplinia/BDG/ows', headers=H, timeout=300, params={'service': 'WFS', 'version': '1.0.0', 'request': 'GetFeature',
                             'typeName': f'BDG:{lyr}', 'outputFormat': 'application/json', 'srsName': 'EPSG:4326', 'bbox': f'{W},{S},{E},{N},EPSG:4326'})
            r.raise_for_status(); d = r.json(); save(f'icnf_{lyr}.json', json.dumps(d).encode()); break
        except Exception as e:
            print(lyr, 'retry', e); time.sleep(3)

q = f'[out:json][timeout:300];way["building"]({S},{W},{N},{E});out center tags;'
for url in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
    try:
        r = requests.post(url, data={'data': q}, headers=H, timeout=400); r.raise_for_status()
        els = [{'lat': e['center']['lat'], 'lon': e['center']['lon'], 'b': e.get('tags', {}).get('building')} for e in r.json()['elements'] if 'center' in e]
        save('buildings.json', json.dumps(els).encode()); break
    except Exception as e: print(url, e)

for st in ['08540', '08570']:
    r = requests.get(f'https://bulk.meteostat.net/v2/hourly/{st}.csv.gz', headers=H, timeout=120)
    if r.ok: save(f'meteostat_{st}.csv.gz', r.content)
r = requests.get('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py', headers=H, timeout=120, params={'station': 'LPMR', 'data': 'all', 'year1': 2017, 'month1': 6, 'day1': 15,
                 'year2': 2017, 'month2': 6, 'day2': 23, 'tz': 'Europe/Lisbon', 'format': 'onlycomma', 'missing': 'M', 'trace': 'T', 'direct': 'no', 'report_type': [3, 4]})
if r.ok: save('lpmr_metar.csv', r.content)
